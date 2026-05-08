import type { AssetSource } from "./types.js";

export const proceduralSource = {
  id: "source:procedural",
  label: "Procedural Generator",
  provider: "procedural",
  enabledByDefault: true,
  supportedKinds: ["model", "material", "texture", "rig", "recipe"],
  license: "generated",
  seedable: true,
  offline: true,
  notes: "Deterministic generated assets for quick blocking and offline work."
} as const satisfies AssetSource;

export const polyHavenSource = {
  id: "source:poly-haven",
  label: "Poly Haven",
  provider: "polyhaven",
  enabledByDefault: true,
  supportedKinds: ["model", "material", "texture", "hdri"],
  license: "cc0",
  apiBaseUrl: "https://api.polyhaven.com",
  attributionRequired: false,
  offline: false,
  notes: "Public CC0 asset catalog for HDRIs, textures, and selected models."
} as const satisfies AssetSource;

export const localLibrarySource = {
  id: "source:local-library",
  label: "Local Asset Library",
  provider: "local",
  enabledByDefault: false,
  supportedKinds: ["model", "material", "texture", "hdri", "rig", "recipe"],
  license: "local-user-managed",
  optInRequired: true,
  defaultRootEnvVar: "PIPELINEKIT_ASSET_LIBRARY",
  offline: true,
  notes: "User-selected folder for licensed studio assets; never scanned without opt-in."
} as const satisfies AssetSource;

export const assetSources = [
  proceduralSource,
  polyHavenSource,
  localLibrarySource
] as const satisfies readonly AssetSource[];

export type AssetSourceId = (typeof assetSources)[number]["id"];
