import type {
  ApplyMaterialOperation,
  BlenderOperation,
  CreateCameraRigOperation,
  CreateLightingRigOperation,
  CreateSceneOperation,
  CreateStudioSetOperation,
  InspectSceneOperation,
  OperationArtifact,
  OperationResult,
  RenderShotOperation,
  SaveCheckpointOperation
} from "@pipelinekit/core";
import { validateBlenderOperation } from "@pipelinekit/core";
import type { BlenderMcpClient, BlenderMcpCommand, BlenderMcpResult } from "./mcp-client.js";
import {
  emitApplyMaterial,
  emitMatteClay,
  emitPedestalSet,
  emitPreview1080p,
  emitProductSweepSet,
  emitRecipeHelpers,
  emitRenderShotBody,
  emitSoftboxThreePoint,
  emitStudioSetWaterBottle,
  emitTurntableOrbit,
  emitWhiteSweep,
  resolveRenderOutputPath
} from "./recipe-codegen.js";

export interface BlenderOperationRunnerOptions {
  readonly client: BlenderMcpClient;
  readonly scriptToolName?: string;
  readonly scriptArgumentName?: string;
}

export interface BlenderOperationScript {
  readonly operation: BlenderOperation;
  readonly command: BlenderMcpCommand;
  readonly script: string;
}

export interface BlenderOperationRunResult {
  readonly operation: BlenderOperation;
  readonly command: BlenderMcpCommand;
  readonly mcpResult: BlenderMcpResult;
  readonly result: OperationResult;
}

const DEFAULT_SCRIPT_TOOL_NAME = "execute_blender_code";
const DEFAULT_SCRIPT_ARGUMENT_NAME = "code";

export class BlenderOperationRunner {
  private readonly client: BlenderMcpClient;
  private readonly scriptToolName: string;
  private readonly scriptArgumentName: string;

  constructor(options: BlenderOperationRunnerOptions) {
    this.client = options.client;
    this.scriptToolName = options.scriptToolName ?? DEFAULT_SCRIPT_TOOL_NAME;
    this.scriptArgumentName = options.scriptArgumentName ?? DEFAULT_SCRIPT_ARGUMENT_NAME;
  }

  buildScript(operation: unknown): BlenderOperationScript {
    const validated = validateBlenderOperation(operation);
    const script = buildBlenderPythonScript(validated);

    return {
      operation: validated,
      script,
      command: {
        name: this.scriptToolName,
        arguments: {
          [this.scriptArgumentName]: script
        }
      }
    };
  }

  async run(operation: unknown): Promise<BlenderOperationRunResult> {
    const prepared = this.buildScript(operation);
    const mcpResult = await this.client.call(prepared.command);
    const result = createOperationResult(prepared.operation, mcpResult);

    return {
      operation: prepared.operation,
      command: prepared.command,
      mcpResult,
      result
    };
  }

  async runAll(operations: readonly unknown[]): Promise<readonly BlenderOperationRunResult[]> {
    const results: BlenderOperationRunResult[] = [];
    for (const operation of operations) {
      results.push(await this.run(operation));
    }

    return results;
  }
}

export function buildBlenderPythonScript(operation: BlenderOperation): string {
  switch (operation.type) {
    case "create_scene":
      return scriptForCreateScene(operation);
    case "create_studio_set":
      return scriptForCreateStudioSet(operation);
    case "create_lighting_rig":
      return scriptForCreateLightingRig(operation);
    case "create_camera_rig":
      return scriptForCreateCameraRig(operation);
    case "inspect_scene":
      return scriptForInspectScene(operation);
    case "save_checkpoint":
      return scriptForSaveCheckpoint(operation);
    case "render_shot":
      return scriptForRenderShot(operation);
    case "apply_material":
      return scriptForApplyMaterial(operation);
  }
}

function scriptForCreateScene(operation: CreateSceneOperation): string {
  return wrapScript(operation, String.raw`
if params["clearExisting"]:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

bpy.context.scene.name = params["sceneName"]
bpy.context.scene.unit_settings.system = "METRIC" if params["units"] == "metric" else "IMPERIAL"
bpy.context.scene.render.engine = "CYCLES"
bpy.context.scene.cycles.samples = 96
bpy.context.scene.view_settings.view_transform = "Filmic"
bpy.context.scene.view_settings.look = "Medium High Contrast"
bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new("World")
bpy.context.scene.world.color = (1.0, 1.0, 1.0)
print(json.dumps({"operation": operation["type"], "scene": bpy.context.scene.name}))
`);
}

function scriptForCreateStudioSet(operation: CreateStudioSetOperation): string {
  const recipeId = operation.params.recipeId;
  // Each recipeId in the Zod enum maps to a distinct emitter:
  // - water_bottle_product_viz -> full composite scene
  // - product_sweep -> sweep + lights + camera (no material/preset)
  // - pedestal -> sweep + cylindrical pedestal at origin
  let recipeBody: string;
  switch (recipeId) {
    case "water_bottle_product_viz":
      recipeBody = emitStudioSetWaterBottle();
      break;
    case "product_sweep":
      recipeBody = emitProductSweepSet();
      break;
    case "pedestal":
      recipeBody = emitPedestalSet();
      break;
    default: {
      // Exhaustiveness — falls back to a plain sweep if the union ever grows.
      const _exhaustive: never = recipeId;
      void _exhaustive;
      recipeBody = emitWhiteSweep();
      break;
    }
  }

  return wrapRecipeScript(
    operation,
    `${recipeBody}
print(json.dumps({"operation": operation["type"], "recipeId": ${JSON.stringify(recipeId)}}))
`
  );
}

function scriptForCreateLightingRig(operation: CreateLightingRigOperation): string {
  // Scale recipe defaults by the operation's intensity multiplier.
  const intensity = operation.params.intensity ?? 1;
  const recipeBody = emitSoftboxThreePoint({
    keyPower: 800 * intensity,
    fillPower: 600 * intensity,
    rimPower: 400 * intensity
  });

  return wrapRecipeScript(
    operation,
    `${recipeBody}
print(json.dumps({"operation": operation["type"], "preset": ${JSON.stringify(operation.params.preset)}, "lights": [o.name for o in bpy.context.scene.objects if o.type == "LIGHT"]}))
`
  );
}

function scriptForCreateCameraRig(operation: CreateCameraRigOperation): string {
  const animate = operation.params.cameraMove === "orbit";
  const recipeBody = emitTurntableOrbit({
    focalLength: operation.params.focalLength,
    animate
  });

  // Resolution still derives from outputAspect for downstream renders.
  const aspect = operation.params.outputAspect;
  const aspectMap: Record<typeof aspect, [number, number]> = {
    "1:1": [1600, 1600],
    "4:5": [1600, 2000],
    "16:9": [1920, 1080],
    "9:16": [1080, 1920]
  };
  const [width, height] = aspectMap[aspect];

  return wrapRecipeScript(
    operation,
    `${recipeBody}
bpy.context.scene.render.resolution_x = ${width}
bpy.context.scene.render.resolution_y = ${height}
print(json.dumps({"operation": operation["type"], "camera": "PK_camera", "resolution": [${width}, ${height}]}))
`
  );
}

function scriptForInspectScene(operation: InspectSceneOperation): string {
  return wrapScript(operation, String.raw`
report = {"scene": bpy.context.scene.name}
if params["includeObjects"]:
    report["objects"] = [{"name": o.name, "type": o.type} for o in bpy.context.scene.objects]
if params["includeMaterials"]:
    report["materials"] = sorted([m.name for m in bpy.data.materials])
if params["includeRenderSettings"]:
    report["renderSettings"] = {
        "engine": bpy.context.scene.render.engine,
        "resolution": [bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y],
        "camera": bpy.context.scene.camera.name if bpy.context.scene.camera else None,
    }
print(json.dumps({"operation": operation["type"], "report": report}, sort_keys=True))
`);
}

function scriptForSaveCheckpoint(operation: SaveCheckpointOperation): string {
  return wrapScript(operation, String.raw`
label = slug(params["label"])
path = f"//pipelinekit_checkpoint_{label}.blend"
if params["includeBlendFile"]:
    bpy.ops.wm.save_as_mainfile(filepath=path)
print(json.dumps({"operation": operation["type"], "label": params["label"], "path": path, "saved": params["includeBlendFile"]}))
`);
}

function scriptForRenderShot(operation: RenderShotOperation): string {
  const samplesByQuality = { preview: 32, review: 96, final: 256 } as const;
  const samples = samplesByQuality[operation.params.quality];
  const outputPath = resolveRenderShotPath(operation);
  const recipeBody = emitRenderShotBody({
    outputPath,
    samples
  });

  return wrapRecipeScript(
    operation,
    `${recipeBody}
print(json.dumps({"operation": operation["type"], "shotId": ${JSON.stringify(operation.params.shotId)}, "outputPath": _pk_render_output_path, "quality": ${JSON.stringify(operation.params.quality)}}))
`
  );
}

function resolveRenderShotPath(operation: RenderShotOperation): string {
  const explicit = operation.params.outputPath;
  // If caller passed an absolute or `//`-relative path, honor it.
  if (explicit && (explicit.startsWith("/") || explicit.startsWith("//") || /^[A-Za-z]:[\\/]/.test(explicit))) {
    return explicit;
  }
  // Derive from runId/opId. We treat the operation's projectId as the runId
  // bucket and operation.id as the opId leaf.
  const runId = operation.projectId ?? "default";
  const opId = operation.params.shotId ?? operation.id;
  return resolveRenderOutputPath(runId, opId);
}

function scriptForApplyMaterial(operation: ApplyMaterialOperation): string {
  // Default to matte-clay if no procedural id is provided.
  const materialId = operation.params.proceduralMaterialId ?? "matte-clay";
  const target = operation.params.targetObject || "Subject";

  // Pass through every override the Zod op accepts; emitMaterialById picks the
  // keys each recipe knows how to honor.
  const baseColor = parseHexColor(operation.params.color);
  const recipeBody = emitApplyMaterial({
    target,
    materialId,
    materialParams: {
      ...(baseColor ? { baseColor } : {}),
      ...(typeof operation.params.roughness === "number"
        ? { roughness: operation.params.roughness }
        : {}),
      ...(typeof operation.params.metallic === "number"
        ? { metallic: operation.params.metallic }
        : {}),
      ...(typeof operation.params.alpha === "number"
        ? { alpha: operation.params.alpha }
        : {})
    }
  });

  return wrapRecipeScript(
    operation,
    `${recipeBody}
print(json.dumps({"operation": operation["type"], "target": _pk_target.name, "material": _pk_apply_mat.name}))
`
  );
}

function parseHexColor(value: string | undefined): [number, number, number] | undefined {
  if (!value) {
    return undefined;
  }
  const stripped = value.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(stripped)) {
    return undefined;
  }
  const r = parseInt(stripped.slice(0, 2), 16) / 255;
  const g = parseInt(stripped.slice(2, 4), 16) / 255;
  const b = parseInt(stripped.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function wrapScript(operation: BlenderOperation, body: string): string {
  return `${pythonPrelude(operation)}\n${body.trim()}\n`;
}

function wrapRecipeScript(operation: BlenderOperation, body: string): string {
  return `${pythonPrelude(operation)}\n${emitRecipeHelpers()}\n${body.trim()}\n`;
}

function pythonPrelude(operation: BlenderOperation): string {
  return `import bpy
import json
import math
import re
import mathutils

operation = json.loads(${JSON.stringify(JSON.stringify(operation))})
params = operation["params"]

def slug(value):
    slugged = re.sub(r"[^A-Za-z0-9_]+", "_", str(value)).strip("_")
    return slugged or "unnamed"

def hex_to_rgba(value, alpha=1.0):
    value = value.lstrip("#")
    return tuple(int(value[i:i+2], 16) / 255.0 for i in (0, 2, 4)) + (alpha,)

def kelvin_to_rgb(kelvin):
    temp = kelvin / 100.0
    if temp <= 66:
        red = 255
        green = 99.4708025861 * math.log(temp) - 161.1195681661
        blue = 0 if temp <= 19 else 138.5177312231 * math.log(temp - 10) - 305.0447927307
    else:
        red = 329.698727446 * ((temp - 60) ** -0.1332047592)
        green = 288.1221695283 * ((temp - 60) ** -0.0755148492)
        blue = 255
    return tuple(max(0, min(255, c)) / 255.0 for c in (red, green, blue))
`;
}

function createOperationResult(
  operation: BlenderOperation,
  mcpResult: BlenderMcpResult
): OperationResult {
  const failure = extractMcpFailure(mcpResult.output);
  return {
    operationId: operation.id,
    status: failure ? "failed" : "succeeded",
    summary: failure ?? `Ran Blender operation ${operation.type}.`,
    artifacts: artifactsForOperation(operation, mcpResult),
    error: failure,
    completedAt: new Date().toISOString()
  };
}

function extractMcpFailure(output: unknown): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  if (output["isError"] === true) {
    return readMcpText(output) ?? "Blender MCP reported a tool error.";
  }

  const structured = isRecord(output["structuredContent"]) ? output["structuredContent"] : undefined;
  const structuredResult = structured?.["result"];
  if (typeof structuredResult === "string" && looksLikeError(structuredResult)) {
    return structuredResult;
  }

  const text = readMcpText(output);
  return text && looksLikeError(text) ? text : undefined;
}

function readMcpText(output: Record<string, unknown>): string | undefined {
  const content = output["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .map((item) => (isRecord(item) && typeof item["text"] === "string" ? item["text"] : undefined))
    .filter((item): item is string => Boolean(item))
    .join("\n");
}

function looksLikeError(value: string): boolean {
  return /(^|\b)(error|failed|traceback|could not connect)\b/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function artifactsForOperation(
  operation: BlenderOperation,
  mcpResult: BlenderMcpResult
): OperationArtifact[] {
  const artifacts: OperationArtifact[] = [
    {
      kind: "log",
      inlineJson: {
        command: mcpResult.command,
        output: mcpResult.output
      }
    }
  ];

  if (operation.type === "render_shot") {
    const resolvedPath = readRenderOutputPath(mcpResult.output) ?? resolveRenderShotPath(operation);
    artifacts.push({ kind: "render", path: resolvedPath });
  }

  if (operation.type === "save_checkpoint" && operation.params.includeBlendFile) {
    artifacts.push({
      kind: "blend_file",
      path: `//pipelinekit_checkpoint_${slugForBlenderPath(operation.params.label)}.blend`
    });
  }

  if (operation.type === "inspect_scene") {
    artifacts.push({ kind: "scene_report", inlineJson: mcpResult.output });
  }

  return artifacts;
}

function slugForBlenderPath(value: string): string {
  return value.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
}

/**
 * Extracts the `outputPath` field from the JSON envelope emitted by the
 * render_shot Python script. Returns `undefined` if no parseable JSON or no
 * matching field is present.
 */
function readRenderOutputPath(output: unknown): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  // Prefer structuredContent.result, falling back to text content.
  const structured = isRecord(output["structuredContent"]) ? output["structuredContent"] : undefined;
  const structuredResult = structured?.["result"];
  const candidates: unknown[] = [structuredResult, readMcpText(output)];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    // Find the last well-formed JSON object on a line; Blender output may
    // include other prints before the envelope.
    for (const line of candidate.split(/\r?\n/).reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isRecord(parsed) && typeof parsed["outputPath"] === "string") {
          return parsed["outputPath"];
        }
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}
