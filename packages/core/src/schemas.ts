import { z } from "zod";
import type { BlenderOperation, PipelineOperation } from "./operations.js";

export const assetSourceKindSchema = z.enum(["procedural", "polyhaven", "local"]);

export const pipelineStageSchema = z.enum([
  "brief",
  "direction",
  "scene",
  "assets",
  "materials",
  "lighting",
  "cameras",
  "render",
  "review",
  "revision",
  "delivery"
]);

export const operationRiskSchema = z.enum(["low", "medium", "high"]);

export const operationBaseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  risk: operationRiskSchema,
  requiresApproval: z.boolean(),
  createdAt: z.string().min(1)
});

export const createSceneParamsSchema = z.object({
  sceneName: z.string().min(1).max(120),
  units: z.enum(["metric", "imperial"]),
  clearExisting: z.boolean()
});

export const createStudioSetParamsSchema = z.object({
  recipeId: z.enum(["product_sweep", "water_bottle_product_viz", "pedestal"]),
  scale: z.number().positive().max(100),
  variant: z.string().min(1).max(80).optional()
});

export const applyMaterialParamsSchema = z
  .object({
    targetObject: z.string().min(1).max(120),
    materialAssetId: z.string().min(1).optional(),
    proceduralMaterialId: z
      .enum([
        "clear_plastic",
        "frosted_plastic",
        "brushed_aluminum",
        "paper_label",
        "matte_clay",
        "glossy_white"
      ])
      .optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    roughness: z.number().min(0).max(1).optional(),
    metallic: z.number().min(0).max(1).optional(),
    alpha: z.number().min(0).max(1).optional()
  })
  .refine((params) => params.materialAssetId || params.proceduralMaterialId, {
    message: "Either materialAssetId or proceduralMaterialId is required."
  });

export const createLightingRigParamsSchema = z.object({
  preset: z.enum(["studio_softbox", "high_key_product", "dramatic_rim", "three_point"]),
  colorTemperature: z.number().int().min(1000).max(20000),
  intensity: z.number().positive(),
  useHdri: z.boolean(),
  hdriAssetId: z.string().optional()
});

export const createCameraRigParamsSchema = z.object({
  shotLabel: z.string().min(1).max(120),
  focalLength: z.number().min(10).max(300),
  cameraMove: z.enum(["static", "orbit", "dolly", "push_in"]).optional(),
  outputAspect: z.enum(["1:1", "4:5", "16:9", "9:16"]),
  targetObject: z.string().min(1).max(120).optional()
});

export const renderShotParamsSchema = z
  .object({
    shotId: z.string().min(1),
    quality: z.enum(["preview", "review", "final"]),
    outputPath: z.string().min(1),
    animation: z.boolean().optional(),
    frameStart: z.number().int().min(1).max(1000000).optional(),
    frameEnd: z.number().int().min(1).max(1000000).optional()
  })
  .refine(
    (params) =>
      params.frameStart === undefined ||
      params.frameEnd === undefined ||
      params.frameEnd >= params.frameStart,
    {
      message: "frameEnd must be greater than or equal to frameStart.",
      path: ["frameEnd"]
    }
  );

export const inspectSceneParamsSchema = z.object({
  includeObjects: z.boolean(),
  includeMaterials: z.boolean(),
  includeRenderSettings: z.boolean()
});

export const saveCheckpointParamsSchema = z.object({
  label: z.string().min(1).max(120),
  includeBlendFile: z.boolean()
});

export const createSceneOperationSchema = operationBaseSchema.extend({
  type: z.literal("create_scene"),
  params: createSceneParamsSchema
});

export const createStudioSetOperationSchema = operationBaseSchema.extend({
  type: z.literal("create_studio_set"),
  params: createStudioSetParamsSchema
});

export const applyMaterialOperationSchema = operationBaseSchema.extend({
  type: z.literal("apply_material"),
  params: applyMaterialParamsSchema
});

export const createLightingRigOperationSchema = operationBaseSchema.extend({
  type: z.literal("create_lighting_rig"),
  params: createLightingRigParamsSchema
});

export const createCameraRigOperationSchema = operationBaseSchema.extend({
  type: z.literal("create_camera_rig"),
  params: createCameraRigParamsSchema
});

export const renderShotOperationSchema = operationBaseSchema.extend({
  type: z.literal("render_shot"),
  params: renderShotParamsSchema
});

export const inspectSceneOperationSchema = operationBaseSchema.extend({
  type: z.literal("inspect_scene"),
  params: inspectSceneParamsSchema
});

export const saveCheckpointOperationSchema = operationBaseSchema.extend({
  type: z.literal("save_checkpoint"),
  params: saveCheckpointParamsSchema
});

export const blenderOperationSchema = z.discriminatedUnion("type", [
  createSceneOperationSchema,
  createStudioSetOperationSchema,
  applyMaterialOperationSchema,
  createLightingRigOperationSchema,
  createCameraRigOperationSchema,
  renderShotOperationSchema,
  inspectSceneOperationSchema,
  saveCheckpointOperationSchema
]) satisfies z.ZodType<BlenderOperation>;

export const pipelineOperationSchema = z.discriminatedUnion("type", [
  createSceneOperationSchema,
  createStudioSetOperationSchema,
  z.object({
    ...operationBaseSchema.shape,
    type: z.literal("resolve_assets"),
    params: z.object({
      query: z.string().min(1),
      allowedSources: z.array(assetSourceKindSchema).min(1),
      requiredKinds: z.array(z.string()).default([]),
      maxResults: z.number().int().min(1).max(50)
    })
  }),
  applyMaterialOperationSchema,
  createLightingRigOperationSchema,
  createCameraRigOperationSchema,
  renderShotOperationSchema,
  inspectSceneOperationSchema,
  saveCheckpointOperationSchema
]) satisfies z.ZodType<PipelineOperation>;

export function validateBlenderOperation(operation: unknown): BlenderOperation {
  return blenderOperationSchema.parse(operation);
}

export function validatePipelineOperation(operation: unknown): PipelineOperation {
  return pipelineOperationSchema.parse(operation);
}

export const resolveAssetsParamsSchema = z.object({
  query: z.string().min(1),
  allowedSources: z.array(assetSourceKindSchema).min(1),
  requiredKinds: z.array(z.string()).default([]),
  maxResults: z.number().int().min(1).max(50)
});

export const modelRouteRequestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  purpose: z.enum([
    "classify_intent",
    "extract_brief",
    "creative_direction",
    "operation_planning",
    "render_review",
    "status_summary",
    "failure_recovery"
  ]),
  input: z.unknown()
});
