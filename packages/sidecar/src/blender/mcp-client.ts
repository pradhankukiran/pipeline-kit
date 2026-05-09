// Static imports so esbuild bundles the SDK into pipelinekit-sidecar.cjs.
// Previously these were dynamic `import()` calls with a runtime string, which
// esbuild can't statically resolve — the bundle would ship without the SDK
// and connection would fail with a cryptic "module not found" message.
import { Client as McpSdkClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as McpSdkStdioTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Socket } from "node:net";

export interface BlenderMcpCommand {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
  /**
   * Optional fire-and-forget progress callback. The transport scans any
   * pre-final-envelope bytes line-by-line and invokes this for each line that
   * looks like a Blender render progress chunk (Fra:/Sample/Tile/etc.). The
   * SDK stdio transport does not currently surface progress; only the direct
   * socket transport supports this.
   */
  readonly onProgress?: (chunk: string) => void;
}

export interface BlenderMcpResult {
  readonly command: string;
  readonly output: unknown;
}

export interface BlenderMcpClient {
  connect(): Promise<void>;
  listTools(): Promise<unknown>;
  call(command: BlenderMcpCommand): Promise<BlenderMcpResult>;
  close(): Promise<void>;
  /**
   * Best-effort abort of any in-flight `connect`/`listTools`/`call`. Tears
   * down the underlying socket / SDK client and rejects pending promises with
   * an error whose message starts with `"Blender call aborted"`. Subsequent
   * calls reopen the transport fresh. The optional `reason` is included in
   * the rejection message so callers can distinguish "run cancelled" from
   * other tear-down causes.
   *
   * SAFETY: this only affects the sidecar-side socket / SDK call. It does
   * NOT interrupt the bpy script that's still running inside Blender — the
   * Blender process keeps executing whatever Python it was given until that
   * Python finishes naturally. Aborting here just makes the orchestrator stop
   * waiting for the result so the user can move on.
   */
  abort(reason?: string): void;
}

export interface BlenderMcpClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
}

interface McpClientModule {
  readonly Client?: new (info: McpClientInfo, options?: McpClientOptions) => McpClient;
}

interface McpStdioModule {
  readonly StdioClientTransport?: new (options: StdioTransportOptions) => McpTransport;
}

interface McpClientInfo {
  readonly name: string;
  readonly version: string;
}

interface McpClientOptions {
  readonly capabilities?: Record<string, unknown>;
}

interface StdioTransportOptions {
  readonly command: string;
  readonly args?: readonly string[];
}

interface McpTransport {
  readonly close?: () => Promise<void> | void;
}

interface McpClient {
  readonly connect: (transport: McpTransport) => Promise<void>;
  readonly listTools: () => Promise<unknown>;
  readonly callTool: (request: McpCallToolRequest) => Promise<unknown>;
  readonly close?: () => Promise<void> | void;
}

interface McpCallToolRequest {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
}

export class SdkBlenderMcpClient implements BlenderMcpClient {
  private readonly options: BlenderMcpClientOptions;
  private client?: McpClient;
  private transport?: McpTransport;
  /**
   * Tracks promise rejecters for in-flight `listTools`/`call` invocations.
   * `abort()` walks this set and rejects each one with a `Blender call
   * aborted` error so the calling orchestrator unblocks immediately. The
   * underlying SDK call may keep running until it sees the closed transport
   * — the rejection here is sidecar-side only.
   */
  private readonly pendingRejecters = new Set<(error: Error) => void>();

  constructor(options: BlenderMcpClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = new McpSdkClient(
      { name: "pipelinekit-sidecar", version: "0.1.0" },
      { capabilities: {} }
    ) as unknown as McpClient;
    const transport = new McpSdkStdioTransport({
      command: this.options.command,
      args: this.options.args ? [...this.options.args] : undefined
    }) as unknown as McpTransport;

    await this.trackPending(client.connect(transport));
    this.client = client;
    this.transport = transport;
  }

  async listTools(): Promise<unknown> {
    await this.connect();
    return this.trackPending(this.getClient().listTools());
  }

  async call(command: BlenderMcpCommand): Promise<BlenderMcpResult> {
    await this.connect();
    const output = await this.trackPending(
      this.getClient().callTool({
        name: command.name,
        arguments: command.arguments
      })
    );

    return {
      command: command.name,
      output
    };
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;

    await client?.close?.();
    await transport?.close?.();
  }

  abort(reason?: string): void {
    const message = `Blender call aborted${reason ? `: ${reason}` : ""}`;
    const error = new Error(message);
    error.name = "AbortError";

    // Snapshot before iteration so reject handlers can mutate the set
    // safely (they always remove their own entry in the `finally` clause
    // tied to `trackPending`).
    const rejecters = [...this.pendingRejecters];
    this.pendingRejecters.clear();
    for (const reject of rejecters) {
      try {
        reject(error);
      } catch {
        // Reject handlers are framework-managed and shouldn't throw, but
        // swallow if they do — tearing down the transport is more important
        // than a clean rejection log.
      }
    }

    // Drop the live transport so subsequent calls reopen fresh.
    void this.client?.close?.();
    void this.transport?.close?.();
    this.client = undefined;
    this.transport = undefined;
  }

  /**
   * Wraps a promise so a future `abort()` call can reject it with an
   * `AbortError`. Whichever resolves first wins; the inner promise still
   * runs to completion in the background. Adds the local rejecter to
   * `pendingRejecters` for the lifetime of the wrapper.
   */
  private trackPending<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingRejecters.add(reject);
      promise.then(
        (value) => {
          this.pendingRejecters.delete(reject);
          resolve(value);
        },
        (error: unknown) => {
          this.pendingRejecters.delete(reject);
          reject(error);
        }
      );
    });
  }

  private getClient(): McpClient {
    if (!this.client) {
      throw new Error("Blender MCP client is not connected.");
    }

    return this.client;
  }
}

export class PlaceholderBlenderMcpClient extends SdkBlenderMcpClient {}

export function createBlenderMcpClient(options: BlenderMcpClientOptions): BlenderMcpClient {
  if (shouldUseDirectSocket(options)) {
    return new DirectBlenderSocketClient({
      host: process.env["PIPELINEKIT_BLENDER_SOCKET_HOST"] ?? "127.0.0.1",
      port: readPort(process.env["PIPELINEKIT_BLENDER_SOCKET_PORT"], 9876),
      timeoutMs: readPort(process.env["PIPELINEKIT_BLENDER_SOCKET_TIMEOUT_MS"], 5000)
    });
  }

  return new SdkBlenderMcpClient(options);
}

interface DirectBlenderSocketClientOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
}

interface PendingDirectCall {
  readonly socket: Socket;
  readonly reject: (error: Error) => void;
}

class DirectBlenderSocketClient implements BlenderMcpClient {
  private readonly options: DirectBlenderSocketClientOptions;
  private connected = false;
  /**
   * Live in-flight `execute` invocations. Each entry pairs the underlying
   * `Socket` (so `abort()` can destroy it) with the promise rejecter (so
   * `abort()` can reject the wrapper). Entries are added at the top of
   * `execute` and removed inside the shared `finish` helper.
   */
  private readonly pending = new Set<PendingDirectCall>();

  constructor(options: DirectBlenderSocketClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    await this.execute("print('PipelineKit Blender socket connection check')");
    this.connected = true;
  }

  async listTools(): Promise<unknown> {
    await this.connect();
    return {
      tools: [
        {
          name: "execute_blender_code",
          description: "Execute Python code in Blender via the local Blender socket add-on."
        },
        {
          name: "get_scene_info",
          description: "Read basic scene information from Blender."
        }
      ]
    };
  }

  async call(command: BlenderMcpCommand): Promise<BlenderMcpResult> {
    const code = command.name === "get_scene_info" ? sceneInfoScript() : readCodeArgument(command);
    const output = await this.execute(code, command.onProgress);
    this.connected = true;

    return {
      command: command.name,
      output: toMcpLikeOutput(output)
    };
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  abort(reason?: string): void {
    if (this.pending.size === 0) {
      this.connected = false;
      return;
    }
    const message = `Blender call aborted${reason ? `: ${reason}` : ""}`;
    const error = new Error(message);
    error.name = "AbortError";

    // Snapshot first; the `finish` helper removes the entry from `pending`
    // inside the destroy callback so iterating live would skip rejecters.
    const entries = [...this.pending];
    this.pending.clear();
    for (const entry of entries) {
      try {
        entry.socket.destroy();
      } catch {
        /* destroy is best-effort; pressing on with the rejection */
      }
      try {
        entry.reject(error);
      } catch {
        /* ditto — never let a misbehaving consumer stop the abort sweep */
      }
    }
    this.connected = false;
  }

  private execute(
    code: string,
    onProgress?: (chunk: string) => void
  ): Promise<DirectBlenderResponse> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Uint8Array[] = [];
      // Holds a partial trailing line across multiple data events so we never
      // mis-classify a half-arrived progress line. Reset on every newline.
      let lineBuffer = "";
      let settled = false;
      const pendingEntry: PendingDirectCall = { socket, reject };
      this.pending.add(pendingEntry);

      const scanForProgress = (text: string): void => {
        if (!onProgress) {
          return;
        }
        // Only forward lines that look like Blender render progress. The
        // final NUL-terminated JSON envelope is intentionally excluded
        // because (a) it doesn't match these patterns and (b) it never
        // arrives line-by-line — `data` only contains it once NUL appears.
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed.length === 0) {
            continue;
          }
          if (looksLikeBlenderProgress(trimmed)) {
            try {
              onProgress(trimmed);
            } catch {
              // Fire-and-forget: a misbehaving consumer must never abort
              // the underlying socket call.
            }
          }
        }
      };

      const finish = (error?: Error, response?: DirectBlenderResponse) => {
        if (settled) {
          return;
        }
        settled = true;
        this.pending.delete(pendingEntry);
        socket.destroy();
        if (error) {
          reject(error);
        } else {
          resolve(response ?? { status: "ok" });
        }
      };

      socket.setTimeout(this.options.timeoutMs, () => {
        finish(
          new Error(
            `Blender socket timed out after ${this.options.timeoutMs}ms at ${this.options.host}:${this.options.port}.`
          )
        );
      });
      socket.on("error", (error) => finish(error));
      socket.on("data", (chunk) => {
        chunks.push(chunk);
        const hasTerminator = chunk.includes(0);

        // Best-effort line-based progress scan on the not-yet-terminal bytes.
        // We strip the NUL byte (and anything past it, which would be the
        // start of the JSON envelope) so the envelope never reaches the
        // progress callback. `Buffer.concat([chunk])` is a no-op copy used
        // here only to obtain a Buffer with a typed `toString("utf8")`.
        if (onProgress) {
          let text = Buffer.concat([chunk]).toString("utf8");
          const nulIdx = text.indexOf("\0");
          if (nulIdx >= 0) {
            text = text.slice(0, nulIdx);
          }
          if (text.length > 0) {
            const combined = lineBuffer + text;
            const newlineIdx = combined.lastIndexOf("\n");
            if (newlineIdx >= 0) {
              const complete = combined.slice(0, newlineIdx);
              lineBuffer = combined.slice(newlineIdx + 1);
              scanForProgress(complete);
            } else {
              lineBuffer = combined;
            }
          }
          if (hasTerminator) {
            // Any trailing pre-NUL line that didn't end with `\n`.
            if (lineBuffer.length > 0) {
              scanForProgress(lineBuffer);
              lineBuffer = "";
            }
          }
        }

        if (hasTerminator) {
          finish(undefined, parseDirectResponse(Buffer.concat(chunks)));
        }
      });
      socket.on("close", () => {
        if (!settled && chunks.length > 0) {
          finish(undefined, parseDirectResponse(Buffer.concat(chunks)));
        }
      });
      socket.connect(this.options.port, this.options.host, () => {
        const request = JSON.stringify({
          type: "execute",
          code,
          strict_json: false
        });
        socket.write(`${request}\0`, "utf8");
      });
    });
  }
}

/**
 * Heuristic match for a single Blender progress line. Mirrors the patterns
 * Blender prints during a render:
 *   - `Fra:1 Mem:... Sce: Scene` (frame header)
 *   - `Rendered 23 Tiles, ...`
 *   - `Sample 64/256` (Cycles progressive)
 *   - `Tile 23/64` (older Cycles tile mode)
 *   - `Compositing | Tile 5-23` (compositor)
 *   - `Saved: '<path>' Time: 00:01.23` (final write-out line)
 * Case-insensitive. Used by the direct socket transport's progress scanner;
 * intentionally permissive — false positives just become extra UI ticks.
 */
export function looksLikeBlenderProgress(line: string): boolean {
  return /^Fra:|^\s*Rendered \d+|Sample \d+\/\d+|Tile \d+\/\d+|^Compositing|^Saved:/i.test(line);
}

interface DirectBlenderResponse {
  readonly status: string;
  readonly result?: unknown;
  readonly message?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

function parseDirectResponse(buffer: { toString(encoding: "utf8"): string }): DirectBlenderResponse {
  const raw = buffer.toString("utf8").replace(/\0+$/g, "").trim();
  if (!raw) {
    throw new Error("Blender socket returned an empty response.");
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Blender socket returned a non-object response.");
  }

  const status = typeof parsed["status"] === "string" ? parsed["status"] : "ok";
  const response: DirectBlenderResponse = {
    status,
    result: parsed["result"],
    message: typeof parsed["message"] === "string" ? parsed["message"] : undefined,
    stdout: typeof parsed["stdout"] === "string" ? parsed["stdout"] : undefined,
    stderr: typeof parsed["stderr"] === "string" ? parsed["stderr"] : undefined
  };

  if (response.status === "error") {
    throw new Error(response.message ?? response.stderr ?? "Blender socket reported an error.");
  }

  return response;
}

function toMcpLikeOutput(response: DirectBlenderResponse): Record<string, unknown> {
  const text = [response.stdout, response.stderr].filter(Boolean).join("\n").trim();
  return {
    content: text ? [{ type: "text", text }] : [],
    structuredContent: {
      result: text,
      blender: response.result ?? null
    },
    raw: response
  };
}

function readCodeArgument(command: BlenderMcpCommand): string {
  const args = command.arguments ?? {};
  const code = args["code"] ?? args["python"] ?? args["script"];
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error(`Blender command ${command.name} requires a non-empty code argument.`);
  }

  return code;
}

function sceneInfoScript(): string {
  return `import bpy
import json

report = {
    "scene": bpy.context.scene.name,
    "objects": [{"name": o.name, "type": o.type} for o in bpy.context.scene.objects],
    "materials": sorted([m.name for m in bpy.data.materials]),
    "renderSettings": {
        "engine": bpy.context.scene.render.engine,
        "resolution": [bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y],
        "camera": bpy.context.scene.camera.name if bpy.context.scene.camera else None,
    },
}
print(json.dumps({"status": "ok", "report": report}, sort_keys=True))
`;
}

function shouldUseDirectSocket(options: BlenderMcpClientOptions): boolean {
  if (process.env["PIPELINEKIT_BLENDER_MCP_FORCE_STDIO"] === "1") {
    return false;
  }

  if (options.command === "blender-socket") {
    return true;
  }

  return false;
}

function readPort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
