import type { BlenderOperation, OperationResult } from "@pipelinekit/core";
import { validateBlenderOperation } from "@pipelinekit/core";
import type { BlenderMcpClient } from "../blender/mcp-client.js";
import type { PipelineStepContext, PipelineStepExecutor } from "../providers/types.js";
import type { SidecarState } from "../server/state.js";
import type { ApprovalGate } from "./approval-gate.js";

export interface BlenderOperationCallable {
  runOperation(operation: BlenderOperation): Promise<OperationResult>;
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

  constructor(options: BlenderStepExecutorOptions) {
    this.operationRunner = options.operationRunner;
    this.mcpClient = options.mcpClient;
    this.scriptToolName = options.scriptToolName ?? DEFAULT_SCRIPT_TOOL_NAME;
    this.scriptArgumentName = options.scriptArgumentName ?? DEFAULT_SCRIPT_ARGUMENT_NAME;
    this.gate = options.gate;
    this.state = options.state;
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

    const runOp = async (): Promise<unknown> => {
      if (validatedOperation) {
        // operationRunner presence is guaranteed above when validatedOperation is set.
        return this.operationRunner!.runOperation(validatedOperation);
      }
      if (typeof pythonCandidate === "string" && pythonCandidate.length > 0) {
        if (!this.mcpClient) {
          throw new Error(
            `Blender step "${context.step.id}" provided python but no MCP client is configured.`
          );
        }
        const result = await this.mcpClient.call({
          name: this.scriptToolName,
          arguments: { [this.scriptArgumentName]: pythonCandidate }
        });
        return result.output;
      }
      throw new Error(
        `Blender step "${context.step.id}" requires either metadata.operation (BlenderOperation) or metadata.python (string).`
      );
    };

    const metadataRequiresApproval = metadata["requiresApproval"] === true;
    const operationRequiresApproval = validatedOperation?.requiresApproval === true;
    const requiresApproval = metadataRequiresApproval || operationRequiresApproval;

    if (!requiresApproval || !this.gate) {
      return runOp();
    }

    const projectId = resolveProjectId(metadata, this.state);
    if (!projectId) {
      process.stderr.write(
        `[pipelinekit-sidecar] approval-gated step "${context.step.id}" has no projectId (step.metadata.projectId or state.activeProjectId); skipping gate.\n`
      );
      return runOp();
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
      pollMs: 500
    });

    if (decision.status === "rejected") {
      throw new Error(`Step rejected: ${decision.reason ?? "no reason"}`);
    }

    return runOp();
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
