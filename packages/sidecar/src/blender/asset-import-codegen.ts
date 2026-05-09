/**
 * Codegen for importing external assets (Poly Haven HDRIs / materials) into a
 * live Blender scene. The generated Python is idempotent: re-running it with
 * the same inputs reuses existing data blocks and updates the relevant fields
 * in place. All created data blocks are namespaced under `PK_` so they are
 * easy to identify and clean up.
 */

export type AssetImportInput =
  | {
      readonly kind: "hdri";
      readonly slug: string;
      readonly localPath: string;
      readonly strength?: number;
    }
  | {
      readonly kind: "material";
      readonly slug: string;
      readonly textures: {
        readonly diffuse?: string;
        readonly roughness?: string;
        readonly normal?: string;
        readonly ao?: string;
      };
      readonly targetObjectName?: string;
    }
  | {
      readonly kind: "model";
      readonly slug: string;
      readonly localPath: string;
      readonly format: "gltf" | "glb" | "fbx" | "blend";
      readonly targetCollection?: string;
    };

export function buildAssetImportPython(input: AssetImportInput): string {
  switch (input.kind) {
    case "hdri":
      return buildHdriScript(input);
    case "material":
      return buildMaterialScript(input);
    case "model":
      return buildModelScript(input);
  }
}

function buildHdriScript(input: Extract<AssetImportInput, { kind: "hdri" }>): string {
  const payload = {
    slug: input.slug,
    localPath: input.localPath,
    strength: typeof input.strength === "number" && input.strength > 0 ? input.strength : 1.0
  };

  return `${pythonPrelude("hdri", payload)}
world = bpy.context.scene.world
if world is None:
    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world

world.use_nodes = True
node_tree = world.node_tree
nodes = node_tree.nodes
links = node_tree.links

env_node = None
bg_node = None
out_node = None

for node in list(nodes):
    if node.name == "PK_world_hdri" and node.type == "TEX_ENVIRONMENT":
        env_node = node
    elif node.name == "PK_world_background" and node.type == "BACKGROUND":
        bg_node = node
    elif node.name == "PK_world_output" and node.type == "OUTPUT_WORLD":
        out_node = node

if env_node is None:
    env_node = nodes.new(type="ShaderNodeTexEnvironment")
    env_node.name = "PK_world_hdri"
    env_node.label = "PK World HDRI"
    env_node.location = (-400, 0)

if bg_node is None:
    existing_bg = next((n for n in nodes if n.type == "BACKGROUND"), None)
    if existing_bg is not None and existing_bg.name != "PK_world_hdri":
        bg_node = existing_bg
        bg_node.name = "PK_world_background"
    else:
        bg_node = nodes.new(type="ShaderNodeBackground")
        bg_node.name = "PK_world_background"
    bg_node.location = (-100, 0)

if out_node is None:
    existing_out = next((n for n in nodes if n.type == "OUTPUT_WORLD"), None)
    if existing_out is not None:
        out_node = existing_out
        out_node.name = "PK_world_output"
    else:
        out_node = nodes.new(type="ShaderNodeOutputWorld")
        out_node.name = "PK_world_output"
    out_node.location = (200, 0)

image = bpy.data.images.load(payload["localPath"], check_existing=True)
env_node.image = image
bg_node.inputs["Strength"].default_value = float(payload["strength"])

# Idempotent linking: drop existing inbound links to background color / world output surface, then relink.
def relink(out_socket, in_socket):
    for link in list(in_socket.links):
        links.remove(link)
    links.new(out_socket, in_socket)

relink(env_node.outputs["Color"], bg_node.inputs["Color"])
relink(bg_node.outputs["Background"], out_node.inputs["Surface"])

print(json.dumps({
    "operation": "import_asset",
    "kind": "hdri",
    "slug": payload["slug"],
    "image": image.name,
    "envNode": env_node.name,
    "backgroundNode": bg_node.name,
    "outputNode": out_node.name,
    "strength": float(payload["strength"])
}))
`;
}

function buildMaterialScript(
  input: Extract<AssetImportInput, { kind: "material" }>
): string {
  const payload = {
    slug: input.slug,
    materialName: `PK_${sanitizeSlugForName(input.slug)}`,
    textures: {
      diffuse: input.textures.diffuse ?? null,
      roughness: input.textures.roughness ?? null,
      normal: input.textures.normal ?? null,
      ao: input.textures.ao ?? null
    },
    targetObjectName: input.targetObjectName ?? null
  };

  return `${pythonPrelude("material", payload)}
mat_name = payload["materialName"]
mat = bpy.data.materials.get(mat_name)
if mat is None:
    mat = bpy.data.materials.new(name=mat_name)
mat.use_nodes = True

node_tree = mat.node_tree
nodes = node_tree.nodes
links = node_tree.links

# Resolve / create the principled BSDF + output.
bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
if bsdf is None:
    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)

out_node = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
if out_node is None:
    out_node = nodes.new(type="ShaderNodeOutputMaterial")
    out_node.location = (300, 0)

def get_or_create(name, type_name, location):
    node = nodes.get(name)
    if node is None or node.type != type_name:
        if node is not None:
            nodes.remove(node)
        node = nodes.new(type=type_name)
        node.name = name
    node.location = location
    return node

def relink(out_socket, in_socket):
    for link in list(in_socket.links):
        links.remove(link)
    links.new(out_socket, in_socket)

def load_image(path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    try:
        img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    except Exception:
        pass
    return img

# Hook BSDF -> Output (idempotent).
relink(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

textures = payload["textures"]

if textures.get("diffuse"):
    diffuse_node = get_or_create("PK_tex_diffuse", "ShaderNodeTexImage", (-600, 200))
    diffuse_node.image = load_image(textures["diffuse"], False)
    if textures.get("ao"):
        ao_node = get_or_create("PK_tex_ao", "ShaderNodeTexImage", (-900, 250))
        ao_node.image = load_image(textures["ao"], True)
        mix_node = get_or_create("PK_mix_diffuse_ao", "ShaderNodeMixRGB", (-300, 200))
        try:
            mix_node.blend_type = "MULTIPLY"
            mix_node.inputs["Fac"].default_value = 1.0
        except Exception:
            pass
        relink(diffuse_node.outputs["Color"], mix_node.inputs["Color1"])
        relink(ao_node.outputs["Color"], mix_node.inputs["Color2"])
        relink(mix_node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        relink(diffuse_node.outputs["Color"], bsdf.inputs["Base Color"])

if textures.get("roughness"):
    rough_node = get_or_create("PK_tex_roughness", "ShaderNodeTexImage", (-600, -100))
    rough_node.image = load_image(textures["roughness"], True)
    relink(rough_node.outputs["Color"], bsdf.inputs["Roughness"])

if textures.get("normal"):
    normal_tex_node = get_or_create("PK_tex_normal", "ShaderNodeTexImage", (-900, -350))
    normal_tex_node.image = load_image(textures["normal"], True)
    normal_map_node = get_or_create("PK_normal_map", "ShaderNodeNormalMap", (-300, -350))
    relink(normal_tex_node.outputs["Color"], normal_map_node.inputs["Color"])
    relink(normal_map_node.outputs["Normal"], bsdf.inputs["Normal"])

target_name = payload.get("targetObjectName")
assigned_to = None
if target_name:
    target = bpy.data.objects.get(target_name)
    if target is not None and getattr(target, "data", None) is not None and hasattr(target.data, "materials"):
        if len(target.data.materials) == 0:
            target.data.materials.append(mat)
        else:
            target.data.materials[0] = mat
        assigned_to = target.name

print(json.dumps({
    "operation": "import_asset",
    "kind": "material",
    "slug": payload["slug"],
    "material": mat.name,
    "assignedTo": assigned_to
}))
`;
}

function buildModelScript(input: Extract<AssetImportInput, { kind: "model" }>): string {
  const sanitizedSlug = sanitizeSlugForName(input.slug);
  const collectionName = input.targetCollection ?? `PK_model_${sanitizedSlug}`;
  const payload = {
    slug: input.slug,
    localPath: input.localPath,
    format: input.format,
    collectionName
  };

  return `${pythonPrelude("model", payload)}
slug = payload["slug"]
local_path = payload["localPath"]
fmt = payload["format"]
collection_name = payload["collectionName"]

# Drop any existing collection with the same name so re-import is idempotent.
existing = bpy.data.collections.get(collection_name)
if existing is not None:
    # Remove every object that lives in the collection, then unlink/remove the collection itself.
    objects_to_remove = [obj for obj in existing.objects]
    for obj in objects_to_remove:
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            pass
    # Unlink the collection from any parent collections that reference it.
    for parent in list(bpy.data.collections):
        if collection_name in parent.children:
            try:
                parent.children.unlink(existing)
            except Exception:
                pass
    scene_root = bpy.context.scene.collection
    if existing.name in scene_root.children:
        try:
            scene_root.children.unlink(existing)
        except Exception:
            pass
    try:
        bpy.data.collections.remove(existing)
    except Exception:
        pass

# Create a fresh target collection and link it to the current scene.
target_collection = bpy.data.collections.new(collection_name)
bpy.context.scene.collection.children.link(target_collection)

# Snapshot existing objects before import so we can detect new ones.
pre_import_objects = set(obj.name for obj in bpy.data.objects)

if fmt in ("gltf", "glb"):
    bpy.ops.import_scene.gltf(filepath=local_path)
elif fmt == "fbx":
    bpy.ops.import_scene.fbx(filepath=local_path)
elif fmt == "blend":
    # Append every object data block from the source .blend file.
    with bpy.data.libraries.load(local_path, link=False) as (data_from, data_to):
        data_to.objects = list(data_from.objects)
    for obj in data_to.objects:
        if obj is not None:
            try:
                bpy.context.scene.collection.objects.link(obj)
            except Exception:
                pass
else:
    raise ValueError("Unsupported model format: " + str(fmt))

# Identify newly imported objects and move them into the target collection.
post_import_objects = [obj for obj in bpy.data.objects if obj.name not in pre_import_objects]

scene_root = bpy.context.scene.collection
for obj in post_import_objects:
    # Unlink from every collection that currently holds it (master + any auto-created ones).
    for coll in list(obj.users_collection):
        try:
            coll.objects.unlink(obj)
        except Exception:
            pass
    try:
        target_collection.objects.link(obj)
    except Exception:
        pass

print(json.dumps({
    "operation": "import_asset",
    "kind": "model",
    "slug": slug,
    "format": fmt,
    "collection": target_collection.name,
    "objectCount": len(post_import_objects)
}))
`;
}

function pythonPrelude(kind: "hdri" | "material" | "model", payload: unknown): string {
  return `import bpy
import json

payload = json.loads(${JSON.stringify(JSON.stringify(payload))})
kind = ${JSON.stringify(kind)}
`;
}

function sanitizeSlugForName(slug: string): string {
  const cleaned = slug.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "asset";
}
