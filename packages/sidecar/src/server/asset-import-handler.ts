import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fetchPolyHavenFiles, type PolyHavenFiles } from "@pipelinekit/assets";
import {
  buildAssetImportPython,
  type AssetImportInput
} from "../blender/asset-import-codegen.js";
import type { BlenderOperationAdapter } from "./blender-adapter.js";

const DOWNLOAD_TIMEOUT_MS = 30_000;
const VALID_KINDS = new Set(["hdri", "material"]);
const VALID_RESOLUTIONS = new Set(["1k", "2k", "4k"]);

type ImportKind = "hdri" | "material";
type ImportResolution = "1k" | "2k" | "4k";

interface ParsedImportRequest {
  readonly source: "polyhaven";
  readonly id: string;
  readonly kind: ImportKind;
  readonly resolution: ImportResolution;
}

interface DownloadedFile {
  readonly localPath: string;
  readonly url: string;
}

export async function handleAssetImport(
  _req: IncomingMessage,
  res: ServerResponse,
  adapter: BlenderOperationAdapter,
  body: unknown
): Promise<void> {
  const parsed = parseRequest(body);
  if (!parsed.ok) {
    writeJson(res, 400, { ok: false, error: parsed.error });
    return;
  }

  if (!adapter.isConnected) {
    writeJson(res, 503, { ok: false, error: "Blender MCP not connected" });
    return;
  }

  const { id, kind, resolution } = parsed.value;

  let files: PolyHavenFiles;
  try {
    files = await fetchPolyHavenFiles(id);
  } catch (error) {
    writeJson(res, 404, {
      ok: false,
      error: `Poly Haven asset not found: ${id} (${errorMessage(error)})`
    });
    return;
  }

  try {
    if (kind === "hdri") {
      await handleHdri(res, adapter, id, files, resolution);
      return;
    }

    if (kind === "material") {
      await handleMaterial(res, adapter, id, files, resolution);
      return;
    }
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: errorMessage(error)
    });
  }
}

async function handleHdri(
  res: ServerResponse,
  adapter: BlenderOperationAdapter,
  slug: string,
  files: PolyHavenFiles,
  resolution: ImportResolution
): Promise<void> {
  const hdriEntry = pickPolyHavenFileEntry(files, ["hdri"], resolution, ["hdr", "exr"]);
  if (!hdriEntry) {
    writeJson(res, 404, {
      ok: false,
      error: `No HDRI file found for ${slug} at ${resolution}.`
    });
    return;
  }

  const downloaded = await downloadAssetFile({
    slug,
    resolution,
    url: hdriEntry.url,
    filename: deriveFilename(hdriEntry.url, `${slug}_${resolution}.${hdriEntry.format}`)
  });

  const code = buildAssetImportPython({
    kind: "hdri",
    slug,
    localPath: downloaded.localPath,
    strength: 1.0
  } satisfies AssetImportInput);

  try {
    await adapter.runPython(code);
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      kind: "hdri",
      slug,
      localPath: downloaded.localPath,
      error: errorMessage(error)
    });
    return;
  }

  writeJson(res, 200, {
    ok: true,
    kind: "hdri",
    slug,
    localPath: downloaded.localPath,
    message: "Imported to scene"
  });
}

async function handleMaterial(
  res: ServerResponse,
  adapter: BlenderOperationAdapter,
  slug: string,
  files: PolyHavenFiles,
  resolution: ImportResolution
): Promise<void> {
  const channels: Array<{
    readonly key: "diffuse" | "roughness" | "normal" | "ao";
    readonly mapNames: readonly string[];
    readonly formats: readonly string[];
  }> = [
    { key: "diffuse", mapNames: ["Diffuse", "diffuse", "Diff", "albedo", "Albedo"], formats: ["jpg", "png"] },
    { key: "roughness", mapNames: ["Rough", "Roughness", "rough"], formats: ["jpg", "png"] },
    { key: "normal", mapNames: ["nor_gl", "Normal", "normal", "nor_dx"], formats: ["jpg", "png"] },
    { key: "ao", mapNames: ["AO", "ao"], formats: ["jpg", "png"] }
  ];

  const downloads: Partial<Record<"diffuse" | "roughness" | "normal" | "ao", DownloadedFile>> = {};

  for (const channel of channels) {
    const entry = pickPolyHavenFileEntry(files, channel.mapNames, resolution, channel.formats);
    if (!entry) {
      continue;
    }

    try {
      downloads[channel.key] = await downloadAssetFile({
        slug,
        resolution,
        url: entry.url,
        filename: deriveFilename(entry.url, `${slug}_${channel.key}_${resolution}.${entry.format}`)
      });
    } catch (error) {
      // Non-fatal: skip the channel and continue. Diffuse missing = fatal below.
      if (channel.key === "diffuse") {
        throw error;
      }
    }
  }

  if (!downloads.diffuse) {
    writeJson(res, 404, {
      ok: false,
      error: `No diffuse / albedo texture found for ${slug} at ${resolution}.`
    });
    return;
  }

  const code = buildAssetImportPython({
    kind: "material",
    slug,
    textures: {
      diffuse: downloads.diffuse.localPath,
      ...(downloads.roughness ? { roughness: downloads.roughness.localPath } : {}),
      ...(downloads.normal ? { normal: downloads.normal.localPath } : {}),
      ...(downloads.ao ? { ao: downloads.ao.localPath } : {})
    }
  } satisfies AssetImportInput);

  try {
    await adapter.runPython(code);
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      kind: "material",
      slug,
      localPath: downloads.diffuse.localPath,
      error: errorMessage(error)
    });
    return;
  }

  writeJson(res, 200, {
    ok: true,
    kind: "material",
    slug,
    localPath: downloads.diffuse.localPath,
    message: "Imported to scene"
  });
}

interface PolyHavenFileEntry {
  readonly url: string;
  readonly format: string;
}

/**
 * Walk the Poly Haven files JSON looking for the first map name + resolution +
 * format that has a `url`. The Poly Haven files API uses an irregular shape so
 * we tolerate a few variations.
 */
function pickPolyHavenFileEntry(
  files: PolyHavenFiles,
  mapNames: readonly string[],
  resolution: ImportResolution,
  formats: readonly string[]
): PolyHavenFileEntry | undefined {
  for (const mapName of mapNames) {
    const mapNode = (files as Record<string, unknown>)[mapName];
    if (!isRecord(mapNode)) {
      continue;
    }

    const resolutions = orderedResolutionFallback(resolution);
    for (const resKey of resolutions) {
      const resNode = mapNode[resKey];
      if (!isRecord(resNode)) {
        continue;
      }

      for (const format of formats) {
        const fmtNode = resNode[format];
        if (!isRecord(fmtNode)) {
          continue;
        }
        const url = fmtNode["url"];
        if (typeof url === "string" && url.length > 0) {
          return { url, format };
        }
      }
    }
  }

  return undefined;
}

function orderedResolutionFallback(resolution: ImportResolution): readonly string[] {
  // Try the requested resolution first, then fall back through the ladder.
  const ladder: ImportResolution[] = ["1k", "2k", "4k"];
  const others = ladder.filter((value) => value !== resolution);
  return [resolution, ...others];
}

interface DownloadOptions {
  readonly slug: string;
  readonly resolution: ImportResolution;
  readonly url: string;
  readonly filename: string;
}

async function downloadAssetFile(options: DownloadOptions): Promise<DownloadedFile> {
  const cacheDir = resolveAssetCacheDir(options.slug, options.resolution);
  await mkdir(cacheDir, { recursive: true });
  const localPath = join(cacheDir, options.filename);

  if (await fileExists(localPath)) {
    return { localPath, url: options.url };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(options.url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText} for ${options.url}`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, new Uint8Array(arrayBuffer));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms for ${options.url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  return { localPath, url: options.url };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveAssetCacheDir(slug: string, resolution: ImportResolution): string {
  const safeSlug = sanitizeSlug(slug);
  const safeResolution = resolution; // already validated by the request parser.
  const root = process.env["PIPELINEKIT_ASSETS_DIR"] ?? join(homedir(), ".pipelinekit", "assets");
  return join(root, safeSlug, safeResolution);
}

function sanitizeSlug(slug: string): string {
  // Conservative whitelist. Poly Haven slugs are typically lower-snake / kebab.
  if (!/^[a-zA-Z0-9_\-]+$/.test(slug)) {
    throw new Error(`Invalid asset slug: ${slug}`);
  }
  return slug;
}

function deriveFilename(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /^[A-Za-z0-9._\-]+$/.test(last)) {
      return last;
    }
  } catch {
    // ignore
  }
  return fallback;
}

interface ParseResult {
  readonly ok: true;
  readonly value: ParsedImportRequest;
}

interface ParseError {
  readonly ok: false;
  readonly error: string;
}

function parseRequest(body: unknown): ParseResult | ParseError {
  if (!isRecord(body)) {
    return { ok: false, error: "Expected a JSON object body." };
  }

  const source = body["source"];
  if (source !== "polyhaven") {
    return { ok: false, error: 'Expected source to be "polyhaven".' };
  }

  const id = body["id"];
  if (typeof id !== "string" || id.trim().length === 0) {
    return { ok: false, error: "Expected id to be a non-empty string." };
  }

  let safeId: string;
  try {
    safeId = sanitizeSlug(id.trim());
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  const kind = body["kind"];
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) {
    return { ok: false, error: 'Expected kind to be "hdri" or "material".' };
  }

  const resolutionRaw = body["resolution"];
  const resolution: ImportResolution =
    typeof resolutionRaw === "string" && VALID_RESOLUTIONS.has(resolutionRaw)
      ? (resolutionRaw as ImportResolution)
      : "2k";

  return {
    ok: true,
    value: {
      source: "polyhaven",
      id: safeId,
      kind: kind as ImportKind,
      resolution
    }
  };
}

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body, null, 2));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
