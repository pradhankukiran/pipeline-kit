import { polyHavenSource } from "./sources.js";
import type {
  PipelineKitAssetKind,
  PolyHavenAssetInfo,
  PolyHavenAssetType,
  PolyHavenCatalogAsset,
  PolyHavenCatalogFilters,
  PolyHavenClientOptions,
  PolyHavenFiles
} from "./types.js";

const polyHavenTypeToKind: Record<number, PolyHavenCatalogAsset["kind"]> = {
  0: "hdri",
  1: "material",
  2: "model"
};

export function polyHavenAssetTypeForKind(kind: PipelineKitAssetKind): PolyHavenAssetType | undefined {
  if (kind === "hdri") {
    return "hdris";
  }

  if (kind === "material" || kind === "texture") {
    return "textures";
  }

  if (kind === "model") {
    return "models";
  }

  return undefined;
}

export function buildPolyHavenAssetsUrl(
  filters: PolyHavenCatalogFilters = {},
  apiBaseUrl: string = polyHavenSource.apiBaseUrl
): string {
  const url = new URL("/assets", ensureTrailingSlash(apiBaseUrl));

  if (filters.type) {
    url.searchParams.set("type", filters.type);
  }

  if (filters.categories?.length) {
    url.searchParams.set("categories", filters.categories.join(","));
  }

  return url.toString();
}

export async function fetchPolyHavenAssets(
  filters: PolyHavenCatalogFilters = {},
  options: PolyHavenClientOptions = {}
): Promise<readonly PolyHavenCatalogAsset[]> {
  const body = await fetchPolyHavenJson<Record<string, PolyHavenApiAsset>>(
    buildPolyHavenAssetsUrl(filters, options.apiBaseUrl),
    options
  );

  return Object.entries(body).map(([id, asset]) => normalizePolyHavenAsset(id, asset));
}

export async function fetchPolyHavenInfo(
  id: string,
  options: PolyHavenClientOptions = {}
): Promise<PolyHavenAssetInfo> {
  const body = await fetchPolyHavenJson<PolyHavenApiAsset>(
    buildPolyHavenUrl(`/info/${encodeURIComponent(id)}`, options.apiBaseUrl),
    options
  );

  return normalizePolyHavenAsset(id, body) as PolyHavenAssetInfo;
}

export async function fetchPolyHavenFiles(
  id: string,
  options: PolyHavenClientOptions = {}
): Promise<PolyHavenFiles> {
  return fetchPolyHavenJson<PolyHavenFiles>(
    buildPolyHavenUrl(`/files/${encodeURIComponent(id)}`, options.apiBaseUrl),
    options
  );
}

export function normalizePolyHavenAsset(id: string, asset: PolyHavenApiAsset): PolyHavenCatalogAsset {
  const kind = polyHavenTypeToKind[asset.type] ?? "texture";

  return {
    id,
    name: asset.name,
    type: asset.type,
    kind,
    datePublished: asset.date_published,
    downloadCount: asset.download_count,
    filesHash: asset.files_hash,
    authors: asset.authors ?? {},
    categories: asset.categories ?? [],
    tags: asset.tags ?? [],
    maxResolution: asset.max_resolution,
    dimensions: asset.dimensions,
    thumbnailUrl: asset.thumbnail_url,
    sourceUrl: `https://polyhaven.com/a/${id}`
  };
}

export function buildPolyHavenUrl(path: string, apiBaseUrl: string = polyHavenSource.apiBaseUrl): string {
  return new URL(path, ensureTrailingSlash(apiBaseUrl)).toString();
}

async function fetchPolyHavenJson<T>(url: string, options: PolyHavenClientOptions): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers
  };

  if (options.userAgent) {
    headers["User-Agent"] = options.userAgent;
  }

  const response = await fetcher(url, { headers });

  if (!response.ok) {
    throw new Error(`Poly Haven request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export interface PolyHavenApiAsset {
  name: string;
  type: number;
  date_published?: number;
  download_count?: number;
  files_hash?: string;
  authors?: Record<string, string>;
  categories?: string[];
  tags?: string[];
  max_resolution?: number[];
  dimensions?: number[];
  thumbnail_url?: string;
}
