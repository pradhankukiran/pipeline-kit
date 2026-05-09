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

export interface PipelineStepContext {
  readonly input: PipelineInput;
  readonly step: PipelineStep;
  readonly priorOutputs: ReadonlyMap<string, unknown>;
}

export interface PipelineStepExecutor {
  readonly lane: ProviderLane;
  execute(context: PipelineStepContext): Promise<unknown>;
}
