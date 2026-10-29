"""Render a transparent side-view icon of a model (e.g. an ammunition round) for the HUD.

Usage:
  blender -b --factory-startup --python scripts/blender/render_icon.py -- \
      --in MODEL --out icon.png [--size 512x128] [--fill 0.9] [--nose +y] [--roll 0] \
      [--samples 64] [--supersample 2] [--view-transform AgX]

The model is turned so its nose (a glTF-axis direction: +x, -x, +y, -y, +z, -z, or "auto" = the
longest bounding-box axis, positive end) points RIGHT, then rolled --roll degrees about that axis
(to choose which side faces the camera). An orthographic camera looks at its side, scaled so the
model's length fills --fill of the image width (each icon fills its own width), centred. Soft
neutral studio lighting (three area lights + grey world) in Eevee, transparent background. The
image is rendered at --supersample x the size and downsampled with a Lanczos filter in
premultiplied alpha, which keeps edges and printed markings crisp.
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.dont_write_bytecode = True  # keep the scripts folder free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as C  # noqa: E402

GLTF_TO_BLENDER = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+y": (0, 0, 1), "-y": (0, 0, -1),
                   "+z": (0, -1, 0), "-z": (0, 1, 0)}


def parse_args():
    p = argparse.ArgumentParser(prog="render_icon.py")
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--size", default="512x128")
    p.add_argument("--fill", type=float, default=0.9, help="fraction of the width the model spans")
    p.add_argument("--nose", default="auto", help="glTF-axis direction of the nose, or auto")
    p.add_argument("--roll", type=float, default=0.0, help="degrees about the long axis")
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--supersample", type=int, default=2)
    p.add_argument("--view-transform", default="AgX")
    p.add_argument("--exposure", type=float, default=0.0)
    return p.parse_args(C.script_args())


def add_area(name, energy, size, loc, target, color=(1.0, 1.0, 1.0)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size
    d.color = color
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def main():
    a = parse_args()
    W, H = (int(v) for v in a.size.lower().split("x"))
    C.reset_scene()
    objs = C.import_model(os.path.abspath(a.inp))
    meshes = C.mesh_objects(objs)
    if not meshes:
        raise SystemExit("no meshes in " + a.inp)

    lo, hi = C.world_bbox(meshes)
    if a.nose == "auto":
        ext = hi - lo
        i = max(range(3), key=lambda k: ext[k])
        nose = Vector([1.0 if k == i else 0.0 for k in range(3)])
    else:
        nose = Vector(GLTF_TO_BLENDER[a.nose.lower()])

    # pivot at the bbox centre: roll about the nose axis, then turn the nose to +X (image right)
    pivot = bpy.data.objects.new("icon_pivot", None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.location = (lo + hi) / 2
    bpy.context.view_layer.update()
    for o in objs:
        if o.parent is None and o is not pivot:
            mw = o.matrix_world.copy()
            o.parent = pivot
            o.matrix_parent_inverse = pivot.matrix_world.inverted()
            o.matrix_world = mw
    q = nose.rotation_difference(Vector((1, 0, 0))) @ Quaternion(nose, math.radians(a.roll))
    pivot.rotation_mode = 'QUATERNION'
    pivot.rotation_quaternion = q
    bpy.context.view_layer.update()
    lo, hi = C.world_bbox(meshes)
    center = (lo + hi) / 2
    length = hi.x - lo.x

    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = a.samples
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.filter_size = 1.2
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    try:
        sc.view_settings.view_transform = a.view_transform
    except Exception:
        sc.view_settings.view_transform = 'Standard'
    sc.view_settings.exposure = a.exposure
    ss = max(1, a.supersample)
    sc.render.resolution_x = W * ss
    sc.render.resolution_y = H * ss
    sc.render.resolution_percentage = 100

    world = bpy.data.worlds.new("icon_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs[1].default_value = 0.55
    sc.world = world

    r = max(length, 1e-3)
    # key (top front left, large and soft), fill (front right, low), rim (behind, top)
    add_area("key", 60.0 * r * r, 1.2 * r, center + Vector((-0.6 * r, -1.4 * r, 1.1 * r)), center)
    add_area("fill", 18.0 * r * r, 1.5 * r, center + Vector((0.9 * r, -1.2 * r, -0.2 * r)), center)
    add_area("rim", 30.0 * r * r, 0.8 * r, center + Vector((0.2 * r, 1.3 * r, 0.9 * r)), center)

    cam_data = bpy.data.cameras.new("icon_cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = length / a.fill  # ortho_scale spans the wider (horizontal) side
    cam_data.clip_start = 0.001
    cam_data.clip_end = 100 * r
    cam = bpy.data.objects.new("icon_cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    C.look_at(cam, center, (0, -1, 0), 4 * r)
    cam.rotation_euler = (math.pi / 2, 0, 0)  # look along +Y, image up = +Z, image right = +X
    vspan = cam_data.ortho_scale * H / W
    if hi.z - lo.z > vspan:
        print("WARNING: model is taller than the frame; lower --fill")

    tmp = os.path.splitext(os.path.abspath(a.out))[0] + "_tmp_render.png"
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp, check_existing=False)
    arr = C.image_to_array(img).astype(np.float64)
    bpy.data.images.remove(img)
    os.remove(tmp)
    if ss > 1:
        pre = arr.copy()
        pre[:, :, :3] *= pre[:, :, 3:4]  # premultiply, resample, un-premultiply
        small = C.resize(pre.astype(np.float32), W, H).astype(np.float64)
        alpha = np.clip(small[:, :, 3:4], 0, 1)
        rgb = np.where(alpha > 1e-4, small[:, :, :3] / np.maximum(alpha, 1e-4), 0)
        arr = np.concatenate([np.clip(rgb, 0, 1), alpha], axis=2)
    out = C.save_array(arr.astype(np.float32), os.path.abspath(a.out), fmt="PNG")
    bpy.data.images.remove(out)
    a_ch = arr[:, :, 3]
    cols = np.nonzero(a_ch.max(0) > 0.05)[0]
    rows = np.nonzero(a_ch.max(1) > 0.05)[0]
    print("ICON %s %dx%d  model spans x %d..%d (%.0f%% of width), y %d..%d" % (
        os.path.basename(a.out), W, H, cols.min(), cols.max(), 100.0 * (cols.max() - cols.min() + 1) / W,
        rows.min(), rows.max()))


main()
