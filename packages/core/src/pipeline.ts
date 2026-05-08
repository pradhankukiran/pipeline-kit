import type { AssetRecord, CreativeBrief, ID, PipelineStage, ProductionTask, Project, StyleGuide } from "./models.js";
import type { OperationResult, PipelineOperation } from "./operations.js";

export type PipelineState = {
  project: Project;
  brief?: CreativeBrief;
  styleGuide?: StyleGuide;
  tasks: ProductionTask[];
  operations: PipelineOperation[];
  assets: AssetRecord[];
  lastResult?: OperationResult;
};

export type ModelRouteRequest = {
  id: ID;
  projectId: ID;
  purpose:
    | "classify_intent"
    | "extract_brief"
    | "creative_direction"
    | "operation_planning"
    | "render_review"
    | "status_summary"
    | "failure_recovery";
  input: unknown;
};

export type ModelRouteDecision = {
  lane: "groq" | "openrouter" | "codex";
  reason: string;
  requiresVision: boolean;
  requiresLocalTools: boolean;
};

export type PipelineEvent =
  | { type: "project.created"; project: Project }
  | { type: "stage.changed"; projectId: ID; stage: PipelineStage }
  | { type: "task.updated"; task: ProductionTask }
  | { type: "operation.queued"; operation: PipelineOperation }
  | { type: "operation.completed"; result: OperationResult }
  | { type: "asset.added"; asset: AssetRecord };

export type PipelineController = {
  route(request: ModelRouteRequest): Promise<ModelRouteDecision>;
  enqueue(operation: PipelineOperation): Promise<void>;
  executeNext(): Promise<OperationResult | undefined>;
  getState(projectId: ID): Promise<PipelineState>;
};

export type ProviderLane = "groq" | "openrouter" | "codex" | "blender";

export type PipelineInput = {
  readonly prompt: string;
  readonly projectPath?: string;
  readonly metadata?: Record<string, unknown>;
};

export type PipelineStep = {
  readonly id: ID;
  readonly lane: ProviderLane;
  readonly instruction: string;
  readonly dependsOn?: readonly ID[];
  readonly metadata?: Record<string, unknown>;
};

export type PipelineDefinition = {
  readonly id: ID;
  readonly input: PipelineInput;
  readonly steps: readonly PipelineStep[];
};

export type PipelineStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type PipelineStepResult = {
  readonly stepId: ID;
  readonly lane: ProviderLane;
  readonly status: PipelineStepStatus;
  readonly output?: unknown;
  readonly error?: string;
};

export type PipelineRunEvent =
  | {
      readonly type: "pipeline.started";
      readonly pipelineId: ID;
    }
  | {
      readonly type: "step.started";
      readonly pipelineId: ID;
      readonly step: PipelineStep;
    }
  | {
      readonly type: "step.completed";
      readonly pipelineId: ID;
      readonly result: PipelineStepResult;
    }
  | {
      readonly type: "pipeline.completed";
      readonly pipelineId: ID;
      readonly results: readonly PipelineStepResult[];
    };

export type PipelineEventSink = {
  publish(event: PipelineRunEvent): void | Promise<void>;
};
