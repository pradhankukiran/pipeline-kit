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

const RETRY_MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8000;
const RETRY_FACTOR = 2;

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
    const url = `${this.baseUrl}/chat/completions`;
    const init: RequestInit = {
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
    };

    const response = await this.fetchWithRetry(url, init);

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

  /**
   * Wraps `fetch` with bounded exponential backoff on transient HTTP errors.
   * Retries on 429 and any 5xx; gives up otherwise (including 4xx ≠ 429).
   * Honors `Retry-After` (seconds OR HTTP-date), capped at the max delay.
   * `AbortError` is never retried so caller-controlled cancellation works.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, init);
        if (response.ok) {
          return response;
        }

        if (!isRetryableStatus(response.status) || attempt === RETRY_MAX_ATTEMPTS) {
          return response;
        }

        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        const delayMs = computeBackoffDelay(attempt, retryAfterMs);
        // Drain body so the underlying connection can be released.
        try {
          await response.text();
        } catch {
          // Ignore — we're discarding this response either way.
        }
        process.stderr.write(
          `[pipelinekit-sidecar] provider retry ${attempt}/${RETRY_MAX_ATTEMPTS - 1} after ${response.status} (${delayMs}ms)\n`
        );
        lastResponse = response;
        await sleep(delayMs);
      } catch (error) {
        if (isAbortError(error) || attempt === RETRY_MAX_ATTEMPTS) {
          throw error;
        }
        const delayMs = computeBackoffDelay(attempt, undefined);
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `[pipelinekit-sidecar] provider retry ${attempt}/${RETRY_MAX_ATTEMPTS - 1} after network-error:${reason} (${delayMs}ms)\n`
        );
        await sleep(delayMs);
      }
    }
    // Defensive: only reached if the loop exits without returning, which can't
    // happen given the structure above. Returning the last response keeps the
    // function total without throwing a synthetic error.
    if (lastResponse) {
      return lastResponse;
    }
    throw new Error(`${this.providerName} request failed: retry loop exhausted without a response`);
  }
}

function isRetryableStatus(status: number): boolean {
  if (status === 429) {
    return true;
  }
  return status >= 500 && status < 600;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  // Some runtimes throw a DOMException-like object whose `name` is "AbortError"
  // without subclassing Error.
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (name === "AbortError") {
      return true;
    }
  }
  return false;
}

function computeBackoffDelay(attempt: number, retryAfterMs: number | undefined): number {
  const exponential = Math.min(
    RETRY_BASE_DELAY_MS * RETRY_FACTOR ** (attempt - 1),
    RETRY_MAX_DELAY_MS
  );
  const jittered = Math.round(exponential * (0.5 + Math.random() * 0.5));
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(retryAfterMs, 0), RETRY_MAX_DELAY_MS);
  }
  return jittered;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  // Numeric form: delta-seconds.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
