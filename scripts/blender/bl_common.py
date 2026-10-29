"""Shared helpers for the Blender asset scripts in this folder (imported by the other scripts;
not run directly). Works headless: blender -b --factory-startup --python <script> -- <args>.

Coordinate note: Blender is Z-up, glTF is Y-up. The glTF exporter maps Blender (x, y, z) to glTF
(x, z, -y), so glTF +Y (up) = Blender +Z and glTF +Z (front) = Blender -Y.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector


# ----------------------------------------------------------------------------------------- misc

def script_args():
    """Arguments after '--' on the Blender command line."""
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def log(*a):
    print("[asset]", *a, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.cameras, bpy.data.lights, bpy.data.worlds):
        for block in list(coll):
            coll.remove(block)


def import_model(path, merge_vertices=False):
    """Import glTF/GLB/FBX/OBJ/blend into the current scene. Returns the new objects."""
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".gltf", ".glb"):
        bpy.ops.import_scene.gltf(filepath=path, merge_vertices=merge_vertices)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        raise SystemExit("unsupported input format: " + ext)
    return [o for o in bpy.data.objects if o not in before]


def bone_shape_objects():
    """Objects used as custom bone shapes (e.g. the glTF importer's bone-display Icosphere)."""
    shapes = set()
    for o in bpy.data.objects:
        if o.type == 'ARMATURE' and o.pose:
            for pb in o.pose.bones:
                if pb.custom_shape is not None:
                    shapes.add(pb.custom_shape)
    return shapes


def mesh_objects(objs=None):
    """Mesh objects (bone display shapes excluded)."""
    objs = bpy.context.scene.objects if objs is None else objs
    shapes = bone_shape_objects()
    return [o for o in objs if o.type == 'MESH' and o not in shapes]


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def world_bbox(objs):
    """Axis-aligned bounds (Blender axes) of the evaluated meshes in objs."""
    lo = np.full(3, 1e30)
    hi = np.full(3, -1e30)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != 'MESH':
            continue
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        if len(me.vertices):
            co = np.empty(len(me.vertices) * 3, np.float64)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            m = np.array(eo.matrix_world, dtype=np.float64)
            co = co @ m[:3, :3].T + m[:3, 3]
            lo = np.minimum(lo, co.min(0))
            hi = np.maximum(hi, co.max(0))
        eo.to_mesh_clear()
    if lo[0] > hi[0]:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return Vector(lo), Vector(hi)


def select_only(objs, active=None):
    vl = bpy.context.view_layer
    vl.update()
    for o in vl.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = active or (objs[0] if objs else None)


# -------------------------------------------------------------------------------------- images

def image_to_array(img):
    """(h, w, 4) float32 array, row 0 = bottom (Blender convention), raw stored values."""
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _lanczos_matrix(n_in, n_out, a=3):
    scale = n_in / n_out
    centers = (np.arange(n_out) + 0.5) * scale - 0.5
    x = np.arange(n_in)[None, :] - centers[:, None]
    if scale > 1:
        x = x / scale
    w = np.sinc(x) * np.sinc(x / a)
    w[np.abs(x) >= a] = 0.0
    w /= w.sum(axis=1, keepdims=True)
    return w.astype(np.float32)


def resize(arr, w, h):
    """Lanczos-3 resample of an (H, W, C) float array to (h, w, C)."""
    H, W = arr.shape[:2]
    if (W, H) == (w, h):
        return arr.copy()
    my = _lanczos_matrix(H, h)
    mx = _lanczos_matrix(W, w)
    out = np.empty((h, w, arr.shape[2]), np.float32)
    for c in range(arr.shape[2]):
        out[:, :, c] = my @ arr[:, :, c] @ mx.T
    return out


def renormalize_normals(arr):
    n = arr[:, :, :3] * 2.0 - 1.0
    n[:, :, 2] = np.maximum(n[:, :, 2], 0.0)
    ln = np.linalg.norm(n, axis=2, keepdims=True)
    n = n / np.maximum(ln, 1e-6)
    arr[:, :, :3] = n * 0.5 + 0.5
    return arr


def bleed_alpha(arr, threshold=0.02):
    """Push-pull fill of the RGB under transparent texels so mipmaps don't pull in fringes."""
    wgt = (arr[:, :, 3] > threshold).astype(np.float32)
    col = arr[:, :, :3] * wgt[:, :, None]
    pyr = []
    c, k = col, wgt
    while True:
        pyr.append((c, k))
        hh, ww = c.shape[:2]
        if hh <= 1 and ww <= 1:
            break
        ph, pw = hh % 2, ww % 2
        if ph or pw:
            c = np.pad(c, ((0, ph), (0, pw), (0, 0)), mode="edge")
            k = np.pad(k, ((0, ph), (0, pw)), mode="constant")
        c = c.reshape(c.shape[0] // 2, 2, c.shape[1] // 2, 2, 3).sum(axis=(1, 3))
        k = k.reshape(k.shape[0] // 2, 2, k.shape[1] // 2, 2).sum(axis=(1, 3))
    filled = None
    for c, k in reversed(pyr):
        avg = np.where(k[:, :, None] > 0, c / np.maximum(k[:, :, None], 1e-8), 0.0)
        if filled is not None:
            up = np.repeat(np.repeat(filled, 2, axis=0), 2, axis=1)[:c.shape[0], :c.shape[1]]
            avg = np.where(k[:, :, None] > 0, avg, up)
        filled = avg
    out = arr.copy()
    keep = (arr[:, :, 3] > threshold)[:, :, None]
    out[:, :, :3] = np.where(keep, arr[:, :, :3], filled)
    return out


def save_array(arr, path, fmt="JPEG", quality=85, name=None):
    """Write an (h, w, 4) float array (row 0 = bottom) with Blender's writers and return it
    loaded as a file-backed image (the glTF exporter then embeds the file bytes unchanged)."""
    h, w = arr.shape[:2]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    alpha = fmt in ("PNG", "WEBP") and arr.shape[2] == 4
    tmp = bpy.data.images.new("__tmp_save__", width=w, height=h, alpha=alpha)
    data = np.clip(arr, 0.0, 1.0).astype(np.float32).copy()
    if not alpha:
        data[:, :, 3] = 1.0
    tmp.pixels.foreach_set(data.reshape(-1))
    tmp.filepath_raw = path
    tmp.file_format = fmt
    if fmt in ("JPEG", "WEBP"):
        tmp.save(quality=quality)
    else:
        tmp.save()
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path, check_existing=False)
    if name:
        img.name = name
    return img


def sample_image_at_uvs(arr, uv):
    """Nearest-texel lookup of arr (h, w, C, row 0 = bottom) at uv (N, 2), wrapping."""
    h, w = arr.shape[:2]
    u = np.mod(uv[:, 0], 1.0)
    v = np.mod(uv[:, 1], 1.0)
    x = np.clip((u * w).astype(np.int64), 0, w - 1)
    y = np.clip((v * h).astype(np.int64), 0, h - 1)
    return arr[y, x]


# ---------------------------------------------------------------------------- mesh numpy access

def mesh_arrays(me):
    """Triangle-level arrays of a mesh: loops (T,3), verts (T,3), mats (T,), polys (T,),
    vertex coords co (V,3) and active-UV per loop uv (L,2) or None."""
    me.calc_loop_triangles()
    T = len(me.loop_triangles)
    loops = np.empty(T * 3, np.int64)
    me.loop_triangles.foreach_get("loops", loops)
    verts = np.empty(T * 3, np.int64)
    me.loop_triangles.foreach_get("vertices", verts)
    mats = np.empty(T, np.int64)
    me.loop_triangles.foreach_get("material_index", mats)
    polys = np.empty(T, np.int64)
    me.loop_triangles.foreach_get("polygon_index", polys)
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    uv = None
    layer = me.uv_layers.active if me.uv_layers else None
    if layer is not None:
        uv = np.empty(len(me.loops) * 2, np.float64)
        layer.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
    return dict(loops=loops.reshape(-1, 3), verts=verts.reshape(-1, 3), mats=mats, polys=polys,
                co=co.reshape(-1, 3), uv=uv)


def tri_areas(co, verts):
    a, b, c = co[verts[:, 0]], co[verts[:, 1]], co[verts[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)


# ------------------------------------------------------------------------------------ rendering

def look_at(cam_obj, target, direction, distance):
    d = Vector(direction).normalized()
    cam_obj.location = Vector(target) + d * distance
    cam_obj.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()


def setup_preview_scene(engine="EEVEE", world_strength=0.8, sun_strength=3.0, transparent=False,
                        world_color=(0.55, 0.6, 0.7), samples=32):
    sc = bpy.context.scene
    if engine == "WORKBENCH":
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading
        sh.light = 'STUDIO'
        sh.color_type = 'TEXTURE'
        sh.show_backface_culling = False
    elif engine == "CYCLES":
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = samples
        sc.cycles.device = 'CPU'
    else:
        sc.render.engine = 'BLENDER_EEVEE'
        try:
            sc.eevee.taa_render_samples = samples
        except Exception:
            pass
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    try:
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
    except Exception:
        pass
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*world_color, 1.0)
    bg.inputs[1].default_value = world_strength
    sc.world = world
    if sun_strength > 0:
        sun_data = bpy.data.lights.new("preview_sun", 'SUN')
        sun_data.energy = sun_strength
        sun_data.angle = math.radians(8)
        sun = bpy.data.objects.new("preview_sun", sun_data)
        sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
        sc.collection.objects.link(sun)
    return sc


def render_views(objs, out_png, views=("persp", "front", "side", "top"), size=384):
    """Render several views of objs with the current engine and tile them into one PNG.
    front = looking at the glTF +Z face, side = from glTF +X, top = from above."""
    sc = bpy.context.scene
    lo, hi = world_bbox(objs)
    center = (lo + hi) / 2
    ext = hi - lo
    radius = max(ext.length / 2, 1e-3)
    cam_data = bpy.data.cameras.new("preview_cam")
    cam = bpy.data.objects.new("preview_cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.clip_start = radius * 0.01
    cam_data.clip_end = radius * 100
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    tiles = []
    outdir = os.path.dirname(os.path.abspath(out_png))
    os.makedirs(outdir, exist_ok=True)
    for i, v in enumerate(views):
        if v in ("persp", "persp2"):
            cam_data.type = 'PERSP'
            cam_data.lens = 50
            d = (1.0, -1.6, 0.9) if v == "persp" else (-1.2, 1.4, 0.7)
            fov = 2 * math.atan(18 / 50)
            look_at(cam, center, d, radius / math.sin(fov / 2) * 1.05)
        else:
            cam_data.type = 'ORTHO'
            dirs = {"front": ((0, -1, 0), max(ext.x, ext.z)), "back": ((0, 1, 0), max(ext.x, ext.z)),
                    "side": ((1, 0, 0), max(ext.y, ext.z)), "side2": ((-1, 0, 0), max(ext.y, ext.z)),
                    "top": ((0, 0, 1), max(ext.x, ext.y)), "bottom": ((0, 0, -1), max(ext.x, ext.y))}
            d, span = dirs[v]
            cam_data.ortho_scale = span * 1.08
            look_at(cam, center, d, radius * 3)
            if v == "top":
                cam.rotation_euler = (0, 0, 0)
            elif v == "bottom":
                cam.rotation_euler = (math.pi, 0, 0)
        path = os.path.join(outdir, "_view_tmp_%s_%d_%d.png" % (
            os.path.splitext(os.path.basename(out_png))[0], os.getpid(), i))
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path, check_existing=False)
        tiles.append(image_to_array(img))
        bpy.data.images.remove(img)
        os.remove(path)
    sheet = np.concatenate(tiles, axis=1)
    sheet[:, :, 3] = 1.0
    img = save_array(sheet, out_png, fmt="PNG")
    bpy.data.images.remove(img)
    bpy.data.objects.remove(cam)
    return out_png
