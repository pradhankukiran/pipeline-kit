import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "./types.js";

interface OpenAiCompatibleProviderOptions {
  readonly providerName: string;
  readonly lane: ModelProvider["lane"];
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultModel: string;
  readonly headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
    };
  }[];
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly lane: ModelProvider["lane"];

  private readonly providerName: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly headers: Record<string, string>;

  constructor(options: OpenAiCompatibleProviderOptions) {
    this.providerName = options.providerName;
    this.lane = options.lane;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel;
    this.headers = options.headers ?? {};
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...this.headers
      },
      body: JSON.stringify({
        model,
        messages: request.messages satisfies readonly ChatMessage[],
        temperature: request.temperature,
        response_format:
          request.responseFormat === "json" ? { type: "json_object" } : undefined
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.providerName} request failed: ${response.status} ${body}`);
    }

    const raw = (await response.json()) as ChatCompletionResponse;
    const content = raw.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${this.providerName} response did not include message content`);
    }

    return {
      provider: this.providerName,
      model: raw.model ?? model,
      content,
      raw
    };
  }
}
