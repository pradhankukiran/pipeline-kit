/**
 * Recipe -> Blender Python code generation.
 *
 * Each function emits a self-contained string of Python source. The emitted
 * Python is:
 *   - Idempotent: rerunning is safe (delete-and-recreate or get-or-create).
 *   - Side-effect only: it mutates the active Blender scene; the caller must
 *     wrap with a JSON status print if needed.
 *   - Blender 3.x / 4.x compatible (uses `bpy.context.collection.objects.link`).
 *
 * Recipe IDs covered:
 *   - studio-set:white-sweep
 *   - studio-set:water_bottle_product_viz   (composite)
 *   - lighting-rig:softbox-three-point
 *   - camera-rig:turntable-orbit
 *   - material:matte-clay
 *   - render-preset:preview-1080p
 */

export interface WhiteSweepParams {
  /** Plane size in metres. Default 10. */
  readonly floorSize?: number;
  /** RGB triple (0..1). Default white. */
  readonly floorColor?: readonly [number, number, number];
}

export interface SoftboxThreePointParams {
  /** Watts. Default 800. */
  readonly keyPower?: number;
  /** Watts. Default 600. */
  readonly fillPower?: number;
  /** Watts. Default 400. */
  readonly rimPower?: number;
}

export interface TurntableOrbitParams {
  /** Camera focal length, mm. Default 50. */
  readonly focalLength?: number;
  /** Camera distance from origin, metres. Default 5. */
  readonly radius?: number;
  /** Camera height, metres. Default 1.5. */
  readonly height?: number;
  /** Add a 100-frame Z-axis orbit animation. Default false. */
  readonly animate?: boolean;
}

export interface MatteClayParams {
  /** RGB triple (0..1). Default neutral grey. */
  readonly baseColor?: readonly [number, number, number];
  /** Roughness 0..1. Default 0.7. */
  readonly roughness?: number;
}

export interface Preview1080pParams {
  /** Override sample count. Default 64. */
  readonly samples?: number;
  /** Toggle denoising. Default true. */
  readonly denoise?: boolean;
}

export interface RenderShotParams extends Preview1080pParams {
  /** Absolute output path (PNG). Required. */
  readonly outputPath: string;
}

export interface ApplyMaterialParams {
  /** Object name to assign material to. Falls back to active object. */
  readonly target: string;
  /** Recipe ID, e.g. "matte-clay". */
  readonly materialId: string;
  /** Optional matte-clay overrides. */
  readonly materialParams?: MatteClayParams;
}

export interface StudioSetWaterBottleParams {
  /** Floor size override. */
  readonly floorSize?: number;
  /** Lighting overrides. */
  readonly lighting?: SoftboxThreePointParams;
  /** Camera overrides. */
  readonly camera?: TurntableOrbitParams;
  /** Material overrides. */
  readonly material?: MatteClayParams;
  /** Render preset overrides. */
  readonly renderPreset?: Preview1080pParams;
}

// ---------------------------------------------------------------------------
// Python emission helpers
// ---------------------------------------------------------------------------

function pyFloat(value: number): string {
  return Number.isFinite(value) ? value.toString() : "0.0";
}

function pyBool(value: boolean): string {
  return value ? "True" : "False";
}

function pyTuple3(rgb: readonly [number, number, number]): string {
  return `(${pyFloat(rgb[0])}, ${pyFloat(rgb[1])}, ${pyFloat(rgb[2])})`;
}

function pyStr(value: string): string {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Recipe codegen
// ---------------------------------------------------------------------------

/**
 * Shared idempotency helpers. Emitted once per script.
 */
export function emitRecipeHelpers(): string {
  return `# PipelineKit recipe helpers
def _pk_remove_object(name):
    obj = bpy.data.objects.get(name)
    if obj is not None:
        mesh = obj.data if obj.type == "MESH" else None
        light = obj.data if obj.type == "LIGHT" else None
        cam = obj.data if obj.type == "CAMERA" else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        if light is not None and light.users == 0:
            bpy.data.lights.remove(light)
        if cam is not None and cam.users == 0:
            bpy.data.cameras.remove(cam)


def _pk_get_or_create_material(name):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    return mat


def _pk_link(obj):
    coll = bpy.context.collection
    if obj.name not in coll.objects:
        coll.objects.link(obj)
    return obj
`;
}

export function emitWhiteSweep(params: WhiteSweepParams = {}): string {
  const size = params.floorSize ?? 10;
  const color = params.floorColor ?? [1.0, 1.0, 1.0];

  return `# PipelineKit recipe: studio-set:white-sweep
_pk_remove_object("PK_floor")
_pk_floor_mesh = bpy.data.meshes.new("PK_floor_mesh")
_pk_floor_obj = bpy.data.objects.new("PK_floor", _pk_floor_mesh)
_pk_link(_pk_floor_obj)
import bmesh as _pk_bmesh
_pk_bm = _pk_bmesh.new()
_pk_bmesh.ops.create_grid(_pk_bm, x_segments=1, y_segments=1, size=${pyFloat(size / 2)})
_pk_bm.to_mesh(_pk_floor_mesh)
_pk_bm.free()
_pk_floor_obj.location = (0.0, 0.0, 0.0)

_pk_floor_mat = _pk_get_or_create_material("PK_floor_mat")
_pk_bsdf = _pk_floor_mat.node_tree.nodes.get("Principled BSDF")
if _pk_bsdf is not None:
    _pk_bsdf.inputs["Base Color"].default_value = (${pyTuple3(color).slice(1, -1)}, 1.0)
    _pk_bsdf.inputs["Roughness"].default_value = 0.6
    if "Metallic" in _pk_bsdf.inputs:
        _pk_bsdf.inputs["Metallic"].default_value = 0.0
_pk_floor_obj.data.materials.clear()
_pk_floor_obj.data.materials.append(_pk_floor_mat)
`;
}

export function emitSoftboxThreePoint(params: SoftboxThreePointParams = {}): string {
  const key = params.keyPower ?? 800;
  const fill = params.fillPower ?? 600;
  const rim = params.rimPower ?? 400;

  return `# PipelineKit recipe: lighting-rig:softbox-three-point
def _pk_make_area_light(name, location, energy, size, rotation_euler=(0.0, 0.0, 0.0)):
    _pk_remove_object(name)
    light_data = bpy.data.lights.new(name=name + "_data", type="AREA")
    light_data.energy = energy
    if hasattr(light_data, "size"):
        light_data.size = size
    if hasattr(light_data, "shape"):
        light_data.shape = "RECTANGLE"
    obj = bpy.data.objects.new(name=name, object_data=light_data)
    obj.location = location
    obj.rotation_euler = rotation_euler
    _pk_link(obj)
    return obj

import math as _pk_math
_pk_make_area_light(
    "PK_key_light", (3.0, -3.0, 4.0), ${pyFloat(key)}, 1.5,
    (_pk_math.radians(60.0), 0.0, _pk_math.radians(45.0))
)
_pk_make_area_light(
    "PK_fill_light", (-3.0, -2.0, 3.0), ${pyFloat(fill)}, 1.2,
    (_pk_math.radians(65.0), 0.0, _pk_math.radians(-40.0))
)
_pk_make_area_light(
    "PK_rim_light", (0.0, 4.0, 3.5), ${pyFloat(rim)}, 1.0,
    (_pk_math.radians(115.0), 0.0, _pk_math.radians(180.0))
)
`;
}

export function emitTurntableOrbit(params: TurntableOrbitParams = {}): string {
  const focal = params.focalLength ?? 50;
  const radius = params.radius ?? 5;
  const height = params.height ?? 1.5;
  const animate = params.animate ?? false;

  return `# PipelineKit recipe: camera-rig:turntable-orbit
import math as _pk_math
import mathutils as _pk_mu
_pk_remove_object("PK_camera")
_pk_cam_data = bpy.data.cameras.new(name="PK_camera_data")
_pk_cam_data.lens = ${pyFloat(focal)}
_pk_cam_obj = bpy.data.objects.new("PK_camera", _pk_cam_data)
_pk_cam_obj.location = (0.0, ${pyFloat(-radius)}, ${pyFloat(height)})
_pk_target = _pk_mu.Vector((0.0, 0.0, 0.0))
_pk_dir = _pk_target - _pk_cam_obj.location
_pk_cam_obj.rotation_euler = _pk_dir.to_track_quat("-Z", "Y").to_euler()
_pk_link(_pk_cam_obj)
bpy.context.scene.camera = _pk_cam_obj

if ${pyBool(animate)}:
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 100
    _pk_steps = 100
    _pk_radius = ${pyFloat(radius)}
    _pk_height = ${pyFloat(height)}
    for _pk_i in range(_pk_steps + 1):
        _pk_t = _pk_i / _pk_steps
        _pk_angle = _pk_t * 2.0 * _pk_math.pi
        _pk_cam_obj.location = (
            _pk_radius * _pk_math.sin(_pk_angle),
            -_pk_radius * _pk_math.cos(_pk_angle),
            _pk_height,
        )
        _pk_dir = _pk_target - _pk_cam_obj.location
        _pk_cam_obj.rotation_euler = _pk_dir.to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.frame_set(_pk_i + 1)
        _pk_cam_obj.keyframe_insert(data_path="location", frame=_pk_i + 1)
        _pk_cam_obj.keyframe_insert(data_path="rotation_euler", frame=_pk_i + 1)
    bpy.context.scene.frame_set(1)
`;
}

export function emitMatteClay(params: MatteClayParams = {}): string {
  const color = params.baseColor ?? [0.6, 0.6, 0.6];
  const roughness = params.roughness ?? 0.7;

  return `# PipelineKit recipe: material:matte-clay
PK_MATTE_CLAY_NAME = "PK_matte_clay"
_pk_clay = _pk_get_or_create_material(PK_MATTE_CLAY_NAME)
_pk_clay_bsdf = _pk_clay.node_tree.nodes.get("Principled BSDF")
if _pk_clay_bsdf is not None:
    _pk_clay_bsdf.inputs["Base Color"].default_value = (${pyTuple3(color).slice(1, -1)}, 1.0)
    _pk_clay_bsdf.inputs["Roughness"].default_value = ${pyFloat(roughness)}
    if "Metallic" in _pk_clay_bsdf.inputs:
        _pk_clay_bsdf.inputs["Metallic"].default_value = 0.0
`;
}

export function emitPreview1080p(params: Preview1080pParams = {}): string {
  const samples = params.samples ?? 64;
  const denoise = params.denoise ?? true;

  return `# PipelineKit recipe: render-preset:preview-1080p
_pk_scene = bpy.context.scene
_pk_scene.render.engine = "CYCLES"
_pk_scene.render.resolution_x = 1920
_pk_scene.render.resolution_y = 1080
_pk_scene.render.resolution_percentage = 100
_pk_scene.render.image_settings.file_format = "PNG"
_pk_scene.render.image_settings.color_mode = "RGBA"
_pk_scene.render.image_settings.color_depth = "8"
if hasattr(_pk_scene, "cycles"):
    _pk_scene.cycles.samples = ${pyFloat(samples)}
    if hasattr(_pk_scene.cycles, "use_denoising"):
        _pk_scene.cycles.use_denoising = ${pyBool(denoise)}
`;
}

/**
 * Composite recipe: `studio-set:water_bottle_product_viz`. Emits floor, lights,
 * camera, default material, and render preset. Output is a complete scene.
 */
export function emitStudioSetWaterBottle(params: StudioSetWaterBottleParams = {}): string {
  const floorSize = params.floorSize ?? 10;

  return [
    `# PipelineKit composite recipe: studio-set:water_bottle_product_viz`,
    `# Clear any existing PK_* objects first`,
    `for _pk_obj in [o for o in bpy.data.objects if o.name.startswith("PK_")]:`,
    `    bpy.data.objects.remove(_pk_obj, do_unlink=True)`,
    ``,
    emitWhiteSweep({ floorSize }),
    emitSoftboxThreePoint(params.lighting ?? {}),
    emitTurntableOrbit(params.camera ?? {}),
    emitMatteClay(params.material ?? {}),
    emitPreview1080p(params.renderPreset ?? {}),
  ].join("\n");
}

/**
 * Apply a material recipe to a target object. Falls back to the active object
 * if the named target cannot be resolved.
 */
export function emitApplyMaterial(params: ApplyMaterialParams): string {
  const target = params.target;
  const materialId = params.materialId;

  // Material codegen produces `_pk_clay` (matte-clay). For the v1 we map all
  // material recipe IDs onto matte-clay; future materials slot in here.
  const materialPython = emitMaterialById(materialId, params.materialParams);

  return [
    materialPython,
    ``,
    `# PipelineKit op: apply_material -> ${target}`,
    `_pk_target = bpy.data.objects.get(${pyStr(target)})`,
    `if _pk_target is None:`,
    `    _pk_target = bpy.context.active_object`,
    `if _pk_target is None or not hasattr(_pk_target, "data") or _pk_target.data is None or not hasattr(_pk_target.data, "materials"):`,
    `    raise ValueError("apply_material: no valid target object (looked for " + ${pyStr(target)} + ")")`,
    `_pk_apply_mat = bpy.data.materials.get(PK_MATTE_CLAY_NAME)`,
    `if _pk_apply_mat is None:`,
    `    raise RuntimeError("apply_material: material PK_matte_clay was not created")`,
    `if len(_pk_target.data.materials) == 0:`,
    `    _pk_target.data.materials.append(_pk_apply_mat)`,
    `else:`,
    `    _pk_target.data.materials[0] = _pk_apply_mat`,
  ].join("\n");
}

/**
 * Resolve a material recipe ID to its codegen. Currently only `matte-clay` is
 * supported; unknown IDs default to matte-clay so callers stay functional.
 */
export function emitMaterialById(materialId: string, params?: MatteClayParams): string {
  // Accept variants: "material:matte-clay", "matte-clay", "matte_clay".
  const normalized = materialId
    .toLowerCase()
    .replace(/^material:/, "")
    .replace(/_/g, "-");

  switch (normalized) {
    case "matte-clay":
    default:
      return emitMatteClay(params ?? {});
  }
}

/**
 * Render-shot codegen. Produces Python that:
 *   - Applies the preview-1080p render preset.
 *   - Creates the output directory tree.
 *   - Sets `scene.render.filepath` and runs `bpy.ops.render.render`.
 *   - Prints a JSON envelope (caller is responsible for wrapping with prelude).
 *
 * The emitted Python expects a Python variable named `_pk_render_output_path`
 * to be defined (caller decides whether it's a literal or env-resolved). To
 * keep this self-contained we accept the path as an explicit argument and bake
 * it into the Python.
 */
export function emitRenderShotBody(params: RenderShotParams): string {
  return [
    emitPreview1080p({ samples: params.samples, denoise: params.denoise }),
    ``,
    `# PipelineKit op: render_shot`,
    `import os as _pk_os`,
    `_pk_render_output_path = ${pyStr(params.outputPath)}`,
    `_pk_render_output_dir = _pk_os.path.dirname(_pk_render_output_path)`,
    `if _pk_render_output_dir:`,
    `    _pk_os.makedirs(_pk_render_output_dir, exist_ok=True)`,
    `bpy.context.scene.render.filepath = _pk_render_output_path`,
    `bpy.ops.render.render(write_still=True)`,
  ].join("\n");
}

/**
 * Resolve the absolute render output path for a given (runId, opId) pair.
 *
 * Reads `PIPELINEKIT_RENDER_DIR` from the environment, defaulting to
 * `~/.pipelinekit/renders`. The returned path is `<base>/<runId>/<opId>.png`.
 */
export function resolveRenderOutputPath(runId: string, opId: string): string {
  const envDir = typeof process !== "undefined" ? process.env?.PIPELINEKIT_RENDER_DIR : undefined;
  const home =
    (typeof process !== "undefined" ? process.env?.HOME ?? process.env?.USERPROFILE : undefined) ??
    "/tmp";
  const base = envDir && envDir.length > 0 ? envDir : `${home}/.pipelinekit/renders`;

  const safeRun = sanitizePathSegment(runId);
  const safeOp = sanitizePathSegment(opId);

  // Use forward-slash join: Python `os.makedirs` handles both, and Blender on
  // Windows accepts forward slashes in filepaths.
  return `${base}/${safeRun}/${safeOp}.png`;
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "unnamed";
}
