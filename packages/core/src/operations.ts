import type { AssetSourceKind, ID } from "./models.js";

export type ApprovalMode = "none" | "destructive" | "always";

export type OperationRisk = "low" | "medium" | "high";

export type BlenderOperation =
  | CreateSceneOperation
  | CreateStudioSetOperation
  | ApplyMaterialOperation
  | CreateLightingRigOperation
  | CreateCameraRigOperation
  | RenderShotOperation
  | InspectSceneOperation
  | SaveCheckpointOperation;

export type PipelineOperation =
  | CreateSceneOperation
  | CreateStudioSetOperation
  | ResolveAssetsOperation
  | ApplyMaterialOperation
  | CreateLightingRigOperation
  | CreateCameraRigOperation
  | RenderShotOperation
  | InspectSceneOperation
  | SaveCheckpointOperation;

export type OperationBase<TType extends string, TParams> = {
  id: ID;
  projectId: ID;
  taskId?: ID;
  type: TType;
  params: TParams;
  risk: OperationRisk;
  requiresApproval: boolean;
  createdAt: string;
};

export type CreateSceneOperation = OperationBase<
  "create_scene",
  {
    sceneName: string;
    units: "metric" | "imperial";
    clearExisting: boolean;
  }
>;

export type CreateStudioSetOperation = OperationBase<
  "create_studio_set",
  {
    recipeId: "product_sweep" | "water_bottle_product_viz" | "pedestal";
    scale: number;
    variant?: string;
  }
>;

export type ResolveAssetsOperation = OperationBase<
  "resolve_assets",
  {
    query: string;
    allowedSources: AssetSourceKind[];
    requiredKinds: string[];
    maxResults: number;
  }
>;

export type ApplyMaterialOperation = OperationBase<
  "apply_material",
  {
    targetObject: string;
    materialAssetId?: ID;
    proceduralMaterialId?:
      | "clear_plastic"
      | "frosted_plastic"
      | "brushed_aluminum"
      | "paper_label"
      | "matte_clay"
      | "glossy_white";
    color?: string;
    roughness?: number;
    metallic?: number;
    alpha?: number;
  }
>;

export type CreateLightingRigOperation = OperationBase<
  "create_lighting_rig",
  {
    preset: "studio_softbox" | "high_key_product" | "dramatic_rim" | "three_point";
    colorTemperature: number;
    intensity: number;
    useHdri: boolean;
    hdriAssetId?: ID;
  }
>;

export type CreateCameraRigOperation = OperationBase<
  "create_camera_rig",
  {
    shotLabel: string;
    focalLength: number;
    cameraMove?: "static" | "orbit" | "dolly" | "push_in";
    outputAspect: "1:1" | "4:5" | "16:9" | "9:16";
    targetObject?: string;
  }
>;

export type RenderShotOperation = OperationBase<
  "render_shot",
  {
    shotId: ID;
    quality: "preview" | "review" | "final";
    outputPath: string;
  }
>;

export type InspectSceneOperation = OperationBase<
  "inspect_scene",
  {
    includeObjects: boolean;
    includeMaterials: boolean;
    includeRenderSettings: boolean;
  }
>;

export type SaveCheckpointOperation = OperationBase<
  "save_checkpoint",
  {
    label: string;
    includeBlendFile: boolean;
  }
>;

export type OperationResult = {
  operationId: ID;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
  artifacts: OperationArtifact[];
  error?: string;
  completedAt: string;
};

export type OperationArtifact = {
  kind: "blend_file" | "render" | "log" | "asset" | "scene_report";
  path?: string;
  inlineJson?: unknown;
};

export interface WaterBottleProductVizDemoOptions {
  readonly projectId: ID;
  readonly taskId?: ID;
  readonly idPrefix?: string;
  readonly createdAt?: string;
  readonly outputPath?: string;
}

export function createWaterBottleProductVizDemoOperations(
  options: WaterBottleProductVizDemoOptions
): BlenderOperation[] {
  const idPrefix = options.idPrefix ?? "water-bottle-demo";
  const createdAt = options.createdAt ?? "1970-01-01T00:00:00.000Z";
  const base = {
    projectId: options.projectId,
    taskId: options.taskId,
    risk: "low" as const,
    requiresApproval: false,
    createdAt
  };

  return [
    {
      ...base,
      id: `${idPrefix}-create-scene`,
      type: "create_scene",
      params: {
        sceneName: "Water Bottle Product Viz",
        units: "metric",
        clearExisting: true
      }
    },
    {
      ...base,
      id: `${idPrefix}-studio-set`,
      type: "create_studio_set",
      params: {
        recipeId: "water_bottle_product_viz",
        scale: 1,
        variant: "clean-studio"
      }
    },
    {
      ...base,
      id: `${idPrefix}-bottle-material`,
      type: "apply_material",
      params: {
        targetObject: "PK_Product_Water_Bottle",
        proceduralMaterialId: "clear_plastic",
        color: "#d9f0ff",
        roughness: 0.04,
        alpha: 0.36
      }
    },
    {
      ...base,
      id: `${idPrefix}-label-material`,
      type: "apply_material",
      params: {
        targetObject: "PK_Product_Water_Bottle_Label",
        proceduralMaterialId: "paper_label",
        color: "#faf9f0",
        roughness: 0.72
      }
    },
    {
      ...base,
      id: `${idPrefix}-lighting`,
      type: "create_lighting_rig",
      params: {
        preset: "high_key_product",
        colorTemperature: 5600,
        intensity: 1,
        useHdri: false
      }
    },
    {
      ...base,
      id: `${idPrefix}-camera`,
      type: "create_camera_rig",
      params: {
        shotLabel: "Hero Front",
        focalLength: 70,
        cameraMove: "static",
        outputAspect: "4:5",
        targetObject: "PK_Product_Water_Bottle"
      }
    },
    {
      ...base,
      id: `${idPrefix}-inspect`,
      type: "inspect_scene",
      params: {
        includeObjects: true,
        includeMaterials: true,
        includeRenderSettings: true
      }
    },
    {
      ...base,
      id: `${idPrefix}-checkpoint`,
      type: "save_checkpoint",
      params: {
        label: "water_bottle_product_viz",
        includeBlendFile: true
      }
    },
    {
      ...base,
      id: `${idPrefix}-render`,
      type: "render_shot",
      params: {
        shotId: `${idPrefix}-hero-front`,
        quality: "preview",
        outputPath: options.outputPath ?? "//renders/water_bottle_hero_front.png"
      }
    }
  ];
}
