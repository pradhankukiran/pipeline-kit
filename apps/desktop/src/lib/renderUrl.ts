import { sidecarBaseUrl } from "@/sidecarApi";

/**
 * Converts a sidecar-emitted absolute render path into a URL the UI can fetch.
 *
 * The sidecar writes renders under `${PIPELINEKIT_RENDER_DIR}/<runId>/<opId>.png`
 * (defaulting to `~/.pipelinekit/renders`). The desktop has no view of that
 * absolute root, but the render dir always contains a literal `renders`
 * segment — so we strip everything up to and including the last
 * `/renders/` (or `\renders\` on Windows) and prefix with the sidecar URL.
 *
 * Returns `null` for falsy input or when the path doesn't contain a
 * `/renders/` segment (i.e. it's not coming from our render store).
 *
 * Examples:
 *   "/home/kiran/.pipelinekit/renders/run-abc/op-1.png"
 *     -> "http://127.0.0.1:4317/renders/run-abc/op-1.png"
 *   "C:\\Users\\me\\.pipelinekit\\renders\\run-abc\\op-1.png"
 *     -> "http://127.0.0.1:4317/renders/run-abc/op-1.png"
 */
export function renderUrlFromOutputPath(p: string | undefined | null): string | null {
  if (!p || typeof p !== "string") {
    return null;
  }

  const match = p.match(/[\/\\]renders[\/\\](.+)$/);
  if (!match) {
    return null;
  }

  const relative = match[1].replace(/\\/g, "/");
  return `${sidecarBaseUrl}/renders/${relative}`;
}

/**
 * Best-effort extraction of the render `outputPath` from an arbitrary
 * operation record. Operations come from the sidecar in a few different
 * shapes — top-level `outputPath`, nested under `result.metadata.outputPath`,
 * or stringified into `result.detail` JSON. We try each in turn.
 *
 * Returns `null` when no path can be found.
 */
export function inferOutputPath(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;

  // Top-level outputPath
  const top = record["outputPath"];
  if (typeof top === "string" && top.length > 0) {
    return top;
  }

  // result.metadata.outputPath
  const result = record["result"];
  if (result && typeof result === "object") {
    const resultRecord = result as Record<string, unknown>;
    const metadata = resultRecord["metadata"];
    if (metadata && typeof metadata === "object") {
      const meta = metadata as Record<string, unknown>;
      const candidate = meta["outputPath"];
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }

    // result.outputPath
    const direct = resultRecord["outputPath"];
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }

    // result.detail might be a JSON-encoded string with { path | outputPath }.
    const detail = resultRecord["detail"];
    const fromDetail = parsePathFromDetail(detail);
    if (fromDetail) {
      return fromDetail;
    }
  }

  // Top-level detail (e.g. flattened OperationRecord)
  const detail = record["detail"];
  const fromDetail = parsePathFromDetail(detail);
  if (fromDetail) {
    return fromDetail;
  }

  return null;
}

function parsePathFromDetail(detail: unknown): string | null {
  if (typeof detail !== "string" || detail.length === 0) {
    return null;
  }

  // Try JSON parse first.
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const candidate = obj["outputPath"] ?? obj["path"];
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
  } catch {
    // Not JSON — fall through to the literal-path heuristic.
  }

  // Heuristic: a substring that looks like an absolute path containing
  // /renders/ or \renders\ pointing at an image file.
  const match = detail.match(/[\/\\][^\s"']*[\/\\]renders[\/\\][^\s"']+\.(?:png|jpe?g|exr)/i);
  if (match) {
    return match[0];
  }

  return null;
}
