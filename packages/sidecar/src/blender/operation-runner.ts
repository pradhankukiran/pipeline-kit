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
  emitRenderAnimationBody,
  emitRenderShotBody,
  emitSoftboxThreePoint,
  emitStudioSetWaterBottle,
  emitTurntableOrbit,
  emitWhiteSweep,
  resolveRenderAnimationOutput,
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

/**
 * Optional context threaded into the emitted Python so a Blender-side handler
 * can post `step.progress` events back to the sidecar via
 * `POST /blender/progress`. When `runId`/`stepId` are absent (or empty) the
 * baked-in handlers are no-ops so the progress reporter has zero overhead in
 * standalone-runner test paths.
 */
export interface BlenderOperationRunContext {
  readonly runId?: string;
  readonly stepId?: string;
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

  buildScript(operation: unknown, context?: BlenderOperationRunContext): BlenderOperationScript {
    const validated = validateBlenderOperation(operation);
    const script = buildBlenderPythonScript(validated, context);

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

  async run(
    operation: unknown,
    options: {
      readonly onProgress?: (chunk: string) => void;
      readonly context?: BlenderOperationRunContext;
    } = {}
  ): Promise<BlenderOperationRunResult> {
    const prepared = this.buildScript(operation, options.context);
    const command: BlenderMcpCommand = options.onProgress
      ? { ...prepared.command, onProgress: options.onProgress }
      : prepared.command;
    const mcpResult = await this.client.call(command);
    const result = createOperationResult(prepared.operation, mcpResult);

    return {
      operation: prepared.operation,
      command,
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

export function buildBlenderPythonScript(
  operation: BlenderOperation,
  context?: BlenderOperationRunContext
): string {
  switch (operation.type) {
    case "create_scene":
      return scriptForCreateScene(operation, context);
    case "create_studio_set":
      return scriptForCreateStudioSet(operation, context);
    case "create_lighting_rig":
      return scriptForCreateLightingRig(operation, context);
    case "create_camera_rig":
      return scriptForCreateCameraRig(operation, context);
    case "inspect_scene":
      return scriptForInspectScene(operation, context);
    case "save_checkpoint":
      return scriptForSaveCheckpoint(operation, context);
    case "render_shot":
      return scriptForRenderShot(operation, context);
    case "apply_material":
      return scriptForApplyMaterial(operation, context);
  }
}

function scriptForCreateScene(
  operation: CreateSceneOperation,
  context?: BlenderOperationRunContext
): string {
  return wrapScript(
    operation,
    String.raw`
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
`,
    context
  );
}

function scriptForCreateStudioSet(
  operation: CreateStudioSetOperation,
  context?: BlenderOperationRunContext
): string {
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
`,
    context
  );
}

function scriptForCreateLightingRig(
  operation: CreateLightingRigOperation,
  context?: BlenderOperationRunContext
): string {
  // Each Zod preset defines its own (key, fill, rim) wattage trio. The
  // operation's `intensity` is then a uniform multiplier on the final powers.
  const intensity = operation.params.intensity ?? 1;
  const preset = operation.params.preset;

  // Pre-multiplier ratios (key, fill, rim) per preset.
  const presetWatts: Record<typeof preset, { key: number; fill: number; rim: number }> = {
    studio_softbox: { key: 800, fill: 600, rim: 400 },
    high_key_product: { key: 800, fill: 560, rim: 160 },
    dramatic_rim: { key: 800, fill: 0, rim: 1200 },
    three_point: { key: 800, fill: 400, rim: 560 }
  };
  const watts = presetWatts[preset];

  const recipeBody = emitSoftboxThreePoint({
    keyPower: watts.key * intensity,
    fillPower: watts.fill * intensity,
    rimPower: watts.rim * intensity,
    colorTemperature: operation.params.colorTemperature ?? 5500
  });

  return wrapRecipeScript(
    operation,
    `${recipeBody}
print(json.dumps({"operation": operation["type"], "preset": ${JSON.stringify(operation.params.preset)}, "lights": [o.name for o in bpy.context.scene.objects if o.type == "LIGHT"]}))
`,
    context
  );
}

function scriptForCreateCameraRig(
  operation: CreateCameraRigOperation,
  context?: BlenderOperationRunContext
): string {
  // Honor every value of the cameraMove Zod enum (static / orbit / dolly /
  // push_in). Default to "static" when unset.
  const cameraMove = operation.params.cameraMove ?? "static";
  const recipeBody = emitTurntableOrbit({
    focalLength: operation.params.focalLength,
    cameraMove,
    // Optional Blender object name to aim the camera at. Resolution happens
    // at runtime so a missing object falls back to world origin.
    targetObject: operation.params.targetObject
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
`,
    context
  );
}

function scriptForInspectScene(
  operation: InspectSceneOperation,
  context?: BlenderOperationRunContext
): string {
  return wrapScript(
    operation,
    String.raw`
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
`,
    context
  );
}

function scriptForSaveCheckpoint(
  operation: SaveCheckpointOperation,
  context?: BlenderOperationRunContext
): string {
  // Path policy:
  //   - If a .blend is open, save next to it via Blender's "//"-relative path
  //     (preserves the historical layout).
  //   - If no .blend is open, "//" resolves to Blender's cwd which may be
  //     unwritable. Fall back to an absolute path under
  //     ~/.pipelinekit/checkpoints/<label>.blend so the checkpoint always has
  //     a writable home, regardless of how Blender was launched.
  // The resolved absolute path is echoed back in the JSON envelope so callers
  // (and downstream artifact consumers) can locate the saved file. When
  // includeBlendFile=false we still emit the label and resolved path but do
  // not write to disk — semantics unchanged from before.
  return wrapScript(
    operation,
    String.raw`
import os as _pk_os
label = slug(params["label"])
_pk_blend_filepath = bpy.data.filepath if hasattr(bpy.data, "filepath") else ""
if _pk_blend_filepath:
    relative_path = f"//pipelinekit_checkpoint_{label}.blend"
    absolute_path = bpy.path.abspath(relative_path) if hasattr(bpy.path, "abspath") else relative_path
    save_target = relative_path
else:
    fallback_dir = _pk_os.path.expanduser("~/.pipelinekit/checkpoints")
    _pk_os.makedirs(fallback_dir, exist_ok=True)
    absolute_path = _pk_os.path.join(fallback_dir, f"{label}.blend")
    save_target = absolute_path
if params["includeBlendFile"]:
    bpy.ops.wm.save_as_mainfile(filepath=save_target)
print(json.dumps({"operation": operation["type"], "label": params["label"], "path": save_target, "absolutePath": absolute_path, "saved": params["includeBlendFile"]}))
`,
    context
  );
}

function scriptForRenderShot(
  operation: RenderShotOperation,
  context?: BlenderOperationRunContext
): string {
  const samplesByQuality = { preview: 32, review: 96, final: 256 } as const;
  const samples = samplesByQuality[operation.params.quality];

  if (operation.params.animation === true) {
    const { dir, framePrefix } = resolveRenderAnimationOutputForOp(operation);
    const recipeBody = emitRenderAnimationBody({
      outputDir: dir,
      framePrefix,
      samples,
      ...(typeof operation.params.frameStart === "number"
        ? { frameStart: operation.params.frameStart }
        : {}),
      ...(typeof operation.params.frameEnd === "number"
        ? { frameEnd: operation.params.frameEnd }
        : {})
    });

    return wrapRecipeScript(
      operation,
      `${recipeBody}
print(json.dumps({"operation": operation["type"], "shotId": ${JSON.stringify(operation.params.shotId)}, "outputPath": _pk_render_output_dir, "quality": ${JSON.stringify(operation.params.quality)}, "animation": True, "framePrefix": _pk_render_frame_prefix, "frameStart": _pk_render_animation_frame_start, "frameEnd": _pk_render_animation_frame_end}))
`,
      context
    );
  }

  const outputPath = resolveRenderShotPath(operation);
  const recipeBody = emitRenderShotBody({
    outputPath,
    samples
  });

  return wrapRecipeScript(
    operation,
    `${recipeBody}
print(json.dumps({"operation": operation["type"], "shotId": ${JSON.stringify(operation.params.shotId)}, "outputPath": _pk_render_output_path, "quality": ${JSON.stringify(operation.params.quality)}}))
`,
    context
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

/**
 * Resolve the on-disk directory + frame-name prefix for an animation render.
 * If the caller passed an absolute or `//`-relative `outputPath` we honor it
 * as the directory (its basename is also reused as the frame prefix), giving
 * power-users full control over animation layout. Otherwise we delegate to
 * `resolveRenderAnimationOutput` which derives the canonical
 * `<base>/<runId>/<opId>/` layout.
 */
function resolveRenderAnimationOutputForOp(
  operation: RenderShotOperation
): { readonly dir: string; readonly framePrefix: string } {
  const explicit = operation.params.outputPath;
  if (
    explicit &&
    (explicit.startsWith("/") || explicit.startsWith("//") || /^[A-Za-z]:[\\/]/.test(explicit))
  ) {
    // Strip any trailing slash or `.png` and use the rest as the directory.
    const trimmed = explicit.replace(/\.[A-Za-z0-9]+$/g, "").replace(/[\\/]+$/g, "");
    const baseName = trimmed.split(/[\\/]/).pop();
    const opId = operation.params.shotId ?? operation.id;
    const framePrefix = `${slugForBlenderPath(baseName && baseName.length > 0 ? baseName : opId)}_`;
    return { dir: trimmed, framePrefix };
  }
  const runId = operation.projectId ?? "default";
  const opId = operation.params.shotId ?? operation.id;
  return resolveRenderAnimationOutput(runId, opId);
}

function scriptForApplyMaterial(
  operation: ApplyMaterialOperation,
  context?: BlenderOperationRunContext
): string {
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
`,
    context
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

function wrapScript(
  operation: BlenderOperation,
  body: string,
  context?: BlenderOperationRunContext
): string {
  return `${pythonPrelude(operation, context)}\n${body.trim()}\n`;
}

function wrapRecipeScript(
  operation: BlenderOperation,
  body: string,
  context?: BlenderOperationRunContext
): string {
  return `${pythonPrelude(operation, context)}\n${emitRecipeHelpers()}\n${body.trim()}\n`;
}

function pythonPrelude(operation: BlenderOperation, context?: BlenderOperationRunContext): string {
  const sidecarUrl = readSidecarUrlForBake();
  const runId = typeof context?.runId === "string" ? context.runId : "";
  const stepId = typeof context?.stepId === "string" ? context.stepId : "";
  return `import bpy
import json
import math
import re
import mathutils
import urllib.request as _pk_urlreq
import threading as _pk_threading

operation = json.loads(${JSON.stringify(JSON.stringify(operation))})
params = operation["params"]

PIPELINEKIT_PROGRESS_URL = ${JSON.stringify(`${sidecarUrl}/blender/progress`)}
PIPELINEKIT_RUN_ID = ${JSON.stringify(runId)}
PIPELINEKIT_STEP_ID = ${JSON.stringify(stepId)}

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

def _pk_post_progress(payload):
    try:
        body = json.dumps(payload).encode("utf-8")
        req = _pk_urlreq.Request(
            PIPELINEKIT_PROGRESS_URL,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        _pk_urlreq.urlopen(req, timeout=1.0)
    except Exception:
        pass

def _pk_progress_async(message=None, percent=None, data=None):
    if not PIPELINEKIT_RUN_ID or not PIPELINEKIT_STEP_ID:
        return
    payload = {"runId": PIPELINEKIT_RUN_ID, "stepId": PIPELINEKIT_STEP_ID}
    if message is not None:
        payload["message"] = message
    if percent is not None:
        payload["percent"] = percent
    if data is not None:
        payload["data"] = data
    _pk_threading.Thread(target=_pk_post_progress, args=(payload,), daemon=True).start()

def _pk_render_pre(scene, *args, **kwargs):
    _pk_progress_async(
        message=f"Rendering frame {scene.frame_current}",
        data={"frame": scene.frame_current},
    )

def _pk_render_post(scene, *args, **kwargs):
    fs = getattr(scene, "frame_start", 1) or 1
    fe = getattr(scene, "frame_end", 1) or 1
    span = max(1, fe - fs + 1)
    pct = max(0.0, min(100.0, ((scene.frame_current - fs + 1) / span) * 100.0))
    _pk_progress_async(
        message=f"Frame {scene.frame_current} done",
        percent=pct,
        data={"frame": scene.frame_current, "frameStart": fs, "frameEnd": fe},
    )

def _pk_render_complete(scene, *args, **kwargs):
    _pk_progress_async(message="Render complete", percent=100.0)

def _pk_install_progress_handlers():
    if not PIPELINEKIT_RUN_ID or not PIPELINEKIT_STEP_ID:
        return
    if _pk_render_pre not in bpy.app.handlers.render_pre:
        bpy.app.handlers.render_pre.append(_pk_render_pre)
    if _pk_render_post not in bpy.app.handlers.render_post:
        bpy.app.handlers.render_post.append(_pk_render_post)
    if _pk_render_complete not in bpy.app.handlers.render_complete:
        bpy.app.handlers.render_complete.append(_pk_render_complete)

_pk_install_progress_handlers()
`;
}

/**
 * Resolves the sidecar URL baked into the emitted Python's
 * `_pk_post_progress` calls. Order of precedence:
 *   1. `PIPELINEKIT_SIDECAR_URL` (full base URL, e.g. `http://10.0.0.5:4317`).
 *   2. `http://127.0.0.1:<PIPELINEKIT_SIDECAR_PORT>` if the port env is set.
 *   3. The default `http://127.0.0.1:4317`.
 *
 * Trailing slashes are stripped so callers can safely append `/blender/progress`.
 */
function readSidecarUrlForBake(): string {
  const explicit = process.env["PIPELINEKIT_SIDECAR_URL"];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/+$/g, "");
  }
  const port = process.env["PIPELINEKIT_SIDECAR_PORT"];
  if (typeof port === "string" && port.trim().length > 0) {
    const parsed = Number(port);
    if (Number.isInteger(parsed) && parsed > 0) {
      return `http://127.0.0.1:${parsed}`;
    }
  }
  return "http://127.0.0.1:4317";
}

function createOperationResult(
  operation: BlenderOperation,
  mcpResult: BlenderMcpResult
): OperationResult {
  const failure = extractMcpFailure(mcpResult.output);
  return {
    operationId: operation.id,
    status: failure ? "failed" : "succeeded",
    summary: failure ? summarizeFailure(failure) : `Ran Blender operation ${operation.type}.`,
    artifacts: artifactsForOperation(operation, mcpResult),
    error: failure,
    completedAt: new Date().toISOString()
  };
}

/**
 * Detect a Blender MCP failure using STRUCTURED signals only — never substring
 * matching for words like "error" or "failed" (which produced false positives
 * on benign log lines, scene objects literally named `Error`, etc.).
 *
 * Detection priority:
 *   1. `output.isError === true` — the MCP transport's own failure flag.
 *   2. The JSON envelope our emitted Python prints. We scan the LAST line of
 *      the MCP text payload that looks like `{...}`. If the envelope contains
 *      `{ error: <truthy string> }` or `{ ok: false, error: ... }`, surface
 *      that error string.
 *   3. `output.structuredContent.result` parsed as JSON — only treat as a
 *      failure when it explicitly carries an `error` field.
 *   4. A Python traceback marker: `^Traceback (most recent call last):` at the
 *      START of a line (multiline-anchored). This is dramatically tighter than
 *      a substring search.
 *
 * Anything that doesn't match these structured signals is treated as success.
 */
function extractMcpFailure(output: unknown): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  if (output["isError"] === true) {
    return readMcpText(output) ?? "Blender MCP reported a tool error.";
  }

  // Priority 2: scan the MCP text payload for an emitted JSON envelope error.
  const text = readMcpText(output);
  if (text) {
    const envelopeError = extractEnvelopeError(text);
    if (envelopeError) {
      return envelopeError;
    }
  }

  // Priority 3: structuredContent.result, but ONLY when it parses to an
  // object with an explicit `error` field.
  const structured = isRecord(output["structuredContent"]) ? output["structuredContent"] : undefined;
  const structuredResult = structured?.["result"];
  if (typeof structuredResult === "string") {
    const fromStructured = extractEnvelopeError(structuredResult);
    if (fromStructured) {
      return fromStructured;
    }
  } else if (isRecord(structuredResult)) {
    const direct = readErrorField(structuredResult);
    if (direct) {
      return direct;
    }
  }

  // Priority 4: anchored Python traceback. The traceback line itself plus the
  // exception body are returned so the artifact log carries the full context.
  if (text && /^Traceback \(most recent call last\):/m.test(text)) {
    return text;
  }

  return undefined;
}

/**
 * Walks the supplied text bottom-up looking for a `{...}` JSON envelope with a
 * truthy `error` field (or `ok: false` with an error message). Returns the
 * extracted error string, or undefined when no envelope matches.
 */
function extractEnvelopeError(text: string): string | undefined {
  for (const line of text.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }
    const direct = readErrorField(parsed);
    if (direct) {
      return direct;
    }
  }
  return undefined;
}

function readErrorField(record: Record<string, unknown>): string | undefined {
  // `{ error: <string> }` or `{ ok: false, error: <string> }`.
  const errorValue = record["error"];
  if (typeof errorValue === "string" && errorValue.length > 0) {
    return errorValue;
  }
  if (record["ok"] === false) {
    if (typeof errorValue === "string" && errorValue.length > 0) {
      return errorValue;
    }
    return "Blender MCP reported ok=false without an error message.";
  }
  return undefined;
}

/**
 * Build a short user-facing summary string from a failure body. When the body
 * carries a Python traceback, return only the LAST non-empty line (the
 * `<ExceptionType>: <message>` line) so the UI shows a one-liner instead of
 * the full traceback. Full traceback still goes into the artifact log.
 */
function summarizeFailure(failure: string): string {
  if (/^Traceback \(most recent call last\):/m.test(failure)) {
    const lines = failure.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const candidate = lines[i]?.trim();
      if (candidate && candidate.length > 0) {
        return candidate;
      }
    }
  }
  return failure;
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
    if (operation.params.animation === true) {
      const envelope = readRenderAnimationEnvelope(mcpResult.output);
      const fallback = resolveRenderAnimationOutputForOp(operation);
      const dir = envelope?.outputPath ?? fallback.dir;
      const framePrefix = envelope?.framePrefix ?? fallback.framePrefix;
      // OperationArtifact only allows a fixed `kind` union; surface the
      // animation-specific metadata via `inlineJson` so consumers can
      // distinguish a directory artifact from a single-file render. The
      // `path` still points at the directory so generic UI can browse it.
      artifacts.push({
        kind: "render",
        path: dir,
        inlineJson: {
          mode: "animation",
          framePrefix,
          frameStart: envelope?.frameStart,
          frameEnd: envelope?.frameEnd
        }
      });
    } else {
      const resolvedPath = readRenderOutputPath(mcpResult.output) ?? resolveRenderShotPath(operation);
      artifacts.push({ kind: "render", path: resolvedPath });
    }
  }

  if (operation.type === "save_checkpoint" && operation.params.includeBlendFile) {
    // Prefer the absolute path echoed by the Python helper (it accounts for
    // the no-open-blend fallback under ~/.pipelinekit/checkpoints). Fall back
    // to the Blender-relative path so legacy callers still see a usable hint.
    const checkpoint = readCheckpointEnvelope(mcpResult.output);
    const path =
      checkpoint?.absolutePath ??
      checkpoint?.path ??
      `//pipelinekit_checkpoint_${slugForBlenderPath(operation.params.label)}.blend`;
    artifacts.push({
      kind: "blend_file",
      path
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
  const envelope = readRenderEnvelope(output);
  if (envelope && typeof envelope["outputPath"] === "string") {
    return envelope["outputPath"];
  }
  return undefined;
}

/**
 * Reads the save_checkpoint Python envelope. The script always emits both the
 * Blender-side `path` (which may be a `//`-relative form) and the resolved
 * `absolutePath`. Returns `undefined` if no parseable envelope is present.
 */
function readCheckpointEnvelope(
  output: unknown
): { readonly path?: string; readonly absolutePath?: string } | undefined {
  const envelope = readRenderEnvelope(output);
  if (!envelope) {
    return undefined;
  }
  return {
    ...(typeof envelope["path"] === "string" ? { path: envelope["path"] } : {}),
    ...(typeof envelope["absolutePath"] === "string"
      ? { absolutePath: envelope["absolutePath"] }
      : {})
  };
}

/**
 * Animation-specific JSON envelope reader. The render_shot Python script with
 * `animation: true` emits a richer envelope than the still-render path:
 * `{ outputPath: <dir>, framePrefix, frameStart, frameEnd, animation: true }`.
 * Returns `undefined` if no parseable JSON is found.
 */
function readRenderAnimationEnvelope(
  output: unknown
): { readonly outputPath?: string; readonly framePrefix?: string; readonly frameStart?: number; readonly frameEnd?: number } | undefined {
  const envelope = readRenderEnvelope(output);
  if (!envelope) {
    return undefined;
  }
  return {
    ...(typeof envelope["outputPath"] === "string" ? { outputPath: envelope["outputPath"] } : {}),
    ...(typeof envelope["framePrefix"] === "string" ? { framePrefix: envelope["framePrefix"] } : {}),
    ...(typeof envelope["frameStart"] === "number" ? { frameStart: envelope["frameStart"] } : {}),
    ...(typeof envelope["frameEnd"] === "number" ? { frameEnd: envelope["frameEnd"] } : {})
  };
}

/**
 * Pulls the last well-formed JSON object from the Blender MCP output. Walks
 * lines bottom-up because the Python script may print other diagnostic lines
 * before the final envelope.
 */
function readRenderEnvelope(output: unknown): Record<string, unknown> | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  const structured = isRecord(output["structuredContent"]) ? output["structuredContent"] : undefined;
  const structuredResult = structured?.["result"];
  const candidates: unknown[] = [structuredResult, readMcpText(output)];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    for (const line of candidate.split(/\r?\n/).reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isRecord(parsed)) {
          return parsed;
        }
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}
