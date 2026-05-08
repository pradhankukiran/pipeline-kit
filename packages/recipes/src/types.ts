import type { AssetKind, AssetSourceKind, ID } from "@pipelinekit/core";

export type RecipeId = ID;
export type AssetId = ID;

export type RecipeCategory =
  | "studio-set"
  | "lighting-rig"
  | "camera-rig"
  | "prop"
  | "material"
  | "motion"
  | "render-preset";

export interface RecipeParameter<TValue> {
  key: string;
  label: string;
  defaultValue: TValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly TValue[];
}

export interface RecipeBase<TCategory extends RecipeCategory> {
  id: RecipeId;
  category: TCategory;
  label: string;
  description: string;
  tags: readonly string[];
  parameters: readonly RecipeParameter<string | number | boolean>[];
}

export interface StudioSetRecipe extends RecipeBase<"studio-set"> {
  layout: "sweep" | "tabletop" | "cyc-wall" | "stage";
}

export interface LightingRigRecipe extends RecipeBase<"lighting-rig"> {
  lights: readonly ("key" | "fill" | "rim" | "practical" | "hdri")[];
}

export interface CameraRigRecipe extends RecipeBase<"camera-rig"> {
  movement: "static" | "dolly" | "orbit" | "handheld";
}

export interface PropRecipe extends RecipeBase<"prop"> {
  assetHints: readonly AssetId[];
}

export interface MaterialRecipe extends RecipeBase<"material"> {
  shader: "principled" | "emissive" | "glass" | "volume";
}

export interface MotionRecipe extends RecipeBase<"motion"> {
  target: "camera" | "object" | "light" | "world";
}

export interface RenderPresetRecipe extends RecipeBase<"render-preset"> {
  engine: "cycles" | "eevee";
  output: {
    width: number;
    height: number;
    fps: number;
  };
}

export type ProceduralRecipe =
  | StudioSetRecipe
  | LightingRigRecipe
  | CameraRigRecipe
  | PropRecipe
  | MaterialRecipe
  | MotionRecipe
  | RenderPresetRecipe;

export type RecipeRegistry = {
  readonly [Category in RecipeCategory]: readonly Extract<
    ProceduralRecipe,
    { category: Category }
  >[];
};

export interface RecipeAssetCandidate {
  id: RecipeId;
  source: Extract<AssetSourceKind, "procedural">;
  kind: AssetKind;
  label: string;
  tags: readonly string[];
  categories: readonly string[];
  score: number;
  reason: string;
  recipeId: RecipeId;
  recipeCategory: RecipeCategory;
}

export interface RecipeCandidateOptions {
  kind?: AssetKind;
  score?: number;
  tags?: readonly string[];
  categories?: readonly string[];
  reason?: string;
}

export interface RecipeCandidateSearchFilters {
  category?: RecipeCategory;
  tags?: readonly string[];
}
