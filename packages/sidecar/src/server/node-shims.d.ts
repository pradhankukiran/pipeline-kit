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
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }

  export interface Stats {
    size: number;
    mtimeMs: number;
  }

  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8" }
  ): Promise<void>;
  export function writeFile(path: string, data: Uint8Array): Promise<void>;
  export function appendFile(
    path: string,
    data: string,
    options: { encoding: "utf8" }
  ): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
  export function access(path: string): Promise<void>;
  export function realpath(path: string): Promise<string>;
  export function readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<Dirent[]>;
  export function readdir(path: string): Promise<string[]>;
  export function stat(path: string): Promise<Stats>;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export const sep: string;
  export function join(...segments: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function relative(from: string, to: string): string;
  export function resolve(...segments: string[]): string;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  readonly stderr: {
    write(chunk: string): boolean;
  };
};

/**
 * Hand-rolled `Buffer` global. Returns a `Uint8Array`-compatible value that
 * also exposes the encoding-aware `toString` overloads we use across the
 * sidecar (`"utf8"` for HTTP body assembly, `"base64"` for image payloads in
 * the OpenAI-compatible provider).
 *
 * The toString overload list keeps the parameterless variant first so the
 * value remains structurally assignable to `Uint8Array` (whose own
 * `toString(): string` would otherwise be incompatible with a stricter
 * encoding-required signature).
 */
interface NodeBuffer extends Uint8Array {
  toString(): string;
  toString(encoding: "utf8" | "base64"): string;
}

declare const Buffer: {
  isBuffer(value: unknown): value is NodeBuffer;
  from(value: string | Uint8Array): NodeBuffer;
  concat(chunks: readonly Uint8Array[]): NodeBuffer;
};
