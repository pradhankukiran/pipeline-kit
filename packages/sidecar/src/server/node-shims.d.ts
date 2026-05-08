declare module "node:http" {
  export interface IncomingMessage extends AsyncIterable<Uint8Array | string> {
    readonly method?: string;
    readonly url?: string;
    on(event: "close", listener: () => void): this;
  }

  export interface ServerResponse {
    setHeader(name: string, value: string): this;
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    write(chunk: string): boolean;
    end(chunk?: string | Uint8Array): this;
  }

  export interface Server {
    listen(port: number, host: string, callback?: () => void): this;
    address(): string | { address: string; port: number } | null;
  }

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  ): Server;
}

declare module "node:net" {
  export class Socket {
    setTimeout(timeout: number, callback?: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "close", listener: () => void): this;
    connect(port: number, host: string, callback?: () => void): this;
    write(chunk: string, encoding?: "utf8"): boolean;
    destroy(): this;
  }
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8" }
  ): Promise<void>;
  export function writeFile(path: string, data: Uint8Array): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
  export function access(path: string): Promise<void>;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export function join(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  readonly stderr: {
    write(chunk: string): boolean;
  };
};

declare const Buffer: {
  isBuffer(value: unknown): value is Uint8Array;
  from(value: string | Uint8Array): Uint8Array;
  concat(chunks: readonly Uint8Array[]): {
    toString(encoding: "utf8"): string;
  };
};
