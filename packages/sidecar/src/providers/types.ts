import type { PipelineInput, PipelineStep, ProviderLane } from "../contracts.js";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ProviderImageInput {
  readonly localPath?: string;
  readonly url?: string;
  readonly mediaType?: string;
}

export interface ModelRequest {
  readonly messages: readonly ChatMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly responseFormat?: "text" | "json";
  readonly metadata?: Record<string, unknown>;
  readonly images?: ReadonlyArray<ProviderImageInput>;
}

export interface ModelResponse {
  readonly provider: string;
  readonly model: string;
  readonly content: string;
  readonly raw?: unknown;
}

export interface ModelProvider {
  readonly lane: Extract<ProviderLane, "groq" | "openrouter" | "codex">;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface StepProgressPayload {
  readonly message?: string;
  readonly percent?: number;
  readonly data?: unknown;
}

export interface PipelineStepContext {
  readonly input: PipelineInput;
  readonly step: PipelineStep;
  readonly priorOutputs: ReadonlyMap<string, unknown>;
  /**
   * Optional `AbortSignal` propagated by the orchestrator. The orchestrator
   * itself stops dispatching new steps when this fires; cooperative executors
   * (e.g. ones that poll an external service) may also short-circuit by
   * checking `signal?.aborted` directly. Already-running Blender ops are not
   * interrupted — the signal's purpose is to prevent further work, not to kill
   * in-flight bpy execution.
   */
  readonly signal?: AbortSignal;
  /**
   * Fire-and-forget progress reporter. When supplied, executors call this to
   * surface in-flight progress chunks (e.g. Blender render samples / tiles)
   * to the orchestrator's event sink as `step.progress` events. Implementations
   * MUST be synchronous and MUST NOT throw — the orchestrator's wrapper
   * swallows errors so a buggy emitter cannot crash a running step.
   */
  readonly emitProgress?: (payload: StepProgressPayload) => void;
}

export interface PipelineStepExecutor {
  readonly lane: ProviderLane;
  execute(context: PipelineStepContext): Promise<unknown>;
}
