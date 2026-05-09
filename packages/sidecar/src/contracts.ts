import type {
  ID,
  PipelineDefinition,
  PipelineInput,
  PipelineStep,
  ProviderLane
} from "@pipelinekit/core";

export type {
  PipelineDefinition,
  PipelineInput,
  PipelineStep,
  ProviderLane
} from "@pipelinekit/core";

/**
 * Sidecar-local extension of `@pipelinekit/core`'s `PipelineStepStatus`.
 * Adds `cancelled` for steps that never ran because the orchestrator was
 * aborted mid-flight.
 */
export type PipelineStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Sidecar-local extension of `@pipelinekit/core`'s `PipelineStepResult`.
 * Mirrors core's shape but accepts the wider `PipelineStepStatus` and adds an
 * optional `summary` string used to describe non-error terminal states (e.g.
 * "Pipeline cancelled before this step ran.").
 */
export type PipelineStepResult = {
  readonly stepId: ID;
  readonly lane: ProviderLane;
  readonly status: PipelineStepStatus;
  readonly output?: unknown;
  readonly error?: string;
  readonly summary?: string;
};

/**
 * Sidecar-local extension of `@pipelinekit/core`'s `PipelineRunEvent` union.
 * Adds `pipeline.cancelled` so SSE consumers can distinguish a graceful
 * cancellation from a normal `pipeline.completed` event, and `step.progress`
 * for in-flight progress chunks (e.g. Blender render samples / tiles) so the
 * UI can show "Sample 64/256" while a long step is still running.
 */
export type PipelineEvent =
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
      readonly type: "step.progress";
      readonly pipelineId: ID;
      readonly stepId: ID;
      readonly message?: string;
      readonly percent?: number;
      readonly data?: unknown;
      readonly emittedAt?: string;
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
    }
  | {
      readonly type: "pipeline.cancelled";
      readonly pipelineId: ID;
      readonly cancelledAt: string;
    };

export type PipelineEventSink = {
  publish(event: PipelineEvent): void | Promise<void>;
};
