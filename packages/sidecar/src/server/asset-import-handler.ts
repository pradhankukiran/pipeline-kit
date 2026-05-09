import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fetchPolyHavenFiles, type PolyHavenFiles } from "@pipelinekit/assets";
import {
  buildAssetImportPython,
  type AssetImportInput
} from "../blender/asset-import-codegen.js";
import type { BlenderOperationAdapter } from "./blender-adapter.js";

// Ambient additions to the project's hand-rolled node shims. These declarations
// only widen the existing module surface without overriding what is already
// exported in `node-shims.d.ts`.
declare module "node:fs/promises" {
  export function realpath(path: string): Promise<string>;
}

declare module "node:path" {
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function resolve(...segments: string[]): string;
}

const DOWNLOAD_TIMEOUT_MS = 30_000;
const POLYHAVEN_KINDS = new Set(["hdri", "material", "model"]);
const LOCAL_KINDS = new Set(["hdri", "material", "model"]);
const VALID_RESOLUTIONS = new Set(["1k", "2k", "4k"]);
const MODEL_FORMATS_PRIORITY = ["gltf", "blend", "fbx"] as const;

type PolyHavenImportKind = "hdri" | "material" | "model";
type LocalImportKind = "hdri" | "material" | "model";
type ImportResolution = "1k" | "2k" | "4k";
type ModelFormat = "gltf" | "glb" | "fbx" | "blend";

interface PolyHavenImportRequest {
  readonly source: "polyhaven";
  readonly id: string;
  readonly kind: PolyHavenImportKind;
  readonly resolution: ImportResolution;
}

interface LocalMaterialTextures {
  readonly diffuse?: string;
  readonly roughness?: string;
  readonly normal?: string;
  readonly ao?: string;
}

interface LocalImportRequest {
  readonly source: "local";
  readonly path: string;
  readonly kind: LocalImportKind;
  readonly targetObjectName?: string;
  readonly materialTextures?: LocalMaterialTextures;
}

type ParsedImportRequest = PolyHavenImportRequest | LocalImportRequest;

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
    writeJson(res, parsed.statusCode ?? 400, { ok: false, error: parsed.error });
    return;
  }

  if (!adapter.isConnected) {
    writeJson(res, 503, { ok: false, error: "Blender MCP not connected" });
    return;
  }

  if (parsed.value.source === "polyhaven") {
    await handlePolyHaven(res, adapter, parsed.value);
    return;
  }

  if (parsed.value.source === "local") {
    await handleLocal(res, adapter, parsed.value);
    return;
  }
}

async function handlePolyHaven(
  res: ServerResponse,
  adapter: BlenderOperationAdapter,
  request: PolyHavenImportRequest
): Promise<void> {
  const { id, kind, resolution } = request;

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

    if (kind === "model") {
      await handlePolyHavenModel(res, adapter, id, files, resolution);
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

async function handlePolyHavenModel(
  res: ServerResponse,
  adapter: BlenderOperationAdapter,
  slug: string,
  files: PolyHavenFiles,
  resolution: ImportResolution
): Promise<void> {
  const modelEntry = pickPolyHavenModelEntry(files, resolution);
  if (!modelEntry) {
    writeJson(res, 404, {
      ok: false,
      error: `No supported 3D model file (gltf / blend / fbx) found for ${slug} at ${resolution}.`
    });
    return;
  }

  const cacheDir = resolveModelCacheDir(slug, resolution);
  await mkdir(cacheDir, { recursive: true });

  const primaryFilename = deriveFilename(
    modelEntry.url,
    `${slug}_${resolution}.${modelEntry.format}`
  );
  const primaryLocalPath = join(cacheDir, primaryFilename);

  if (!(await fileExists(primaryLocalPath))) {
    await downloadToPath(modelEntry.url, primaryLocalPath);
  }

  // GLTF models reference external textures through an `include` map (relative
  // paths -> { url, ... }). Download each sibling file alongside the .gltf so
  // the importer can resolve them. GLB embeds textures, FBX usually embeds via
  // .fbm. .blend files are self-contained.
  if (modelEntry.format === "gltf" || modelEntry.format === "fbx" || modelEntry.format === "blend") {
    for (const include of modelEntry.includes) {
      // Sanitize relative path: must not escape the cache dir.
      const relative = include.relativePath.replace(/^\/+/, "");
      if (relative.includes("..")) {
        continue;
      }
      const includePath = join(cacheDir, relative);
      const resolved = resolvePath(includePath);
      if (!resolved.startsWith(resolvePath(cacheDir))) {
        continue;
      }
      if (await fileExists(resolved)) {
        continue;
      }
      await mkdir(dirname(resolved), { recursive: true });
      try {
        await downloadToPath(include.url, resolved);
      } catch {
        // Non-fatal: missing texture is logged via Blender's importer warnings.
      }
    }
  }

  // The `gltf` Poly Haven payload may actually serve a .glb file. Use the
  // file extension to dispatch the importer correctly.
  const detected = detectModelFormat(primaryLocalPath) ?? modelEntry.format;
  const format: ModelFormat =
    detected === "gltf" || detected === "glb" || detected === "fbx" || detected === "blend"
      ? detected
      : (modelEntry.format as ModelFormat);

  const code = buildAssetImportPython({
    kind: "model",
    slug,
    localPath: primaryLocalPath,
    format
  } satisfies AssetImportInput);

  try {
    await adapter.runPython(code);
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      kind: "model",
      slug,
      localPath: primaryLocalPath,
      error: errorMessage(error)
    });
    return;
  }

  writeJson(res, 200, {
    ok: true,
    kind: "model",
    slug,
    localPath: primaryLocalPath,
    format,
    message: "Imported to scene"
  });
}

async function handleLocal(
  res: ServerResponse,
  adapter: BlenderOperationAdapter,
  request: LocalImportRequest
): Promise<void> {
  const { path: rawPath, kind, targetObjectName, materialTextures } = request;

  // Validate the primary path against the allowlist.
  let primaryPath: string;
  try {
    primaryPath = await resolveLocalPath(rawPath);
  } catch (error) {
    if (error instanceof LocalAccessError) {
      writeJson(res, error.statusCode, { ok: false, error: error.message });
      return;
    }
    writeJson(res, 500, { ok: false, error: errorMessage(error) });
    return;
  }

  const slug = deriveSlugFromPath(primaryPath);

  try {
    if (kind === "hdri") {
      const ext = extname(primaryPath).slice(1).toLowerCase();
      if (ext !== "hdr" && ext !== "exr") {
        writeJson(res, 400, {
          ok: false,
          error: `Local HDRI must end in .hdr or .exr (got .${ext}).`
        });
        return;
      }

      const code = buildAssetImportPython({
        kind: "hdri",
        slug,
        localPath: primaryPath,
        strength: 1.0
      } satisfies AssetImportInput);

      try {
        await adapter.runPython(code);
      } catch (error) {
        writeJson(res, 500, {
          ok: false,
          kind: "hdri",
          slug,
          localPath: primaryPath,
          error: errorMessage(error)
        });
        return;
      }

      writeJson(res, 200, {
        ok: true,
        kind: "hdri",
        slug,
        localPath: primaryPath,
        message: "Imported to scene"
      });
      return;
    }

    if (kind === "model") {
      const format = detectModelFormat(primaryPath);
      if (!format) {
        writeJson(res, 400, {
          ok: false,
          error: "Local model must end in .gltf, .glb, .fbx, or .blend."
        });
        return;
      }

      const code = buildAssetImportPython({
        kind: "model",
        slug,
        localPath: primaryPath,
        format
      } satisfies AssetImportInput);

      try {
        await adapter.runPython(code);
      } catch (error) {
        writeJson(res, 500, {
          ok: false,
          kind: "model",
          slug,
          localPath: primaryPath,
          format,
          error: errorMessage(error)
        });
        return;
      }

      writeJson(res, 200, {
        ok: true,
        kind: "model",
        slug,
        localPath: primaryPath,
        format,
        message: "Imported to scene"
      });
      return;
    }

    if (kind === "material") {
      if (!materialTextures || Object.keys(materialTextures).length === 0) {
        writeJson(res, 400, {
          ok: false,
          error:
            "Local material import requires materialTextures with at least one of diffuse / roughness / normal / ao."
        });
        return;
      }

      // Validate every supplied texture against the allowlist.
      const resolvedTextures: { -readonly [K in keyof LocalMaterialTextures]: string } = {};
      for (const channel of ["diffuse", "roughness", "normal", "ao"] as const) {
        const value = materialTextures[channel];
        if (!value) {
          continue;
        }
        try {
          resolvedTextures[channel] = await resolveLocalPath(value);
        } catch (error) {
          if (error instanceof LocalAccessError) {
            writeJson(res, error.statusCode, {
              ok: false,
              error: `materialTextures.${channel}: ${error.message}`
            });
            return;
          }
          writeJson(res, 500, { ok: false, error: errorMessage(error) });
          return;
        }
      }

      if (!resolvedTextures.diffuse) {
        writeJson(res, 400, {
          ok: false,
          error: "Local material import requires materialTextures.diffuse."
        });
        return;
      }

      const code = buildAssetImportPython({
        kind: "material",
        slug,
        textures: {
          diffuse: resolvedTextures.diffuse,
          ...(resolvedTextures.roughness ? { roughness: resolvedTextures.roughness } : {}),
          ...(resolvedTextures.normal ? { normal: resolvedTextures.normal } : {}),
          ...(resolvedTextures.ao ? { ao: resolvedTextures.ao } : {})
        },
        ...(targetObjectName ? { targetObjectName } : {})
      } satisfies AssetImportInput);

      try {
        await adapter.runPython(code);
      } catch (error) {
        writeJson(res, 500, {
          ok: false,
          kind: "material",
          slug,
          localPath: resolvedTextures.diffuse,
          error: errorMessage(error)
        });
        return;
      }

      writeJson(res, 200, {
        ok: true,
        kind: "material",
        slug,
        localPath: resolvedTextures.diffuse,
        message: "Imported to scene"
      });
      return;
    }
  } catch (error) {
    writeJson(res, 500, {
      ok: false,
      error: errorMessage(error)
    });
  }
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

interface PolyHavenModelEntry {
  readonly format: "gltf" | "blend" | "fbx";
  readonly url: string;
  readonly includes: readonly { readonly relativePath: string; readonly url: string }[];
}

/**
 * Poly Haven `/files/{id}` for a 3D model carries top-level `blend`, `gltf`,
 * `fbx` keys. Each leaf is `{ <format>: { <resolution>: { <format>: { url, include } } } }`
 * where `include` is a `Record<string, { url: string }>` describing sibling
 * files (textures, .bin, .mtl, etc.) keyed by their path relative to the
 * primary file. We prefer gltf > blend > fbx.
 */
function pickPolyHavenModelEntry(
  files: PolyHavenFiles,
  resolution: ImportResolution
): PolyHavenModelEntry | undefined {
  for (const format of MODEL_FORMATS_PRIORITY) {
    const formatNode = (files as Record<string, unknown>)[format];
    if (!isRecord(formatNode)) {
      continue;
    }

    for (const resKey of orderedResolutionFallback(resolution)) {
      const resNode = formatNode[resKey];
      if (!isRecord(resNode)) {
        continue;
      }

      const fileNode = resNode[format];
      if (!isRecord(fileNode)) {
        continue;
      }

      const url = fileNode["url"];
      if (typeof url !== "string" || url.length === 0) {
        continue;
      }

      const include = fileNode["include"];
      const includes: { relativePath: string; url: string }[] = [];
      if (isRecord(include)) {
        for (const [relativePath, entry] of Object.entries(include)) {
          if (!isRecord(entry)) {
            continue;
          }
          const includeUrl = entry["url"];
          if (typeof includeUrl !== "string" || includeUrl.length === 0) {
            continue;
          }
          includes.push({ relativePath, url: includeUrl });
        }
      }

      return { format, url, includes };
    }
  }

  return undefined;
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

function resolveModelCacheDir(slug: string, resolution: ImportResolution): string {
  const safeSlug = sanitizeSlug(slug);
  const root = process.env["PIPELINEKIT_ASSETS_DIR"] ?? join(homedir(), ".pipelinekit", "assets");
  return join(root, safeSlug, "model", resolution);
}

async function downloadToPath(url: string, localPath: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, new Uint8Array(arrayBuffer));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function detectModelFormat(path: string): ModelFormat | undefined {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === "gltf" || ext === "glb" || ext === "fbx" || ext === "blend") {
    return ext;
  }
  return undefined;
}

function deriveSlugFromPath(path: string): string {
  const base = basename(path, extname(path));
  const sanitized = base.replace(/[^A-Za-z0-9_\-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "asset";
}

class LocalAccessError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "LocalAccessError";
    this.statusCode = statusCode;
  }
}

function getLocalLibraryRoots(): readonly string[] {
  const roots = new Set<string>();

  // Default opt-in cache dir.
  const cacheRoot =
    process.env["PIPELINEKIT_ASSETS_DIR"] ?? join(homedir(), ".pipelinekit", "assets");
  roots.add(resolvePath(cacheRoot));

  // User-configured library roots.
  const envValue = process.env["PIPELINEKIT_ASSET_LIBRARY"];
  if (envValue) {
    for (const candidate of envValue.split(":")) {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        roots.add(resolvePath(trimmed));
      }
    }
  }

  return Array.from(roots);
}

/**
 * Validate that `inputPath` resolves (after symlink expansion) inside one of
 * the allow-listed library roots. Throws `LocalAccessError` with a 403 / 404
 * status code on failure.
 */
async function resolveLocalPath(inputPath: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(inputPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new LocalAccessError(`Local asset not found: ${inputPath}`, 404);
    }
    throw new LocalAccessError(
      `Failed to access local asset (${inputPath}): ${errorMessage(error)}`,
      500
    );
  }

  const allowedRoots = getLocalLibraryRoots();
  const resolvedRoots: string[] = [];
  for (const root of allowedRoots) {
    try {
      resolvedRoots.push(await realpath(root));
    } catch {
      // Root may not yet exist on disk (e.g. ~/.pipelinekit/assets before first
      // import). Fall back to the un-resolved path so the check still works.
      resolvedRoots.push(root);
    }
  }
  const matched = resolvedRoots.some((root) => isPathInsideRoot(real, root));
  if (!matched) {
    throw new LocalAccessError(
      `Local asset path is outside the allow-listed library roots. ` +
        `Set PIPELINEKIT_ASSET_LIBRARY to grant access (got ${real}).`,
      403
    );
  }

  try {
    await access(real);
  } catch {
    throw new LocalAccessError(`Local asset not readable: ${real}`, 404);
  }

  return real;
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = resolvePath(candidate);
  const normalizedRoot = resolvePath(root);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedCandidate.startsWith(rootWithSep);
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return undefined;
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
  readonly statusCode?: number;
}

function parseRequest(body: unknown): ParseResult | ParseError {
  if (!isRecord(body)) {
    return { ok: false, error: "Expected a JSON object body." };
  }

  const source = body["source"];
  if (source === "polyhaven") {
    return parsePolyHavenRequest(body);
  }

  if (source === "local") {
    return parseLocalRequest(body);
  }

  if (source === "procedural") {
    return {
      ok: false,
      error: "Procedural assets are recipe-driven and cannot be imported as files.",
      statusCode: 400
    };
  }

  return {
    ok: false,
    error: 'Expected source to be one of "polyhaven" or "local".'
  };
}

function parsePolyHavenRequest(body: Record<string, unknown>): ParseResult | ParseError {
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
  if (typeof kind !== "string" || !POLYHAVEN_KINDS.has(kind)) {
    return { ok: false, error: 'Expected kind to be "hdri", "material", or "model".' };
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
      kind: kind as PolyHavenImportKind,
      resolution
    }
  };
}

function parseLocalRequest(body: Record<string, unknown>): ParseResult | ParseError {
  const path = body["path"];
  if (typeof path !== "string" || path.trim().length === 0) {
    return { ok: false, error: "Expected path to be a non-empty string." };
  }

  const trimmed = path.trim();
  if (!isAbsolute(trimmed)) {
    return { ok: false, error: "Expected path to be an absolute filesystem path." };
  }

  const kind = body["kind"];
  if (typeof kind !== "string" || !LOCAL_KINDS.has(kind)) {
    return { ok: false, error: 'Expected kind to be "hdri", "material", or "model".' };
  }

  const targetObjectNameRaw = body["targetObjectName"];
  const targetObjectName =
    typeof targetObjectNameRaw === "string" && targetObjectNameRaw.length > 0
      ? targetObjectNameRaw
      : undefined;

  let materialTextures: LocalMaterialTextures | undefined;
  const texturesRaw = body["materialTextures"];
  if (texturesRaw !== undefined) {
    if (!isRecord(texturesRaw)) {
      return { ok: false, error: "Expected materialTextures to be a JSON object." };
    }
    const parsedTextures: { -readonly [K in keyof LocalMaterialTextures]: string } = {};
    for (const channel of ["diffuse", "roughness", "normal", "ao"] as const) {
      const value = texturesRaw[channel];
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          ok: false,
          error: `Expected materialTextures.${channel} to be a non-empty string.`
        };
      }
      const trimmedValue = value.trim();
      if (!isAbsolute(trimmedValue)) {
        return {
          ok: false,
          error: `Expected materialTextures.${channel} to be an absolute path.`
        };
      }
      parsedTextures[channel] = trimmedValue;
    }
    if (Object.keys(parsedTextures).length > 0) {
      materialTextures = parsedTextures;
    }
  }

  return {
    ok: true,
    value: {
      source: "local",
      path: trimmed,
      kind: kind as LocalImportKind,
      ...(targetObjectName ? { targetObjectName } : {}),
      ...(materialTextures ? { materialTextures } : {})
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
