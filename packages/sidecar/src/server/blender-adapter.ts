import type { BlenderOperation, OperationResult } from "@pipelinekit/core";
import {
  createBlenderMcpClient,
  type BlenderMcpClient,
  type BlenderMcpResult
} from "../blender/mcp-client.js";
import { BlenderOperationRunner, buildBlenderPythonScript } from "../blender/operation-runner.js";
import type { JsonOperation, SidecarSettings, SidecarState } from "./state.js";

export interface BlenderToolInfo {
  readonly tools: unknown;
  readonly fallback: boolean;
  readonly error?: string;
}

export class BlenderOperationAdapter {
  private readonly state: SidecarState;
  private client?: BlenderMcpClient;
  private clientKey?: string;
  private readonly timeoutMs: number;

  constructor(state: SidecarState) {
    this.state = state;
    this.timeoutMs = readMcpTimeout();
  }

  /**
   * Read-only view of the live Blender connection flag. Exposed so HTTP
   * handlers (e.g., the scene-info poller) can short-circuit without
   * triggering an MCP call when the bridge is offline.
   */
  get connected(): boolean {
    return this.state.blender.connected;
  }

  async connect(): Promise<void> {
    const client = this.getClient();

    try {
      await withTimeout(client.connect(), this.timeoutMs, "Blender MCP connect");
      await withTimeout(verifyBlenderScene(client), this.timeoutMs, "Blender scene verification");
      this.state.blender = {
        connected: true,
        mode: "mcp",
        lastConnectedAt: new Date().toISOString()
      };
    } catch (error) {
      this.state.blender = {
        connected: false,
        mode: "fallback",
        lastError: errorMessage(error)
      };
      this.resetClient();
    }
  }

  async listTools(): Promise<BlenderToolInfo> {
    if (!this.state.blender.connected) {
      await this.connect();
    }

    if (!this.state.blender.connected) {
      return {
        tools: createFallbackTools(),
        fallback: true,
        error: this.state.blender.lastError
      };
    }

    try {
      return {
        tools: await withTimeout(this.getClient().listTools(), this.timeoutMs, "Blender MCP listTools"),
        fallback: false
      };
    } catch (error) {
      this.state.blender = {
        connected: false,
        mode: "fallback",
        lastError: errorMessage(error)
      };
      this.resetClient();
      return {
        tools: createFallbackTools(),
        fallback: true,
        error: this.state.blender.lastError
      };
    }
  }

  async runOperation(operation: JsonOperation): Promise<OperationResult> {
    if (!this.state.blender.connected) {
      return createFallbackResult(operation, this.state.blender.lastError);
    }

    try {
      const runner = new BlenderOperationRunner({
        client: this.getClient(),
        scriptToolName: readScriptToolName(),
        scriptArgumentName: readScriptArgumentName()
      });
      const run = await withTimeout(
        runner.run(operation),
        this.timeoutMs,
        "Blender MCP operation"
      );

      return run.result;
    } catch (error) {
      if (isOperationValidationError(error)) {
        return createFailedResult(operation, errorMessage(error));
      }

      this.state.blender = {
        connected: false,
        mode: "fallback",
        lastError: errorMessage(error)
      };
      this.resetClient();
      return createFallbackResult(operation, this.state.blender.lastError);
    }
  }

  /**
   * Connection state for the underlying Blender MCP client. Allows server
   * handlers to short-circuit (e.g. return 503) before attempting to send
   * Python over the bridge.
   */
  get isConnected(): boolean {
    return this.state.blender.connected === true;
  }

  /**
   * Sends a raw Python snippet to the Blender MCP `execute_blender_code`
   * tool. Returns the MCP tool output. Throws if Blender is not connected
   * or the tool call fails / times out.
   */
  async runPython(code: string): Promise<BlenderMcpResult> {
    if (!this.state.blender.connected) {
      throw new Error(this.state.blender.lastError ?? "Blender MCP is not connected.");
    }

    try {
      const result = await withTimeout(
        this.getClient().call({
          name: readScriptToolName(),
          arguments: {
            [readScriptArgumentName()]: code
          }
        }),
        this.timeoutMs,
        "Blender MCP runPython"
      );

      const failure = readMcpFailureMessage(result.output);
      if (failure) {
        throw new Error(failure);
      }

      return result;
    } catch (error) {
      this.state.blender = {
        connected: false,
        mode: "fallback",
        lastError: errorMessage(error)
      };
      this.resetClient();
      throw error;
    }
  }

  private getClient(): BlenderMcpClient {
    const key = settingsKey(this.state.settings);
    if (!this.client || this.clientKey !== key) {
      void this.client?.close();
      this.client = createBlenderMcpClient({
        command: this.state.settings.blender.command,
        args: this.state.settings.blender.args
      });
      this.clientKey = key;
      this.state.blender = {
        connected: false,
        mode: "fallback"
      };
    }

    return this.client;
  }

  private resetClient(): void {
    void this.client?.close();
    this.client = undefined;
    this.clientKey = undefined;
  }
}

function normalizeOperationResult(operationId: string, result: BlenderMcpResult): OperationResult {
  const output = isRecord(result.output) ? result.output : {};
  const content = isRecord(output["content"]) ? output["content"] : output;
  const status = readStatus(content["status"]);

  return {
    operationId,
    status,
    summary: readString(content["summary"], `${result.command} completed.`),
    artifacts: Array.isArray(content["artifacts"]) ? content["artifacts"] : [],
    error: typeof content["error"] === "string" ? content["error"] : undefined,
    completedAt: new Date().toISOString()
  };
}

function createFallbackResult(operation: JsonOperation, error?: string): OperationResult {
  const script = tryBuildFallbackScript(operation);
  return {
    operationId: operation.id,
    status: "skipped",
    summary: `Prepared ${operation.type} for Blender MCP execution in dev fallback mode.`,
    artifacts: [
      {
        kind: "log",
        inlineJson: {
          operation,
          script,
          reason: error ?? "Blender MCP is not connected."
        }
      }
    ],
    completedAt: new Date().toISOString()
  };
}

function createFailedResult(operation: JsonOperation, message: string): OperationResult {
  return {
    operationId: operation.id,
    status: "failed",
    summary: message,
    artifacts: [
      {
        kind: "log",
        inlineJson: {
          operation,
          reason: message
        }
      }
    ],
    error: message,
    completedAt: new Date().toISOString()
  };
}

function tryBuildFallbackScript(operation: JsonOperation): string | undefined {
  try {
    return buildBlenderPythonScript(operation as unknown as BlenderOperation);
  } catch {
    return undefined;
  }
}

function createFallbackTools(): readonly Record<string, unknown>[] {
  return [
    {
      name: "pipelinekit.execute_operation",
      description: "Dev fallback seam for executing PipelineKit Blender operations."
    },
    {
      name: "pipelinekit.execute_step",
      description: "Existing PipelineKit pipeline step execution seam."
    }
  ];
}

function readMcpFailureMessage(output: unknown): string | undefined {
  return extractToolError(output);
}

async function verifyBlenderScene(client: BlenderMcpClient): Promise<void> {
  const result = await client.call({
    name: readScriptToolName(),
    arguments: {
      [readScriptArgumentName()]: [
        "import bpy",
        "result = {",
        '    "ok": True,',
        '    "scene": bpy.context.scene.name,',
        "}"
      ].join("\n")
    }
  });
  const error = extractToolError(result.output);
  if (error) {
    throw new Error(error);
  }
}

function extractToolError(output: unknown): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  if (output["isError"] === true) {
    return readToolText(output) ?? "Blender MCP reported a tool error.";
  }

  const structured = isRecord(output["structuredContent"]) ? output["structuredContent"] : undefined;
  const structuredResult = structured?.["result"];
  if (typeof structuredResult === "string" && looksLikeToolError(structuredResult)) {
    return structuredResult;
  }

  const text = readToolText(output);
  return text && looksLikeToolError(text) ? text : undefined;
}

function readToolText(output: Record<string, unknown>): string | undefined {
  const content = output["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .map((item) => (isRecord(item) && typeof item["text"] === "string" ? item["text"] : undefined))
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function looksLikeToolError(value: string): boolean {
  return /(^|\b)(error|failed|traceback|could not connect)\b/i.test(value);
}

function settingsKey(settings: SidecarSettings): string {
  return JSON.stringify({
    command: settings.blender.command,
    args: settings.blender.args
  });
}

function readMcpTimeout(): number {
  const raw = process.env["PIPELINEKIT_BLENDER_MCP_TIMEOUT_MS"];
  if (!raw) {
    return 3000;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 3000;
}

function readScriptToolName(): string {
  return process.env["PIPELINEKIT_BLENDER_MCP_SCRIPT_TOOL"] ?? "execute_blender_code";
}

function readScriptArgumentName(): string {
  return process.env["PIPELINEKIT_BLENDER_MCP_SCRIPT_ARGUMENT"] ?? "code";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function readStatus(value: unknown): OperationResult["status"] {
  return value === "succeeded" || value === "failed" || value === "skipped" ? value : "succeeded";
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOperationValidationError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
