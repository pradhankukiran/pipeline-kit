import type { IncomingMessage, ServerResponse } from "node:http";
import type { OperationArtifact, OperationResult } from "@pipelinekit/core";
import type { BlenderOperationAdapter } from "./blender-adapter.js";
import type { JsonOperation } from "./state.js";

/**
 * Parsed shape returned to the desktop UI. All fields are best-effort: the
 * inspect_scene op response is shaped by the live Blender Python script and
 * may legitimately be sparse, so callers should treat any field as
 * potentially-empty rather than guaranteed.
 */
export interface ParsedScene {
  readonly sceneName: string;
  readonly engine: string;
  readonly frame: {
    readonly current: number;
    readonly start: number;
    readonly end: number;
  };
  readonly objects: readonly { readonly type: string; readonly count: number }[];
  readonly activeCameraName: string | null;
  readonly materials: readonly { readonly name: string }[];
  readonly raw: unknown;
}

const DEFAULT_FRAME = { current: 0, start: 1, end: 250 } as const;

type JsonRecord = Record<string, unknown>;

/**
 * GET /blender/scene-info
 *
 * Polls the Blender MCP bridge via the inspect_scene typed op and reshapes
 * the result for the live "Scene state" panel. When Blender is offline the
 * handler responds 200 with `{ ok: false, connected: false, scene: null }`
 * — disconnection is a normal operating state, not a server error.
 */
export async function handleSceneInfo(
  req: IncomingMessage,
  res: ServerResponse,
  adapter: BlenderOperationAdapter
): Promise<void> {
  void req;

  if (!adapter.connected) {
    writeJson(res, 200, {
      ok: false,
      connected: false,
      scene: null,
      fetchedAt: new Date().toISOString()
    });
    return;
  }

  try {
    const operation: JsonOperation = {
      id: `scene-info-${Date.now()}`,
      projectId: "scene-info",
      type: "inspect_scene",
      params: {
        includeObjects: true,
        includeMaterials: true,
        includeRenderSettings: true
      },
      risk: "low",
      requiresApproval: false,
      createdAt: new Date().toISOString()
    };

    const result = await adapter.runOperation(operation);

    if (!adapter.connected || result.status === "skipped") {
      writeJson(res, 200, {
        ok: false,
        connected: false,
        scene: null,
        fetchedAt: new Date().toISOString()
      });
      return;
    }

    if (result.status === "failed") {
      writeJson(res, 200, {
        ok: false,
        connected: true,
        scene: null,
        fetchedAt: new Date().toISOString(),
        error: result.error ?? result.summary ?? "inspect_scene failed."
      });
      return;
    }

    const parsed = parseSceneFromResult(result);
    writeJson(res, 200, {
      ok: true,
      connected: true,
      scene: parsed,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      connected: adapter.connected,
      scene: null,
      fetchedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Walks the OperationResult artifacts to find the inspect_scene payload. The
 * Python wrapper prints `{operation, report}` to stdout, which the MCP server
 * surfaces under `output.content[].text` and (sometimes) `structuredContent`.
 * We probe both, plus the scene_report artifact, before falling back to safe
 * defaults.
 */
function parseSceneFromResult(result: OperationResult): ParsedScene {
  const report = extractReportFromArtifacts(result.artifacts);
  return reshapeReport(report);
}

function extractReportFromArtifacts(
  artifacts: readonly OperationArtifact[] | undefined
): JsonRecord | undefined {
  if (!artifacts) {
    return undefined;
  }

  const candidates: unknown[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === "scene_report" || artifact.kind === "log") {
      candidates.push(artifact.inlineJson);
    }
  }

  for (const candidate of candidates) {
    const report = readReportFromMcpOutput(candidate);
    if (report) {
      return report;
    }
  }

  return undefined;
}

function readReportFromMcpOutput(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  // Direct shape: { report: {...} }
  if (isRecord(value["report"])) {
    return value["report"];
  }

  // Wrapped log artifact shape: { command, output: { ... } }
  const output = value["output"];
  if (isRecord(output)) {
    const fromOutput = readReportFromMcpOutput(output);
    if (fromOutput) {
      return fromOutput;
    }
  }

  // structuredContent shape: { structuredContent: { result: <json string|obj> } }
  const structured = isRecord(value["structuredContent"]) ? value["structuredContent"] : undefined;
  if (structured) {
    const direct = readReportFromMcpOutput(structured);
    if (direct) {
      return direct;
    }
    const sResult = structured["result"];
    const parsed = parseMaybeJson(sResult);
    if (isRecord(parsed)) {
      const fromParsed = readReportFromMcpOutput(parsed);
      if (fromParsed) {
        return fromParsed;
      }
    }
  }

  // content[].text: each entry's `text` is a JSON-encoded payload.
  const content = value["content"];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      const text = item["text"];
      const parsed = parseMaybeJson(text);
      if (isRecord(parsed)) {
        const inner = readReportFromMcpOutput(parsed);
        if (inner) {
          return inner;
        }
      }
    }
  }

  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function reshapeReport(report: JsonRecord | undefined): ParsedScene {
  const renderSettings = report ? readRecord(report["renderSettings"]) : undefined;
  const frame = report ? readFrame(report["frame"]) : DEFAULT_FRAME;

  return {
    sceneName: readString(report?.["scene"], "Untitled scene"),
    engine: readString(renderSettings?.["engine"], "UNKNOWN"),
    frame,
    objects: groupObjects(report?.["objects"]),
    activeCameraName: readNullableString(renderSettings?.["camera"]),
    materials: readMaterials(report?.["materials"]),
    raw: report ?? null
  };
}

function readFrame(value: unknown): ParsedScene["frame"] {
  if (!isRecord(value)) {
    return DEFAULT_FRAME;
  }
  return {
    current: readNumber(value["current"], DEFAULT_FRAME.current),
    start: readNumber(value["start"], DEFAULT_FRAME.start),
    end: readNumber(value["end"], DEFAULT_FRAME.end)
  };
}

function groupObjects(value: unknown): readonly { type: string; count: number }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const type = typeof entry["type"] === "string" ? entry["type"] : "OTHER";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (b.count - a.count) || a.type.localeCompare(b.type));
}

function readMaterials(value: unknown): readonly { name: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry };
      }
      if (isRecord(entry) && typeof entry["name"] === "string") {
        return { name: entry["name"] };
      }
      return null;
    })
    .filter((entry): entry is { name: string } => entry !== null);
}

function readRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(response: ServerResponse, statusCode: number, body: JsonRecord): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body, null, 2));
}
