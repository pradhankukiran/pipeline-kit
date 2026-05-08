import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * URL prefix used by the sidecar to serve rendered images on disk.
 *
 * `/renders/<runId>/<opId>.png` resolves to a file under {@link getRenderDir}.
 */
export const RENDER_ROUTE_PREFIX = "/renders";

/**
 * Returns the absolute directory in which render outputs are stored.
 *
 * Honours `PIPELINEKIT_RENDER_DIR` when set to a non-empty value, falling back
 * to `~/.pipelinekit/renders`. The same default is used by the Blender Python
 * snippet emitted from `operation-runner.ts` for `render_shot`.
 */
export function getRenderDir(): string {
  const override = process.env["PIPELINEKIT_RENDER_DIR"];
  if (typeof override === "string" && override.trim().length > 0) {
    return override.trim();
  }

  return join(homedir(), ".pipelinekit", "renders");
}

/**
 * Ensures the render directory exists. Safe to call repeatedly. Intended for
 * one-shot use at sidecar boot so subsequent reads/writes never need to mkdir.
 */
export async function ensureRenderDir(): Promise<void> {
  await mkdir(getRenderDir(), { recursive: true });
}

/**
 * Resolves a request-supplied relative path (e.g. `<runId>/<opId>.png`) to an
 * absolute path inside the render directory.
 *
 * Returns `null` when the request escapes the render dir (path-traversal via
 * `..`, absolute paths, drive letters, NUL bytes, ...). The implementation is
 * deliberately defensive — we never feed an attacker-influenced path to the
 * filesystem without first proving it stays under {@link getRenderDir}.
 */
export function resolveRenderPath(relativePath: string): string | null {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return null;
  }

  // Reject NUL bytes outright — some platforms truncate paths at \0.
  if (relativePath.includes("\0")) {
    return null;
  }

  // Decode percent-encoding once so attackers can't smuggle `..` through
  // `%2E%2E`. If decoding fails we treat it as malformed.
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  if (decoded.length === 0) {
    return null;
  }

  // Normalize separators across OSes; we only allow forward slashes in the
  // wire format so `\` in input is treated as a path separator too.
  const normalizedInput = decoded.replace(/\\/g, "/");

  // Reject any segment containing `..` to prevent traversal. We do this by
  // examining each path segment rather than relying solely on path.resolve so
  // the rule is independent of the host OS path semantics.
  const segments = normalizedInput.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return null;
    }
  }

  // Reject absolute paths (Unix `/foo`) and Windows-style drive prefixes
  // (`C:\foo`, `C:/foo`). We reject by checking the original decoded input
  // before segment normalization.
  if (decoded.startsWith("/") || decoded.startsWith("\\")) {
    return null;
  }
  if (/^[A-Za-z]:[\/\\]/.test(decoded)) {
    return null;
  }

  const renderDir = getRenderDir();
  const absolute = join(renderDir, ...segments);

  // Final containment check. After joining, the absolute path must still be
  // a descendant of the render dir.
  const dirWithSep = renderDir.endsWith("/") || renderDir.endsWith("\\")
    ? renderDir
    : renderDir + "/";
  const dirWithBackslashSep = renderDir.endsWith("\\") ? renderDir : renderDir + "\\";
  if (!absolute.startsWith(dirWithSep) && !absolute.startsWith(dirWithBackslashSep)) {
    return null;
  }

  return absolute;
}
