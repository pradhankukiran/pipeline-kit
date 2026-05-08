import type { AssetKind } from "@pipelinekit/core";
import type {
  ProceduralRecipe,
  RecipeAssetCandidate,
  RecipeCandidateOptions,
  RecipeCandidateSearchFilters,
  RecipeCategory,
  RecipeRegistry
} from "./types.js";

export const recipeRegistry = {
  "studio-set": [
    {
      id: "studio-set:white-sweep",
      category: "studio-set",
      label: "White Sweep",
      description: "Seamless product sweep with adjustable floor radius.",
      tags: ["product", "clean", "procedural"],
      layout: "sweep",
      parameters: [
        { key: "width", label: "Width", defaultValue: 6, min: 2, max: 20, step: 0.5 },
        { key: "depth", label: "Depth", defaultValue: 8, min: 2, max: 24, step: 0.5 },
        { key: "curveRadius", label: "Curve Radius", defaultValue: 1.25, min: 0.25, max: 4, step: 0.25 }
      ]
    }
  ],
  "lighting-rig": [
    {
      id: "lighting-rig:softbox-three-point",
      category: "lighting-rig",
      label: "Softbox Three Point",
      description: "Balanced key, fill, and rim setup for product and character previews.",
      tags: ["studio", "softbox", "preview"],
      lights: ["key", "fill", "rim"],
      parameters: [
        { key: "keyPower", label: "Key Power", defaultValue: 650, min: 50, max: 2000, step: 25 },
        { key: "fillRatio", label: "Fill Ratio", defaultValue: 0.35, min: 0, max: 1, step: 0.05 },
        { key: "rimEnabled", label: "Rim Enabled", defaultValue: true }
      ]
    }
  ],
  "camera-rig": [
    {
      id: "camera-rig:turntable-orbit",
      category: "camera-rig",
      label: "Turntable Orbit",
      description: "Camera orbit rig centered on a subject bounding box.",
      tags: ["orbit", "product", "animation"],
      movement: "orbit",
      parameters: [
        { key: "focalLength", label: "Focal Length", defaultValue: 70, min: 18, max: 135, step: 1 },
        { key: "distance", label: "Distance", defaultValue: 5, min: 1, max: 30, step: 0.25 },
        { key: "durationFrames", label: "Duration Frames", defaultValue: 120, min: 24, max: 720, step: 1 }
      ]
    }
  ],
  prop: [
    {
      id: "prop:primitive-stand",
      category: "prop",
      label: "Primitive Display Stand",
      description: "Simple generated pedestal or riser for product staging.",
      tags: ["display", "stand", "procedural"],
      assetHints: ["source:procedural"],
      parameters: [
        { key: "height", label: "Height", defaultValue: 0.8, min: 0.1, max: 4, step: 0.05 },
        { key: "radius", label: "Radius", defaultValue: 1.2, min: 0.2, max: 5, step: 0.05 },
        { key: "sides", label: "Sides", defaultValue: 64, min: 3, max: 128, step: 1 }
      ]
    }
  ],
  material: [
    {
      id: "material:matte-clay",
      category: "material",
      label: "Matte Clay",
      description: "Neutral clay material for blocking, previews, and look development.",
      tags: ["preview", "neutral", "procedural"],
      shader: "principled",
      parameters: [
        { key: "roughness", label: "Roughness", defaultValue: 0.82, min: 0, max: 1, step: 0.01 },
        { key: "baseColor", label: "Base Color", defaultValue: "#b8b1a7" },
        { key: "noiseAmount", label: "Noise Amount", defaultValue: 0.04, min: 0, max: 0.4, step: 0.01 }
      ]
    }
  ],
  motion: [
    {
      id: "motion:slow-push-in",
      category: "motion",
      label: "Slow Push In",
      description: "Subtle camera dolly toward the subject for product reveals.",
      tags: ["camera", "dolly", "reveal"],
      target: "camera",
      parameters: [
        { key: "distance", label: "Distance", defaultValue: 1.25, min: 0.1, max: 10, step: 0.05 },
        { key: "durationFrames", label: "Duration Frames", defaultValue: 96, min: 24, max: 720, step: 1 },
        { key: "ease", label: "Ease", defaultValue: "ease-in-out", options: ["linear", "ease-in", "ease-out", "ease-in-out"] }
      ]
    }
  ],
  "render-preset": [
    {
      id: "render-preset:preview-1080p",
      category: "render-preset",
      label: "Preview 1080p",
      description: "Fast full-HD render settings for local iteration.",
      tags: ["preview", "1080p", "cycles"],
      engine: "cycles",
      output: {
        width: 1920,
        height: 1080,
        fps: 24
      },
      parameters: [
        { key: "samples", label: "Samples", defaultValue: 96, min: 16, max: 1024, step: 8 },
        { key: "denoise", label: "Denoise", defaultValue: true },
        { key: "motionBlur", label: "Motion Blur", defaultValue: false }
      ]
    }
  ]
} as const satisfies RecipeRegistry;

export const recipes = Object.values(recipeRegistry).flat() as readonly ProceduralRecipe[];

export function getRecipeById(id: string): ProceduralRecipe | undefined {
  return recipes.find((recipe) => recipe.id === id);
}

export function listRecipesByCategory<TCategory extends RecipeCategory>(
  category: TCategory
): readonly Extract<ProceduralRecipe, { category: TCategory }>[] {
  return recipeRegistry[category] as unknown as readonly Extract<
    ProceduralRecipe,
    { category: TCategory }
  >[];
}

export function listRecipesByTags(tags: readonly string[]): readonly ProceduralRecipe[] {
  if (tags.length === 0) {
    return recipes;
  }

  const requiredTags = new Set(tags.map(normalizeRecipeLookupValue));

  return recipes.filter((recipe) => {
    const recipeTags = new Set(recipe.tags.map(normalizeRecipeLookupValue));

    return Array.from(requiredTags).every((tag) => recipeTags.has(tag));
  });
}

export function listRecipesByCategoryAndTags<TCategory extends RecipeCategory>(
  category: TCategory,
  tags: readonly string[]
): readonly Extract<ProceduralRecipe, { category: TCategory }>[] {
  const categoryRecipes = listRecipesByCategory(category);

  if (tags.length === 0) {
    return categoryRecipes;
  }

  const requiredTags = new Set(tags.map(normalizeRecipeLookupValue));

  return categoryRecipes.filter((recipe) => {
    const recipeTags = new Set(recipe.tags.map(normalizeRecipeLookupValue));

    return Array.from(requiredTags).every((tag) => recipeTags.has(tag));
  });
}

export function createRecipeAssetCandidate(
  recipe: ProceduralRecipe,
  options: RecipeCandidateOptions = {}
): RecipeAssetCandidate {
  const categories = options.categories ?? [recipe.category];
  const tags = uniqueRecipeLookupValues([
    ...recipe.tags,
    recipe.category,
    ...(options.tags ?? [])
  ]);

  return {
    id: recipe.id,
    source: "procedural",
    kind: options.kind ?? assetKindForRecipeCategory(recipe.category),
    label: recipe.label,
    tags,
    categories,
    score: options.score ?? productVisualizationRecipeScore(recipe),
    reason: options.reason ?? "Procedural recipe candidate for product visualization.",
    recipeId: recipe.id,
    recipeCategory: recipe.category
  };
}

export function listRecipeAssetCandidates(
  filters: RecipeCandidateSearchFilters = {}
): readonly RecipeAssetCandidate[] {
  const candidateRecipes = filters.category
    ? listRecipesByCategory(filters.category)
    : recipes;
  const filteredRecipes = filters.tags?.length
    ? candidateRecipes.filter((recipe) => recipeHasAllTags(recipe, filters.tags ?? []))
    : candidateRecipes;

  return filteredRecipes.map((recipe) => createRecipeAssetCandidate(recipe));
}

function normalizeRecipeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

function recipeHasAllTags(recipe: ProceduralRecipe, tags: readonly string[]): boolean {
  const recipeTags = new Set(recipe.tags.map(normalizeRecipeLookupValue));

  return tags.every((tag) => recipeTags.has(normalizeRecipeLookupValue(tag)));
}

function uniqueRecipeLookupValues(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map(normalizeRecipeLookupValue))).filter(Boolean);
}

function assetKindForRecipeCategory(category: RecipeCategory): AssetKind {
  const categoryToKind: Record<RecipeCategory, AssetKind> = {
    "studio-set": "scene",
    "lighting-rig": "rig",
    "camera-rig": "rig",
    prop: "model",
    material: "material",
    motion: "recipe",
    "render-preset": "recipe"
  };

  return categoryToKind[category];
}

function productVisualizationRecipeScore(recipe: ProceduralRecipe): number {
  const tags = new Set(recipe.tags.map(normalizeRecipeLookupValue));
  const productScore = tags.has("product") ? 60 : 0;
  const previewScore = tags.has("preview") ? 30 : 0;
  const proceduralScore = tags.has("procedural") ? 20 : 0;

  return productScore + previewScore + proceduralScore;
}
