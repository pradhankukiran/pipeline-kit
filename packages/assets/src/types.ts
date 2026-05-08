import type { AssetKind, AssetRecord, AssetSourceKind, ID } from "@pipelinekit/core";

export type AssetId = ID;

export type PipelineKitAssetKind = AssetKind;

export type AssetLicense =
  | "cc0"
  | "cc-by"
  | "royalty-free"
  | "local-user-managed"
  | "generated";

export interface AssetSourceBase {
  id: AssetId;
  label: string;
  enabledByDefault: boolean;
  supportedKinds: readonly PipelineKitAssetKind[];
  license: AssetLicense;
  notes?: string;
}

export interface ProceduralAssetSource extends AssetSourceBase {
  provider: Extract<AssetSourceKind, "procedural">;
  seedable: true;
  offline: true;
}

export interface PolyHavenAssetSource extends AssetSourceBase {
  provider: Extract<AssetSourceKind, "polyhaven">;
  apiBaseUrl: string;
  attributionRequired: false;
  offline: false;
}

export interface LocalLibraryAssetSource extends AssetSourceBase {
  provider: Extract<AssetSourceKind, "local">;
  optInRequired: true;
  defaultRootEnvVar: string;
  offline: true;
}

export type AssetSource =
  | ProceduralAssetSource
  | PolyHavenAssetSource
  | LocalLibraryAssetSource;

export type PolyHavenAssetType = "hdris" | "textures" | "models" | "all";

export interface PolyHavenCatalogAsset {
  id: AssetId;
  name: string;
  type: number;
  kind: Extract<PipelineKitAssetKind, "hdri" | "material" | "model" | "texture">;
  datePublished?: number;
  downloadCount?: number;
  filesHash?: string;
  authors: Readonly<Record<string, string>>;
  categories: readonly string[];
  tags: readonly string[];
  maxResolution?: readonly number[];
  dimensions?: readonly number[];
  thumbnailUrl?: string;
  sourceUrl: string;
}

export type PolyHavenAssetInfo = PolyHavenCatalogAsset & Readonly<Record<string, unknown>>;

export type PolyHavenFiles = Readonly<Record<string, unknown>>;

export interface PolyHavenCatalogFilters {
  type?: PolyHavenAssetType;
  categories?: readonly string[];
}

export interface PolyHavenClientOptions {
  apiBaseUrl?: string;
  userAgent?: string;
  headers?: Readonly<Record<string, string>>;
  fetcher?: typeof fetch;
}

export interface LocalLibraryScanOptions {
  enabled: boolean;
  roots?: readonly string[];
  kinds?: readonly PipelineKitAssetKind[];
  includeGlobs?: readonly string[];
  excludeGlobs?: readonly string[];
  maxDepth?: number;
  followSymlinks?: boolean;
}

export interface LocalLibraryScanPlan {
  enabled: boolean;
  roots: readonly string[];
  kinds: readonly PipelineKitAssetKind[];
  includeGlobs: readonly string[];
  excludeGlobs: readonly string[];
  maxDepth: number;
  followSymlinks: boolean;
  warnings: readonly string[];
}

export interface AssetResolutionCandidate {
  id: AssetId;
  source: AssetSourceKind;
  kind: PipelineKitAssetKind;
  label: string;
  tags: readonly string[];
  categories?: readonly string[];
  score: number;
  reason: string;
  record?: AssetRecord | PolyHavenCatalogAsset;
}

export interface AssetResolutionRequest {
  kind?: PipelineKitAssetKind;
  query?: string;
  tags?: readonly string[];
  categories?: readonly string[];
  limit?: number;
  proceduralRecipes?: readonly AssetResolutionCandidate[];
  polyHavenAssets?: readonly PolyHavenCatalogAsset[];
  localAssets?: readonly AssetRecord[];
  localLibrary?: Pick<LocalLibraryScanPlan, "enabled">;
}

export interface AssetSearchRequest
  extends Pick<
    AssetResolutionRequest,
    "kind" | "query" | "tags" | "categories" | "limit" | "polyHavenAssets"
  > {
  recipeCandidates?: readonly AssetResolutionCandidate[];
}

export type ProductVisualizationLook =
  | "clean-studio"
  | "soft-daylight"
  | "dramatic-rim"
  | "warm-interior";

export type ProductVisualizationMaterialSurface =
  | "matte"
  | "glossy"
  | "brushed-metal"
  | "glass"
  | "wood"
  | "stone"
  | "fabric";

export interface ProductVisualizationAssetDefaults {
  kind: Extract<PipelineKitAssetKind, "hdri" | "material" | "texture">;
  query: string;
  tags: readonly string[];
  categories: readonly string[];
  reason: string;
}
