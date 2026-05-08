import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";

export interface CodexSdkProviderOptions {
  readonly model?: string;
  readonly workingDirectory?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly env?: Record<string, string>;
}

interface CodexSdkModule {
  readonly Codex?: new (options?: CodexClientOptions) => CodexClient;
}

interface CodexClientOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly env?: Record<string, string>;
}

interface CodexClient {
  readonly startThread: (options?: CodexThreadOptions) => CodexThread;
}

interface CodexThreadOptions {
  readonly workingDirectory?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly model?: string;
}

interface CodexTurnOptions {
  readonly outputSchema?: unknown;
}

interface CodexThread {
  readonly run: (input: string, options?: CodexTurnOptions) => Promise<unknown>;
}

export class CodexSdkProvider implements ModelProvider {
  readonly lane = "codex" as const;

  private readonly model: string;
  private readonly workingDirectory?: string;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly env?: Record<string, string>;

  constructor(options: CodexSdkProviderOptions = {}) {
    this.model = options.model ?? "codex";
    this.workingDirectory = options.workingDirectory;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.env = options.env;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model ?? this.model;
    const metadata = request.metadata ?? {};
    const workingDirectory = getStringMetadata(metadata, "workingDirectory") ?? this.workingDirectory;
    const { Codex: CodexSdk } = await loadCodexSdk();
    const codex = new CodexSdk({
      apiKey: getStringMetadata(metadata, "apiKey") ?? this.apiKey,
      baseUrl: getStringMetadata(metadata, "baseUrl") ?? this.baseUrl,
      env: this.env
    }) as unknown as CodexClient;

    const thread = codex.startThread({
      workingDirectory,
      skipGitRepoCheck: true,
      model
    });

    if (typeof thread.run !== "function") {
      throw new Error("@openai/codex-sdk startThread() did not return a thread with run().");
    }

    const raw = await thread.run(formatCodexPrompt(request), {
      outputSchema: request.responseFormat === "json" ? jsonObjectOutputSchema : undefined
    });

    const content = extractCodexContent(raw);
    if (request.responseFormat === "json") {
      parseJsonContent(content);
    }

    return {
      provider: "codex-sdk",
      model,
      content,
      raw
    };
  }

  get defaultModel(): string {
    return this.model;
  }
}

let codexSdkModulePromise: Promise<CodexSdkModule> | undefined;

async function loadCodexSdk(): Promise<Required<Pick<CodexSdkModule, "Codex">>> {
  codexSdkModulePromise ??= importRuntime("@openai/codex-sdk");
  const mod = await codexSdkModulePromise;
  if (typeof mod.Codex !== "function") {
    throw new Error("@openai/codex-sdk did not export Codex.");
  }
  return { Codex: mod.Codex };
}

const importRuntime = new Function(
  "specifier",
  "return import(specifier)"
) as (specifier: string) => Promise<CodexSdkModule>;

const jsonObjectOutputSchema = {
  type: "object",
  additionalProperties: true
} as const;

function formatCodexPrompt(request: ModelRequest): string {
  return request.messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");
}

function extractCodexContent(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }

  if (isRecord(raw)) {
    const content =
      raw["finalResponse"] ?? raw["content"] ?? raw["text"] ?? raw["output"] ?? raw["response"];
    if (typeof content === "string") {
      return content;
    }

    if (content !== undefined) {
      return JSON.stringify(content);
    }
  }

  if (raw !== undefined) {
    return JSON.stringify(raw);
  }

  throw new Error("@openai/codex-sdk run() returned no content.");
}

function parseJsonContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Codex SDK response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function getStringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
