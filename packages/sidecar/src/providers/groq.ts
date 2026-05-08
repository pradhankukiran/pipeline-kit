import { OpenAiCompatibleProvider } from "./openai-compatible.js";

export interface GroqProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
}

export function createGroqProvider(options: GroqProviderOptions): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    providerName: "groq",
    lane: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: options.apiKey,
    defaultModel: options.model ?? "llama-3.1-8b-instant"
  });
}
