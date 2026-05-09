import type {
  BlenderOperation,
  OperationResult,
  SaveCheckpointOperation
} from "@pipelinekit/core";
import { validateBlenderOperation } from "@pipelinekit/core";
import type { BlenderMcpClient } from "../blender/mcp-client.js";
import type {
  ModelProvider,
  PipelineStepContext,
  PipelineStepExecutor,
  StepProgressPayload
} from "../providers/types.js";
import type { SidecarState } from "../server/state.js";
import type { ApprovalGate } from "./approval-gate.js";

/**
 * Optional context threaded into a Blender operation invocation. Today this
 * carries `runId` and `stepId` so the bpy-side prelude can post `step.progress`
 * back to the sidecar via `POST /blender/progress`. Callers may add fields
 * (e.g. an in-flight AbortSignal) without breaking existing implementations.
 */
export interface BlenderOperationCallContext {
  readonly runId?: string;
  readonly stepId?: string;
}

export interface BlenderOperationCallable {
  runOperation(
    operation: BlenderOperation,
    options?: {
      readonly onProgress?: (chunk: string) => void;
      readonly context?: BlenderOperationCallContext;
    }
  ): Promise<OperationResult>;
}

export interface BlenderStepExecutorOptions {
  /**
   * Adapter (or anything that implements `runOperation`) used to execute a
   * fully-typed `BlenderOperation`. Optional: when omitted, only direct
   * `python` step metadata can be executed.
   */
  readonly operationRunner?: BlenderOperationCallable;
  /**
   * Underlying MCP client used to invoke `execute_blender_code` directly when
   * a step provides raw `python` source.
   */
  readonly mcpClient?: BlenderMcpClient;
  /**
   * Override for the script tool name (defaults to `execute_blender_code`).
   */
  readonly scriptToolName?: string;
  /**
   * Override for the script argument name (defaults to `code`).
   */
  readonly scriptArgumentName?: string;
  /**
   * Optional approval gate. When supplied, steps whose metadata or validated
   * operation flag `requiresApproval` block until a human decision lands via
   * the `/approvals` API (or the gate's internal timeout fires).
   */
  readonly gate?: ApprovalGate;
  /**
   * Sidecar state used to resolve the active project ID for approval-gated
   * steps when the step itself does not pin one. Optional; without it the
   * gate is skipped (with a stderr warning) when no project ID is present.
   */
  readonly state?: SidecarState;
  /**
   * Optional Codex (or any ModelProvider) translator used as a fallback when a
   * blender step arrives with neither `metadata.operation` nor
   * `metadata.python`. Codex is asked to convert the step's `instruction`
   * (plus prior step outputs) into either a typed `BlenderOperation` or raw
   * bpy Python. When omitted, such steps surface the existing
   * "requires either metadata.operation or metadata.python" error.
   */
  readonly codexProvider?: ModelProvider;
}

const DEFAULT_SCRIPT_TOOL_NAME = "execute_blender_code";
const DEFAULT_SCRIPT_ARGUMENT_NAME = "code";
const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

export class BlenderStepExecutor implements PipelineStepExecutor {
  readonly lane = "blender" as const;

  private readonly operationRunner?: BlenderOperationCallable;
  private readonly mcpClient?: BlenderMcpClient;
  private readonly scriptToolName: string;
  private readonly scriptArgumentName: string;
  private readonly gate?: ApprovalGate;
  private readonly state?: SidecarState;
  private readonly codexProvider?: ModelProvider;

  constructor(options: BlenderStepExecutorOptions) {
    this.operationRunner = options.operationRunner;
    this.mcpClient = options.mcpClient;
    this.scriptToolName = options.scriptToolName ?? DEFAULT_SCRIPT_TOOL_NAME;
    this.scriptArgumentName = options.scriptArgumentName ?? DEFAULT_SCRIPT_ARGUMENT_NAME;
    this.gate = options.gate;
    this.state = options.state;
    this.codexProvider = options.codexProvider;
  }

  async execute(context: PipelineStepContext): Promise<unknown> {
    const metadata = context.step.metadata ?? {};
    const operationCandidate = metadata["operation"];
    const pythonCandidate = metadata["python"];

    let validatedOperation: BlenderOperation | undefined;
    if (operationCandidate !== undefined) {
      if (!this.operationRunner) {
        throw new Error(
          `Blender step "${context.step.id}" provided an operation but no operation runner is configured.`
        );
      }
      validatedOperation = validateBlenderOperation(operationCandidate);
    }

    // Plain-instruction fallback: ask Codex to translate to a typed op or bpy.
    let translatedPython: string | undefined;
    const hasPython = typeof pythonCandidate === "string" && pythonCandidate.length > 0;
    if (!validatedOperation && !hasPython && this.codexProvider) {
      const translated = await this.translateInstructionViaCodex(context);
      if (translated.kind === "operation") {
        if (!this.operationRunner) {
          throw new Error(
            `Blender step "${context.step.id}" was translated to a typed operation but no operation runner is configured.`
          );
        }
        validatedOperation = translated.operation;
      } else {
        translatedPython = translated.python;
      }
    }

    const onProgress = buildBlenderProgressHandler(context);
    const callContext = buildBlenderCallContext(context, metadata);

    const runOp = async (): Promise<unknown> => {
      if (validatedOperation) {
        // operationRunner presence is guaranteed above when validatedOperation is set.
        const runOptions: {
          onProgress?: (chunk: string) => void;
          context?: BlenderOperationCallContext;
        } = {};
        if (onProgress) {
          runOptions.onProgress = onProgress;
        }
        if (callContext) {
          runOptions.context = callContext;
        }
        const result = await this.operationRunner!.runOperation(
          validatedOperation,
          Object.keys(runOptions).length > 0 ? runOptions : undefined
        );
        if (result.status !== "succeeded") {
          throw new Error(result.error ?? result.summary);
        }
        return result;
      }
      const pythonSource = hasPython ? (pythonCandidate as string) : translatedPython;
      if (typeof pythonSource === "string" && pythonSource.length > 0) {
        if (!this.mcpClient) {
          throw new Error(
            `Blender step "${context.step.id}" provided python but no MCP client is configured.`
          );
        }
        const result = await this.mcpClient.call({
          name: this.scriptToolName,
          arguments: { [this.scriptArgumentName]: pythonSource },
          ...(onProgress ? { onProgress } : {})
        });
        return result.output;
      }
      throw new Error(
        `Blender step "${context.step.id}" requires either metadata.operation (BlenderOperation) or metadata.python (string).`
      );
    };

    const runOpAndMaybeCheckpoint = async (): Promise<unknown> => {
      const output = await runOp();
      await this.maybeAutoCheckpoint(context, validatedOperation, metadata);
      return output;
    };

    const metadataRequiresApproval = metadata["requiresApproval"] === true;
    const operationRequiresApproval = validatedOperation?.requiresApproval === true;
    const requiresApproval = metadataRequiresApproval || operationRequiresApproval;

    if (!requiresApproval || !this.gate) {
      return runOpAndMaybeCheckpoint();
    }

    const projectId = resolveProjectId(metadata, this.state);
    if (!projectId) {
      process.stderr.write(
        `[pipelinekit-sidecar] approval-gated step "${context.step.id}" has no projectId (step.metadata.projectId or state.activeProjectId); skipping gate.\n`
      );
      return runOpAndMaybeCheckpoint();
    }

    const decision = await this.gate({
      projectId,
      kind: "step",
      summary: context.step.instruction,
      payload: {
        stepId: context.step.id,
        lane: context.step.lane,
        operation: validatedOperation
      },
      timeoutMs: readApprovalTimeoutMs(),
      pollMs: 500,
      // Thread the run's AbortSignal so the gate's poll loop can short-circuit
      // when the run is cancelled while a step is awaiting approval. Without
      // this, DELETE /pipeline/runs/:id only takes effect once the gate's own
      // timeout fires.
      ...(context.signal ? { signal: context.signal } : {})
    });

    // The gate distinguishes user-driven rejection from run-cancellation:
    //   - rejected  -> the user clicked deny; surface the prefix
    //                  "Step rejected:" so deriveRunStatus sets `rejected`.
    //   - cancelled -> the run's AbortSignal fired while we were polling. We
    //                  throw a distinctive Error so the orchestrator records
    //                  this step as failed, then `signal.aborted` causes the
    //                  next iteration to cancel the rest of the run.
    if (decision.status === "rejected") {
      throw new Error(`Step rejected: ${decision.reason ?? "no reason"}`);
    }
    if (decision.status === "cancelled") {
      throw new Error(
        `Step cancelled while awaiting approval: ${decision.reason ?? "run cancelled"}`
      );
    }

    return runOpAndMaybeCheckpoint();
  }

  /**
   * Dispatches an auto-`save_checkpoint` op after a successful mutating
   * Blender step. Skipped silently when:
   *   - no `operationRunner` is configured (we have nothing to dispatch with);
   *   - the original step's op was `inspect_scene` or `save_checkpoint`
   *     (read-only or already a checkpoint);
   *   - `state.settings.blender.autoCheckpoint` is `false` (defaults to `true`
   *     when absent so legacy state files keep checkpointing);
   *   - no `projectId` can be resolved (typed-op path uses the original op's
   *     projectId; python/python-translated paths fall back to step metadata
   *     or `state.activeProjectId`).
   *
   * On failure, logs to stderr and returns — the original step result is
   * preserved. This keeps `save_checkpoint` strictly opportunistic so a
   * disk-full / permission failure never aborts an otherwise-successful run.
   */
  private async maybeAutoCheckpoint(
    context: PipelineStepContext,
    originalOperation: BlenderOperation | undefined,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (!this.operationRunner) {
      return;
    }
    if (originalOperation) {
      if (
        originalOperation.type === "inspect_scene" ||
        originalOperation.type === "save_checkpoint"
      ) {
        return;
      }
    }
    if (this.state?.settings.blender.autoCheckpoint === false) {
      return;
    }

    const projectId =
      originalOperation?.projectId ?? resolveProjectId(metadata, this.state);
    if (!projectId) {
      process.stderr.write(
        `[pipelinekit-sidecar] auto-checkpoint skipped for step ${context.step.id}: no projectId resolvable\n`
      );
      return;
    }

    const checkpointId = originalOperation
      ? `auto-${originalOperation.id}`
      : `auto-${context.step.id}-${Date.now()}`;

    const checkpoint: SaveCheckpointOperation = {
      id: checkpointId,
      projectId,
      type: "save_checkpoint",
      params: {
        label: `auto_${context.step.id}`,
        includeBlendFile: true
      },
      risk: "low",
      requiresApproval: false,
      createdAt: new Date().toISOString()
    };

    try {
      const result = await this.operationRunner.runOperation(checkpoint);
      if (result.status !== "succeeded") {
        process.stderr.write(
          `[pipelinekit-sidecar] auto-checkpoint failed for step ${context.step.id}: ${result.error ?? result.summary}\n`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[pipelinekit-sidecar] auto-checkpoint failed for step ${context.step.id}: ${message}\n`
      );
    }
  }

  /**
   * Asks the configured `codexProvider` to convert a plain-instruction blender
   * step into either a typed BlenderOperation or raw bpy Python. Returns the
   * resolved discriminated union; throws a descriptive error if Codex returns
   * malformed JSON, an unknown `kind`, an invalid BlenderOperation, or empty
   * python source. The translator is intentionally one-shot — no retry — to
   * keep latency bounded; callers who need stronger guarantees should pre-emit
   * `metadata.operation` from the planner.
   */
  private async translateInstructionViaCodex(
    context: PipelineStepContext
  ): Promise<{ kind: "operation"; operation: BlenderOperation } | { kind: "python"; python: string }> {
    const provider = this.codexProvider;
    if (!provider) {
      throw new Error("translateInstructionViaCodex called without a codexProvider.");
    }

    const userMessage = buildCodexTranslatorUserMessage(context);
    const response = await provider.complete({
      responseFormat: "json",
      temperature: 0.1,
      messages: [
        { role: "system", content: CODEX_TRANSLATOR_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Codex translator returned non-JSON content: ${message}`);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Codex translator returned a non-object response.");
    }
    const record = parsed as Record<string, unknown>;
    const kind = record["kind"];

    if (kind === "operation") {
      const operationCandidate = record["operation"];
      if (operationCandidate === undefined) {
        throw new Error('Codex translator returned kind="operation" with no operation field.');
      }
      try {
        return { kind: "operation", operation: validateBlenderOperation(operationCandidate) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Codex translator emitted an invalid BlenderOperation: ${message}`);
      }
    }

    if (kind === "python") {
      const pythonCandidate = record["python"];
      if (typeof pythonCandidate !== "string" || pythonCandidate.length === 0) {
        throw new Error('Codex translator returned kind="python" but `python` is empty or non-string.');
      }
      return { kind: "python", python: pythonCandidate };
    }

    throw new Error(`Codex translator returned invalid response: ${JSON.stringify(kind)}`);
  }
}

const CODEX_TRANSLATOR_SYSTEM_PROMPT = `You are a Blender pipeline translator inside PipelineKit. Convert the user's plain instruction into ONE of two output shapes:

1. A typed BlenderOperation (preferred):
{"kind":"operation","operation":{ id, projectId, type, params, risk, requiresApproval, createdAt }}
where type is one of: create_scene, create_studio_set, apply_material, create_lighting_rig, create_camera_rig, render_shot, inspect_scene, save_checkpoint. Each operation MUST include id (kebab-case), projectId (use "active" if unknown), risk ("low"|"medium"|"high"), requiresApproval (boolean), createdAt (ISO string), and params shaped per the operation type. Use sensible defaults; do not invent params not in the schema.

Param shapes:
- create_scene: { sceneName: string, units: "metric"|"imperial", clearExisting: boolean }
- create_studio_set: { recipeId: "product_sweep"|"water_bottle_product_viz"|"pedestal", scale: number, variant?: string }
- apply_material: { targetObject, materialAssetId? OR proceduralMaterialId? ("clear_plastic"|"frosted_plastic"|"brushed_aluminum"|"paper_label"|"matte_clay"|"glossy_white"), color?: "#rrggbb", roughness?, metallic?, alpha? }
- create_lighting_rig: { preset: "studio_softbox"|"high_key_product"|"dramatic_rim"|"three_point", colorTemperature: int, intensity: number, useHdri: boolean, hdriAssetId? }
- create_camera_rig: { shotLabel, focalLength, cameraMove?: "static"|"orbit"|"dolly"|"push_in", outputAspect: "1:1"|"4:5"|"16:9"|"9:16", targetObject? }
- render_shot: { shotId, quality: "preview"|"review"|"final", outputPath }
- inspect_scene: { includeObjects, includeMaterials, includeRenderSettings } (booleans)
- save_checkpoint: { label, includeBlendFile }

2. Raw Blender Python (fallback when no typed op fits):
{"kind":"python","python":"<bpy snippet>"}
Use bpy. Keep it self-contained and idempotent where possible. Avoid destructive ops unless the instruction asks for them.

Return JSON ONLY. No prose, no markdown fences. Choose ONE shape — never both.`;

function buildCodexTranslatorUserMessage(context: PipelineStepContext): string {
  const lines: string[] = [];
  lines.push(`Pipeline run prompt: ${context.input.prompt}`);
  lines.push(`Step ID: ${context.step.id}`);
  lines.push(`Step instruction: ${context.step.instruction}`);

  const projectId = context.step.metadata?.["projectId"];
  if (typeof projectId === "string" && projectId.length > 0) {
    lines.push(`Active projectId: ${projectId}`);
  }

  const dependsOn = context.step.dependsOn ?? [];
  if (dependsOn.length > 0) {
    lines.push("Prior step outputs (truncated):");
    for (const dep of dependsOn) {
      const value = context.priorOutputs.get(dep);
      lines.push(`- ${dep}: ${summarizePriorOutput(value)}`);
    }
  }

  lines.push("");
  lines.push("Translate the instruction now. Respond with JSON only.");
  return lines.join("\n");
}

function summarizePriorOutput(value: unknown): string {
  if (value === undefined) {
    return "(no output)";
  }
  if (typeof value === "string") {
    return value.length > 600 ? `${value.slice(0, 600)}...(truncated)` : value;
  }
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") {
      return "(unstringifiable output)";
    }
    return json.length > 600 ? `${json.slice(0, 600)}...(truncated)` : json;
  } catch {
    return "(unstringifiable output)";
  }
}

function resolveProjectId(
  metadata: Record<string, unknown>,
  state: SidecarState | undefined
): string | undefined {
  const fromMetadata = metadata["projectId"];
  if (typeof fromMetadata === "string" && fromMetadata.length > 0) {
    return fromMetadata;
  }
  if (state && typeof state.activeProjectId === "string" && state.activeProjectId.length > 0) {
    return state.activeProjectId;
  }
  return undefined;
}

function readApprovalTimeoutMs(): number {
  const raw = process.env["PIPELINEKIT_APPROVAL_TIMEOUT_MS"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_APPROVAL_TIMEOUT_MS;
}

/**
 * Resolves the `BlenderOperationCallContext` baked into the emitted Python.
 * Reads `metadata.runId` (injected by `OrchestratorService.spawnAsyncRun`)
 * and uses `context.step.id` as the stepId. Returns `undefined` when neither
 * id is present — keeps unit-test contexts free of orphan handlers.
 */
function buildBlenderCallContext(
  context: PipelineStepContext,
  metadata: Record<string, unknown>
): BlenderOperationCallContext | undefined {
  const runIdRaw = metadata["runId"];
  const runId = typeof runIdRaw === "string" && runIdRaw.length > 0 ? runIdRaw : undefined;
  const stepId =
    typeof context.step.id === "string" && context.step.id.length > 0
      ? context.step.id
      : undefined;
  if (!runId && !stepId) {
    return undefined;
  }
  return {
    ...(runId ? { runId } : {}),
    ...(stepId ? { stepId } : {})
  };
}

/**
 * Builds the per-step `onProgress(chunk)` adapter that bridges raw Blender
 * stdout lines into the orchestrator's `step.progress` event sink.
 *
 * Returns `undefined` when `context.emitProgress` isn't wired (e.g. legacy
 * orchestrator or unit-test contexts) so the executor can skip threading
 * `onProgress` through entirely.
 *
 * The callback is fire-and-forget by contract: it must not throw, and it
 * does not await the publish. All errors (including a misbehaving emitter)
 * are swallowed so a buggy progress line never aborts a render.
 */
export function buildBlenderProgressHandler(
  context: PipelineStepContext
): ((chunk: string) => void) | undefined {
  const emit = context.emitProgress;
  if (!emit) {
    return undefined;
  }
  return (chunk: string): void => {
    try {
      const percent = parseBlenderProgressPercent(chunk);
      const payload: StepProgressPayload = {
        message: chunk,
        ...(typeof percent === "number" ? { percent } : {})
      };
      emit(payload);
    } catch {
      // Fire-and-forget — never crash the render on a bad progress chunk.
    }
  };
}

/**
 * Best-effort percent inference from a single Blender progress line.
 * Returns a value in [0, 100] when a recognized "X / Y" denominator pattern
 * is present, otherwise `undefined`. Patterns matched, in priority order:
 *
 *   - `Sample 64/256` -> 25%   (Cycles progressive samples)
 *   - `Sample 64 / 256` (whitespace tolerant)
 *   - `Tile 23/64` -> 36%      (older Cycles tile mode)
 *   - `Rendered 12/100 Tiles` -> 12% (pre-4.x Cycles header)
 *
 * False negatives are fine — the message itself still gets surfaced; only
 * the explicit `percent` field stays unset. We deliberately do not parse
 * `Fra:` / `Saved:` / `Compositing` lines because they don't carry a
 * stable progress denominator.
 */
export function parseBlenderProgressPercent(chunk: string): number | undefined {
  const sample = /Sample\s+(\d+)\s*\/\s*(\d+)/i.exec(chunk);
  if (sample) {
    return clampPercent(sample[1], sample[2]);
  }
  const tile = /Tile\s+(\d+)\s*\/\s*(\d+)/i.exec(chunk);
  if (tile) {
    return clampPercent(tile[1], tile[2]);
  }
  const rendered = /Rendered\s+(\d+)\s*\/\s*(\d+)\s+Tiles/i.exec(chunk);
  if (rendered) {
    return clampPercent(rendered[1], rendered[2]);
  }
  return undefined;
}

function clampPercent(numerator: string | undefined, denominator: string | undefined): number | undefined {
  if (!numerator || !denominator) {
    return undefined;
  }
  const num = Number.parseInt(numerator, 10);
  const den = Number.parseInt(denominator, 10);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) {
    return undefined;
  }
  const ratio = (num / den) * 100;
  if (!Number.isFinite(ratio)) {
    return undefined;
  }
  if (ratio < 0) {
    return 0;
  }
  if (ratio > 100) {
    return 100;
  }
  return ratio;
}
