import type { AssetRecord } from "@pipelinekit/core";
import {
  listRecipeAssetCandidates,
  type RecipeAssetCandidate,
  type RecipeCategory
} from "@pipelinekit/recipes";
import type {
  AssetResolutionCandidate,
  AssetResolutionRequest,
  AssetSearchRequest,
  PipelineKitAssetKind,
  ProductVisualizationAssetDefaults,
  ProductVisualizationLook,
  ProductVisualizationMaterialSurface,
  PolyHavenCatalogAsset
} from "./types.js";

const sourceBaseScore = {
  procedural: 3000,
  polyhaven: 2000,
  local: 1000
} as const;

export interface ResolveAssetCandidatesOptions {
  useRecipeCandidates?: boolean;
}

export function resolveAssetCandidates(
  request: AssetResolutionRequest,
  options: ResolveAssetCandidatesOptions = {}
): readonly AssetResolutionCandidate[] {
  const useRecipes = options.useRecipeCandidates ?? true;
  const recipeCandidates = useRecipes ? expandRecipeCandidates(request) : [];
  const proceduralCandidates = mergeProceduralCandidates(
    request.proceduralRecipes ?? [],
    recipeCandidates
  );

  const candidates = [
    ...normalizeProceduralCandidates(proceduralCandidates),
    ...normalizePolyHavenCandidates(request.polyHavenAssets ?? []),
    ...(request.localLibrary?.enabled
      ? normalizeLocalCandidates(request.localAssets ?? [])
      : [])
  ];

  return candidates
    .filter((candidate) => matchesRequest(candidate, request))
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + matchScore(candidate, request)
    }))
    .sort(compareCandidates)
    .slice(0, request.limit ?? candidates.length);
}

export function searchAssets(
  request: AssetSearchRequest,
  options: ResolveAssetCandidatesOptions = {}
): readonly AssetResolutionCandidate[] {
  return resolveAssetCandidates(
    {
      kind: request.kind,
      query: request.query,
      tags: request.tags,
      categories: request.categories,
      limit: request.limit,
      proceduralRecipes: request.recipeCandidates,
      polyHavenAssets: request.polyHavenAssets,
      localLibrary: { enabled: false }
    },
    options
  );
}

export function recommendProductVisualizationHdriDefaults(
  look: ProductVisualizationLook = "clean-studio"
): ProductVisualizationAssetDefaults {
  return productVisualizationHdriDefaults[look];
}

export function recommendProductVisualizationMaterialDefaults(
  surface: ProductVisualizationMaterialSurface = "matte"
): ProductVisualizationAssetDefaults {
  return productVisualizationMaterialDefaults[surface];
}

export function createProceduralRecipeCandidate(input: {
  id: string;
  label: string;
  category: string;
  tags: readonly string[];
}): AssetResolutionCandidate {
  return {
    id: input.id,
    source: "procedural",
    kind: "recipe",
    label: input.label,
    tags: input.tags,
    categories: [input.category],
    score: 0,
    reason: "Procedural recipe is deterministic and available offline."
  };
}

function normalizeProceduralCandidates(
  candidates: readonly AssetResolutionCandidate[]
): readonly AssetResolutionCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    source: "procedural",
    score: sourceBaseScore.procedural + candidate.score
  }));
}

function expandRecipeCandidates(
  request: AssetResolutionRequest
): readonly AssetResolutionCandidate[] {
  const filterCategory = recipeCategoryForKind(request.kind);
  const filterTags = filterCategory ? undefined : request.tags;
  const recipeCandidates = listRecipeAssetCandidates(
    filterCategory ? { category: filterCategory } : { tags: filterTags }
  );

  if (recipeCandidates.length === 0) {
    return [];
  }

  const productVizBoost = isProductVizRequest(request) ? 40 : 0;

  return recipeCandidates.map((candidate) =>
    convertRecipeCandidate(candidate, productVizBoost)
  );
}

function convertRecipeCandidate(
  candidate: RecipeAssetCandidate,
  productVizBoost: number
): AssetResolutionCandidate {
  return {
    id: candidate.id,
    source: "procedural",
    kind: candidate.kind,
    label: candidate.label,
    tags: candidate.tags,
    categories: candidate.categories,
    score: candidate.score + productVizBoost,
    reason: candidate.reason
  };
}

function mergeProceduralCandidates(
  explicit: readonly AssetResolutionCandidate[],
  recipeDerived: readonly AssetResolutionCandidate[]
): readonly AssetResolutionCandidate[] {
  if (recipeDerived.length === 0) {
    return explicit;
  }

  const seen = new Set(explicit.map((candidate) => candidate.id));
  const merged = [...explicit];

  for (const candidate of recipeDerived) {
    if (!seen.has(candidate.id)) {
      seen.add(candidate.id);
      merged.push(candidate);
    }
  }

  return merged;
}

function recipeCategoryForKind(
  kind: PipelineKitAssetKind | undefined
): RecipeCategory | undefined {
  switch (kind) {
    case "scene":
      return "studio-set";
    case "material":
    case "texture":
      return "material";
    case "model":
      return "prop";
    default:
      return undefined;
  }
}

function isProductVizRequest(request: AssetResolutionRequest): boolean {
  const haystack = [
    request.query ?? "",
    ...(request.tags ?? []),
    ...(request.categories ?? [])
  ]
    .map(normalizeText)
    .join(" ");

  return haystack.includes("product");
}

function normalizePolyHavenCandidates(
  assets: readonly PolyHavenCatalogAsset[]
): readonly AssetResolutionCandidate[] {
  return assets.map((asset) => ({
    id: `polyhaven:${asset.id}`,
    source: "polyhaven",
    kind: asset.kind,
    label: asset.name,
    tags: asset.tags,
    categories: asset.categories,
    score: sourceBaseScore.polyhaven + popularityScore(asset.downloadCount),
    reason: "Poly Haven CC0 catalog match.",
    record: asset
  }));
}

function normalizeLocalCandidates(assets: readonly AssetRecord[]): readonly AssetResolutionCandidate[] {
  return assets.map((asset) => ({
    id: asset.id,
    source: "local",
    kind: asset.kind,
    label: asset.name,
    tags: asset.tags,
    score: sourceBaseScore.local,
    reason: "Opt-in local library match.",
    record: asset
  }));
}

function matchesRequest(candidate: AssetResolutionCandidate, request: AssetResolutionRequest): boolean {
  if (request.kind && !kindMatches(candidate.kind, request.kind)) {
    return false;
  }

  if (!matchesAll(candidate.tags, request.tags)) {
    return false;
  }

  if (!matchesAll(candidate.categories ?? [], request.categories)) {
    return false;
  }

  if (!request.query) {
    return true;
  }

  const searchable = [
    candidate.label,
    candidate.kind,
    candidate.source,
    ...candidate.tags,
    ...(candidate.categories ?? [])
  ].map(normalizeText);

  return queryTokens(request.query).every((token) => searchable.some((value) => value.includes(token)));
}

function kindMatches(candidateKind: PipelineKitAssetKind, requestedKind: PipelineKitAssetKind): boolean {
  if (candidateKind === requestedKind) {
    return true;
  }

  return requestedKind === "texture" && candidateKind === "material";
}

function matchesAll(candidateValues: readonly string[], requestedValues?: readonly string[]): boolean {
  if (!requestedValues?.length) {
    return true;
  }

  const normalizedValues = candidateValues.map(normalizeText);

  return requestedValues.every((value) => {
    const requestedValue = normalizeText(value);

    return normalizedValues.some(
      (candidateValue) =>
        candidateValue === requestedValue ||
        candidateValue.includes(requestedValue) ||
        requestedValue.includes(candidateValue)
    );
  });
}

function matchScore(candidate: AssetResolutionCandidate, request: AssetResolutionRequest): number {
  const requestedTags = request.tags ?? [];
  const requestedCategories = request.categories ?? [];
  const tags = candidate.tags.map(normalizeText);
  const categories = (candidate.categories ?? []).map(normalizeText);
  const tagScore = countMatchedValues(tags, requestedTags) * 25;
  const categoryScore =
    countMatchedValues(categories, requestedCategories) * 20;
  const label = normalizeText(candidate.label);
  const queryScore = request.query
    ? queryTokens(request.query).filter((token) => label.includes(token)).length * 20
    : 0;

  return tagScore + categoryScore + queryScore;
}

function popularityScore(downloadCount?: number): number {
  if (!downloadCount || downloadCount <= 0) {
    return 0;
  }

  return Math.min(250, Math.log10(downloadCount) * 50);
}

function compareCandidates(
  left: AssetResolutionCandidate,
  right: AssetResolutionCandidate
): number {
  return right.score - left.score || left.label.localeCompare(right.label);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function queryTokens(value: string): readonly string[] {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function countMatchedValues(
  candidateValues: readonly string[],
  requestedValues: readonly string[]
): number {
  return requestedValues.filter((value) => {
    const requestedValue = normalizeText(value);

    return candidateValues.some(
      (candidateValue) =>
        candidateValue === requestedValue ||
        candidateValue.includes(requestedValue) ||
        requestedValue.includes(candidateValue)
    );
  }).length;
}

const productVisualizationHdriDefaults: Record<
  ProductVisualizationLook,
  ProductVisualizationAssetDefaults
> = {
  "clean-studio": {
    kind: "hdri",
    query: "studio",
    tags: ["studio", "soft", "product"],
    categories: ["studio"],
    reason: "Neutral studio lighting keeps product form and material response readable."
  },
  "soft-daylight": {
    kind: "hdri",
    query: "daylight studio",
    tags: ["daylight", "soft", "interior"],
    categories: ["indoor"],
    reason: "Soft daylight gives broad reflections without overpowering product details."
  },
  "dramatic-rim": {
    kind: "hdri",
    query: "night studio",
    tags: ["night", "contrast", "studio"],
    categories: ["studio"],
    reason: "Higher contrast lighting supports rim highlights and premium product silhouettes."
  },
  "warm-interior": {
    kind: "hdri",
    query: "warm interior",
    tags: ["warm", "interior", "soft"],
    categories: ["indoor"],
    reason: "Warm interior light is useful for lifestyle product renders and softer mood boards."
  }
};

const productVisualizationMaterialDefaults: Record<
  ProductVisualizationMaterialSurface,
  ProductVisualizationAssetDefaults
> = {
  matte: {
    kind: "material",
    query: "matte plastic",
    tags: ["matte", "plastic", "rough"],
    categories: ["plastic"],
    reason: "Matte plastic is a dependable neutral surface for consumer product blocking."
  },
  glossy: {
    kind: "material",
    query: "glossy ceramic",
    tags: ["glossy", "smooth", "reflective"],
    categories: ["ceramic"],
    reason: "Glossy surfaces quickly validate highlight shape and reflection control."
  },
  "brushed-metal": {
    kind: "material",
    query: "brushed metal",
    tags: ["metal", "brushed", "anisotropic"],
    categories: ["metal"],
    reason: "Brushed metal is common for premium hardware and gives clear directional grain."
  },
  glass: {
    kind: "material",
    query: "clear glass",
    tags: ["glass", "transparent", "smooth"],
    categories: ["glass"],
    reason: "Glass defaults exercise transparency, refraction, and caustic-sensitive lighting."
  },
  wood: {
    kind: "material",
    query: "fine wood",
    tags: ["wood", "grain", "warm"],
    categories: ["wood"],
    reason: "Fine wood adds natural scale and warmth for tabletop product scenes."
  },
  stone: {
    kind: "material",
    query: "marble stone",
    tags: ["stone", "marble", "polished"],
    categories: ["stone"],
    reason: "Stone materials work well for premium plinths, counters, and macro detail shots."
  },
  fabric: {
    kind: "material",
    query: "woven fabric",
    tags: ["fabric", "woven", "rough"],
    categories: ["fabric"],
    reason: "Fabric gives tactile contrast for lifestyle staging and soft product supports."
  }
};
