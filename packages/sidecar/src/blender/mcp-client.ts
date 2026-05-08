// Static imports so esbuild bundles the SDK into pipelinekit-sidecar.cjs.
// Previously these were dynamic `import()` calls with a runtime string, which
// esbuild can't statically resolve — the bundle would ship without the SDK
// and connection would fail with a cryptic "module not found" message.
import { Client as McpSdkClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as McpSdkStdioTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface BlenderMcpCommand {
  readonly name: string;
  readonly arguments?: Record<string, unknown>;
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

    await client.connect(transport);
    this.client = client;
    this.transport = transport;
  }

  async listTools(): Promise<unknown> {
    await this.connect();
    return this.getClient().listTools();
  }

  async call(command: BlenderMcpCommand): Promise<BlenderMcpResult> {
    await this.connect();
    const output = await this.getClient().callTool({
      name: command.name,
      arguments: command.arguments
    });

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

  private getClient(): McpClient {
    if (!this.client) {
      throw new Error("Blender MCP client is not connected.");
    }

    return this.client;
  }
}

export class PlaceholderBlenderMcpClient extends SdkBlenderMcpClient {}

export function createBlenderMcpClient(options: BlenderMcpClientOptions): BlenderMcpClient {
  return new SdkBlenderMcpClient(options);
}

