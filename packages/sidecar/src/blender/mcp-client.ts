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

    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      loadMcpClientModule(),
      loadMcpStdioModule()
    ]);

    const client = new Client(
      { name: "pipelinekit-sidecar", version: "0.1.0" },
      { capabilities: {} }
    );
    const transport = new StdioClientTransport({
      command: this.options.command,
      args: this.options.args
    });

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

async function loadMcpClientModule(): Promise<Required<Pick<McpClientModule, "Client">>> {
  const moduleName = "@modelcontextprotocol/sdk/client/index.js";
  try {
    const module = (await import(moduleName)) as McpClientModule;
    if (typeof module.Client !== "function") {
      throw new Error(`${moduleName} does not export Client.`);
    }

    return { Client: module.Client };
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new Error(
        "@modelcontextprotocol/sdk is required for Blender MCP integration. Install it in @pipelinekit/sidecar before creating a Blender MCP client."
      );
    }

    throw error;
  }
}

async function loadMcpStdioModule(): Promise<
  Required<Pick<McpStdioModule, "StdioClientTransport">>
> {
  const moduleName = "@modelcontextprotocol/sdk/client/stdio.js";
  try {
    const module = (await import(moduleName)) as McpStdioModule;
    if (typeof module.StdioClientTransport !== "function") {
      throw new Error(`${moduleName} does not export StdioClientTransport.`);
    }

    return { StdioClientTransport: module.StdioClientTransport };
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new Error(
        "@modelcontextprotocol/sdk is required for Blender MCP stdio transport. Install it in @pipelinekit/sidecar before creating a Blender MCP client."
      );
    }

    throw error;
  }
}

function isModuleNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND";
}
