import { OpenAiCompatibleProvider } from "./openai-compatible.js";

export interface OpenRouterProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly appName?: string;
  readonly referer?: string;
}

export function createOpenRouterProvider(
  options: OpenRouterProviderOptions
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    providerName: "openrouter",
    lane: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: options.apiKey,
    defaultModel: options.model ?? "anthropic/claude-3.5-sonnet",
    headers: {
      ...(options.referer ? { "HTTP-Referer": options.referer } : {}),
      ...(options.appName ? { "X-Title": options.appName } : {})
    }
  });
}
