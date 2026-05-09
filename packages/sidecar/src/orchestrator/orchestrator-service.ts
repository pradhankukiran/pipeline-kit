import type { BlenderOperation, ID, OperationResult } from "@pipelinekit/core";
import type { BlenderMcpClient, BlenderMcpResult } from "../blender/mcp-client.js";
import type {
  PipelineDefinition,
  PipelineEventSink,
  PipelineStep,
  PipelineStepResult,
  ProviderLane
} from "../contracts.js";
import { CodexSdkProvider } from "../providers/codex-sdk.js";
import { createGroqProvider } from "../providers/groq.js";
import { createOpenRouterProvider } from "../providers/openrouter.js";
import type { PipelineStepContext, PipelineStepExecutor } from "../providers/types.js";
import { BlenderOperationAdapter } from "../server/blender-adapter.js";
import {
  recordPipelineRun,
  updatePipelineRun,
  type JsonOperation,
  type PipelineRunRecord,
  type PipelineRunStatus,
  type SidecarState
} from "../server/state.js";
import { createApprovalGate } from "./approval-gate.js";
import { BlenderStepExecutor } from "./blender-step-executor.js";
import { ModelStepExecutor } from "./model-step-executor.js";
import { PipelineOrchestrator } from "./pipeline-orchestrator.js";

export interface OrchestratorServiceOptions {
  readonly state: SidecarState;
  readonly blender: BlenderOperationAdapter;
  readonly eventSink?: PipelineEventSink;
}

export interface OrchestratorRunResult {
  readonly pipelineId: string;
  readonly results: readonly PipelineStepResult[];
}

export interface OrchestratorRunOptions {
  readonly projectId?: ID | null;
  readonly prompt?: string;
}

export interface OrchestratorAsyncSubmission {
  readonly runId: string;
}

/**
 * Constructs `PipelineOrchestrator`s for each run, wiring lane executors based
 * on the live `SidecarState` (settings can change between runs) and the shared
 * `BlenderOperationAdapter`. Falls back to a stub executor that produces
 * `skipped` step results for lanes that lack credentials.
 */
export class OrchestratorService {
  private readonly state: SidecarState;
  private readonly blender: BlenderOperationAdapter;
  private readonly eventSink?: PipelineEventSink;

  constructor(options: OrchestratorServiceOptions) {
    this.state = options.state;
    this.blender = options.blender;
    this.eventSink = options.eventSink;
  }

  async runPipeline(
    definition: PipelineDefinition,
    opts?: OrchestratorRunOptions
  ): Promise<OrchestratorRunResult> {
    const projectId = opts?.projectId ?? this.state.activeProjectId ?? null;
    const enrichedDefinition = injectProjectIdIntoSteps(definition, projectId);

    const lanes = collectLanes(enrichedDefinition);
    const executors = this.buildExecutors(lanes);
    const orchestrator = new PipelineOrchestrator({
      eventSink: this.eventSink,
      executors
    });

    const startedAt = new Date().toISOString();
    const results = await orchestrator.run(enrichedDefinition);
    const completedAt = new Date().toISOString();

    this.recordBlenderResults(results, projectId);

    recordPipelineRun(this.state, {
      id: enrichedDefinition.id,
      projectId,
      ...(typeof opts?.prompt === "string" ? { prompt: opts.prompt } : {}),
      definitionId: enrichedDefinition.id,
      status: deriveRunStatus(results),
      startedAt,
      completedAt,
      results
    });

    return {
      pipelineId: enrichedDefinition.id,
      results
    };
  }

  /**
   * Submits a pipeline run without awaiting it. A `running` `PipelineRunRecord`
   * is recorded immediately and the orchestrator is kicked off in the
   * background; the caller gets `{ runId }` back synchronously and follows
   * progress via the SSE `/events` stream (each event already carries the
   * `pipelineId`, which equals the runId). When the run terminates the
   * record is patched with `status` (`completed` | `failed` | `rejected`),
   * `completedAt`, and the final `results`.
   */
  runPipelineAsync(
    definition: PipelineDefinition,
    opts?: OrchestratorRunOptions
  ): OrchestratorAsyncSubmission {
    const projectId = opts?.projectId ?? this.state.activeProjectId ?? null;
    const enrichedDefinition = injectProjectIdIntoSteps(definition, projectId);
    const runId = enrichedDefinition.id;

    const startedAt = new Date().toISOString();
    const initialRecord: PipelineRunRecord = {
      id: runId,
      projectId,
      ...(typeof opts?.prompt === "string" ? { prompt: opts.prompt } : {}),
      definitionId: runId,
      status: "running",
      startedAt,
      results: []
    };
    recordPipelineRun(this.state, initialRecord);

    const lanes = collectLanes(enrichedDefinition);
    const executors = this.buildExecutors(lanes);
    const orchestrator = new PipelineOrchestrator({
      eventSink: this.eventSink,
      executors
    });

    void orchestrator
      .run(enrichedDefinition)
      .then((results) => {
        this.recordBlenderResults(results, projectId);
        const status = deriveRunStatus(results);
        updatePipelineRun(this.state, runId, {
          status,
          completedAt: new Date().toISOString(),
          results
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const failureResult: PipelineStepResult = {
          stepId: "__pipeline__",
          lane: "codex",
          status: "failed",
          error: message
        };
        updatePipelineRun(this.state, runId, {
          status: "failed",
          completedAt: new Date().toISOString(),
          results: [failureResult]
        });
        process.stderr.write(
          `[pipelinekit-sidecar] pipeline run ${runId} threw: ${message}\n`
        );
      });

    return { runId };
  }

  private buildExecutors(lanes: ReadonlySet<ProviderLane>): readonly PipelineStepExecutor[] {
    const executors: PipelineStepExecutor[] = [];
    const groqApiKey = readApiKey(this.state, "groq");
    const openRouterApiKey = readApiKey(this.state, "openrouter");

    if (lanes.has("groq")) {
      if (groqApiKey) {
        executors.push(
          new ModelStepExecutor(
            createGroqProvider({
              apiKey: groqApiKey,
              model: this.state.settings.models.groqModel
            })
          )
        );
      } else {
        executors.push(
          new SkippedLaneExecutor(
            "groq",
            "Skipped: Groq lane is not configured. Set apiKey in settings or PIPELINEKIT_GROQ_API_KEY (or GROQ_API_KEY) in env."
          )
        );
      }
    }

    if (lanes.has("openrouter")) {
      if (openRouterApiKey) {
        executors.push(
          new ModelStepExecutor(
            createOpenRouterProvider({
              apiKey: openRouterApiKey,
              model: this.state.settings.models.openRouterModel
            })
          )
        );
      } else {
        executors.push(
          new SkippedLaneExecutor(
            "openrouter",
            "Skipped: OpenRouter lane is not configured. Set apiKey in settings or PIPELINEKIT_OPENROUTER_API_KEY (or OPENROUTER_API_KEY) in env."
          )
        );
      }
    }

    if (lanes.has("codex")) {
      executors.push(
        new ModelStepExecutor(
          new CodexSdkProvider({ model: this.state.settings.models.codexModel })
        )
      );
    }

    if (lanes.has("blender")) {
      // Codex SDK is keyless (uses ChatGPT account or env), so we always wire
      // a translator instance. The executor only invokes it when a blender
      // step lacks both metadata.operation and metadata.python.
      const codexTranslator = new CodexSdkProvider({
        model: this.state.settings.models.codexModel
      });
      const adapter = this.blender;
      const mcpClientShim: BlenderMcpClient = {
        async connect() {
          /* adapter.runPython handles its own connect lifecycle */
        },
        async listTools() {
          return (await adapter.listTools()).tools;
        },
        async call(command): Promise<BlenderMcpResult> {
          // The executor only ever invokes this with the script tool name
          // (default "execute_blender_code"). Route through the adapter so
          // its timeout/disconnect-on-error semantics apply.
          const argName = Object.keys(command.arguments ?? {})[0] ?? "code";
          const code = (command.arguments as Record<string, unknown> | undefined)?.[argName];
          if (typeof code !== "string") {
            throw new Error(`Blender mcp call requires a string '${argName}' argument.`);
          }
          return adapter.runPython(code);
        },
        async close() {
          /* adapter owns the underlying client lifecycle */
        }
      };
      executors.push(
        new BlenderStepExecutor({
          operationRunner: {
            runOperation: (operation: BlenderOperation) =>
              this.blender.runOperation(operation as unknown as JsonOperation)
          },
          mcpClient: mcpClientShim,
          gate: createApprovalGate(this.state),
          state: this.state,
          codexProvider: codexTranslator
        })
      );
    }

    return executors;
  }

  private recordBlenderResults(
    results: readonly PipelineStepResult[],
    projectId: ID | null
  ): void {
    for (const result of results) {
      if (result.lane !== "blender" || result.status !== "succeeded") {
        continue;
      }

      const operationResult = result.output as OperationResult | undefined;
      if (!operationResult || typeof operationResult !== "object") {
        continue;
      }

      const operation: JsonOperation = {
        id: operationResult.operationId ?? result.stepId,
        type: "pipeline_step",
        params: { stepId: result.stepId },
        ...(projectId ? { projectId } : {})
      };

      this.state.recentOperations = [
        { operation, result: operationResult, projectId },
        ...this.state.recentOperations
      ].slice(0, 20);
    }
  }
}

class SkippedLaneExecutor implements PipelineStepExecutor {
  readonly lane: ProviderLane;
  private readonly reason: string;

  constructor(lane: ProviderLane, reason: string) {
    this.lane = lane;
    this.reason = reason;
  }

  async execute(_context: PipelineStepContext): Promise<unknown> {
    throw new Error(this.reason);
  }
}

function collectLanes(definition: PipelineDefinition): ReadonlySet<ProviderLane> {
  const lanes = new Set<ProviderLane>();
  for (const step of definition.steps) {
    lanes.add(step.lane);
  }
  return lanes;
}

/**
 * Returns a `PipelineDefinition` whose steps' metadata carry the supplied
 * `projectId` when not already pinned. Existing `metadata.projectId` values
 * win — callers that pre-bind a step to a different project are preserved.
 * When `projectId` is null/undefined, the definition is returned unchanged.
 */
function injectProjectIdIntoSteps(
  definition: PipelineDefinition,
  projectId: ID | null
): PipelineDefinition {
  if (typeof projectId !== "string" || projectId.length === 0) {
    return definition;
  }

  const steps = definition.steps.map((step): PipelineStep => {
    const metadata = step.metadata ?? {};
    if (typeof metadata["projectId"] === "string" && metadata["projectId"].length > 0) {
      return step;
    }
    return {
      ...step,
      metadata: { ...metadata, projectId }
    };
  });

  return {
    ...definition,
    steps
  };
}

/**
 * Derives a terminal `PipelineRunStatus` from the orchestrator's results.
 *
 * - `rejected` if any failed step's error starts with `"Step rejected:"`
 *   (the marker thrown by the approval gate).
 * - `failed` if any step failed for another reason.
 * - `completed` otherwise (including pure `succeeded` / `skipped` mixes).
 */
function deriveRunStatus(results: readonly PipelineStepResult[]): PipelineRunStatus {
  let anyFailed = false;
  let anyRejected = false;
  for (const result of results) {
    if (result.status !== "failed") {
      continue;
    }
    anyFailed = true;
    if (typeof result.error === "string" && result.error.startsWith("Step rejected:")) {
      anyRejected = true;
    }
  }

  if (anyRejected) {
    return "rejected";
  }
  if (anyFailed) {
    return "failed";
  }
  return "completed";
}

function readApiKey(state: SidecarState, provider: "groq" | "openrouter"): string | undefined {
  const fromSettings =
    provider === "groq"
      ? state.settings.models.groqApiKey
      : state.settings.models.openRouterApiKey;

  if (typeof fromSettings === "string" && fromSettings.trim().length > 0) {
    return fromSettings.trim();
  }

  const candidates =
    provider === "groq"
      ? ["PIPELINEKIT_GROQ_API_KEY", "GROQ_API_KEY"]
      : ["PIPELINEKIT_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"];

  for (const key of candidates) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
