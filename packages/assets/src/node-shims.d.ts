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

  export function readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<Dirent[]>;
  export function stat(path: string): Promise<Stats>;
}

declare module "node:path" {
  export const sep: string;
  export function join(...segments: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...segments: string[]): string;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
};
