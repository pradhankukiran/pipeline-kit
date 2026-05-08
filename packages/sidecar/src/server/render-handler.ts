import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveRenderPath } from "./render-store.js";

/**
 * Five-minute browser cache. Renders are immutable per `(runId, opId)` so a
 * short positive TTL is safe — a fresh render produces a new `opId` and thus a
 * new URL. We avoid `immutable` because the file may be regenerated under the
 * same id during development.
 */
const CACHE_CONTROL = "public, max-age=300";

/**
 * Maps file extensions (lowercase, no dot) to MIME types we serve. Anything
 * outside this list falls back to `application/octet-stream` so the browser
 * downloads rather than mis-interprets it.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  exr: "image/x-exr"
};

/**
 * Handles `GET /renders/<relativePath>`.
 *
 * @param pathParam - the path portion AFTER `/renders/`, e.g. `run-abc/op-1.png`.
 *
 * Behaviour:
 *  - Path-traversal sanitised via {@link resolveRenderPath}; invalid paths -> 404.
 *  - Missing files (`ENOENT`) return 404 with `{ ok: false, error: "not found" }`.
 *  - Successful reads return the raw bytes with `Content-Type`, `Content-Length`,
 *    and a 5-minute `Cache-Control` header.
 *  - Any other error returns 500 with `{ ok: false, error }`.
 */
export async function handleRenderRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathParam: string
): Promise<void> {
  void req;

  const absolute = resolveRenderPath(pathParam);
  if (absolute === null) {
    writeJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  let body: Uint8Array;
  try {
    body = await readFile(absolute);
  } catch (error) {
    if (isFileNotFound(error)) {
      writeJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { ok: false, error: message });
    return;
  }

  const contentType = mimeFromPath(absolute);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(body.byteLength),
    "Cache-Control": CACHE_CONTROL
  });
  res.end(body);
}

function mimeFromPath(absolutePath: string): string {
  const dot = absolutePath.lastIndexOf(".");
  if (dot < 0 || dot === absolutePath.length - 1) {
    return "application/octet-stream";
  }
  const ext = absolutePath.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
}
