"""Convert a model (glTF/GLB/FBX/OBJ/blend) into a light, game-ready GLB for three.js.

Usage:
  blender -b --factory-startup --python scripts/blender/convert_prop.py -- \
      --in MODEL --out OUT.glb --tris 600 --tex 512 [options]

Default ("prop") mode joins every selected mesh into one object, applies all transforms, rotates the
longest horizontal side onto glTF +Z, puts the origin at the bottom centre (lowest vertex at y=0,
centred in x/z), collapse-decimates to the triangle budget, rebuilds at most --max-materials
materials with a base-colour JPEG (no roughness/metal/AO maps: constant values instead, estimated
from the source maps unless given) and exports a GLB. Then it re-imports the GLB and prints stats.

Geometry / texture strategies:
  (default)          decimate, keep the source UVs and downscale the source textures.
  --bake             decimate, re-unwrap (Smart UV) and bake base colour (and --normal) from the
                     original high-poly with Cycles. Robust when heavy decimation would smear UVs.
  --proxy hull       build the low-poly from the convex hull of the parts (optionally only those in
                     --proxy-parts-in) and bake onto it; for models made of many small pieces.
  --cards REGEX      materials made of alpha-cutout cards (foliage). Cards are never collapse-
                     decimated: whole cards are randomly (spatially stratified) removed, survivors are
                     enlarged by (total/kept)^--card-grow-exp (max --card-grow-max) and, where the
                     atlas allows it without picking up neighbouring sprites, rebuilt as 2-triangle
                     quads. Card materials export as alphaMode MASK (WebP or PNG with alpha).

Options (glTF axes for boxes: x, y up, z front; metres, before re-orientation; write boxes that
start with a minus sign as --keep-parts-in=-1,0,-1,1,2,1 so argparse doesn't read them as a flag):
  --objects REGEX / --exclude REGEX     select mesh objects by name
  --keep-parts-in x0,y0,z0,x1,y1,z1     keep only loose parts whose bbox centre is inside the box
  --proxy-parts-in BOX, --proxy-min-part-size M   which parts shape the --proxy hull
  --min-part-size M                     drop loose solid parts smaller than M metres (diagonal)
  --fill-holes --min-tris-per-part N    for many open tubes (branches): cap them, keep only the
                                        largest parts that can get N triangles each, then decimate
  --base-map REGEX=PATH                 replace a material's base colour image (broken downloads)
  --align long-z|none  --yaw DEG        orientation (yaw = extra turn about the up axis)
  --scale F | --height M | --length M   uniform scale
  --origin bottom|keep
  --normal                              include a normal map (JPEG); baked when --bake/--proxy
  --alpha-map REGEX=PATH                opacity image for materials whose base colour lacks alpha
  --roughness auto|V  --metallic auto|V --mat-props "REGEX:metal=1,rough=0.35;REGEX2:rough=0.6"
  --double-sided                        export non-card materials double-sided (cards always are)
  --keep-objects --max-tris-per-mesh N  keep mesh objects/names/hierarchy/placement (vehicles with
                                        wheels, multi-part models, rigged/animated FBX); only meshes
                                        above N triangles are decimated (UV seams protected); with
                                        --tris the total is split over the meshes by size. Textures
                                        are resized per material, names and alpha modes kept.
  --tangents auto|yes|no                export tangents (auto: when a normal map is present)
Run with --help for the full list.

Examples:
  ... -- --in boulder.gltf --out boulder.glb --tris 600 --bake --normal --sharp-angle 180
  ... -- --in bush.gltf --objects "_a$" --out bush.glb --tris 900 --cards "leaves|twigs" \
         --alpha-map "leaves|twigs=textures/bush_alpha.png" --min-part-size 0.03
  ... -- --in scene.gltf --out r25.glb --keep-objects --max-tris-per-mesh 3000 --normal \
         --mat-props "Capsula:metal=1,rough=0.35;Projetil:metal=0,rough=0.5"
  ... -- --in truck/scene.gltf --out truck.glb --keep-objects --tris 3000     (Sketchfab vehicle)
  ... -- --in character.fbx --out soldier.glb --keep-objects --tris 2500     (Mixamo: keeps rig + clips)
scripts/blender/build_assets.py holds the exact settings used for public/assets/props and the rounds.
"""
import argparse
import math
import os
import re
import shutil
import sys
import tempfile
import time

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # keep the scripts folder free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as C  # noqa: E402

log = C.log


# ------------------------------------------------------------------------------------- arguments

def parse_args():
    p = argparse.ArgumentParser(prog="convert_prop.py")
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--name", default=None, help="object/material base name (default: output stem)")
    p.add_argument("--tris", type=int, default=None,
                   help="triangle budget for the whole file (prop mode default 1000; with --keep-objects "
                        "an optional total split over the meshes in proportion to their size)")
    p.add_argument("--tex", type=int, default=512, help="max texture size")
    p.add_argument("--jpeg-quality", type=int, default=85)
    p.add_argument("--normal", action="store_true", help="include a normal map")
    p.add_argument("--normal-format", choices=["jpeg", "png"], default="jpeg")
    p.add_argument("--normal-quality", type=int, default=90)
    p.add_argument("--objects", default=None)
    p.add_argument("--exclude", default=None)
    p.add_argument("--keep-parts-in", default=None)
    p.add_argument("--min-part-size", type=float, default=0.0)
    p.add_argument("--align", choices=["long-z", "none"], default="long-z")
    p.add_argument("--yaw", type=float, default=0.0)
    p.add_argument("--scale", type=float, default=None)
    p.add_argument("--height", type=float, default=None)
    p.add_argument("--length", type=float, default=None)
    p.add_argument("--origin", choices=["bottom", "keep"], default=None)
    p.add_argument("--bake", action="store_true")
    p.add_argument("--proxy", choices=["none", "hull"], default="none")
    p.add_argument("--proxy-parts-in", default=None)
    p.add_argument("--proxy-min-part-size", type=float, default=0.0,
                   help="only parts at least this big (bbox diagonal, m) shape the hull")
    p.add_argument("--proxy-dissolve", type=float, default=3.0, help="planar dissolve angle (deg) for the hull")
    p.add_argument("--bake-skip-materials", default=None, help="regex: materials hidden from the bake source")
    p.add_argument("--bake-extrusion", type=float, default=0.02, help="cage extrusion, fraction of bbox diagonal")
    p.add_argument("--bake-ray", type=float, default=0.06, help="max ray distance, fraction of bbox diagonal")
    p.add_argument("--bake-samples", type=int, default=16)
    p.add_argument("--bake-supersample", type=int, default=2)
    p.add_argument("--uv-angle", type=float, default=66.0)
    p.add_argument("--uv-margin", type=float, default=0.012)
    p.add_argument("--protect-seams", choices=["auto", "yes", "no"], default="auto")
    p.add_argument("--merge-dist", type=float, default=1e-6, help="merge-by-distance, fraction of bbox diagonal")
    p.add_argument("--cards", default=None, help="regex of card (foliage) materials")
    p.add_argument("--card-share", type=float, default=0.7, help="fraction of --tris for cards")
    p.add_argument("--card-material-share", default="", help='e.g. "twigs=0.15" (fraction of card budget)')
    p.add_argument("--card-grow-exp", type=float, default=0.5)
    p.add_argument("--card-grow-max", type=float, default=3.0)
    p.add_argument("--card-quads", choices=["auto", "no"], default="auto")
    p.add_argument("--card-max-frac", type=float, default=0.2,
                   help="enlarged cards stay below this fraction of the crown diagonal")
    p.add_argument("--min-tris-per-part", type=int, default=0,
                   help="keep only the largest parts that can get at least this many triangles each")
    p.add_argument("--card-leak", type=float, default=0.04,
                   help="max fraction of a quad-ified card showing a neighbouring atlas sprite")
    p.add_argument("--fill-holes", action="store_true",
                   help="cap open boundaries of the solid part before decimating (open tubes, branches)")
    p.add_argument("--alpha-map", action="append", default=[], help="REGEX=PATH (repeatable)")
    p.add_argument("--base-map", action="append", default=[],
                   help="REGEX=PATH: replace the base colour image of matching materials (repeatable)")
    p.add_argument("--alpha-format", choices=["webp", "png"], default="webp")
    p.add_argument("--alpha-quality", type=int, default=90)
    p.add_argument("--alpha-cutoff", type=float, default=0.5)
    p.add_argument("--roughness", default="auto")
    p.add_argument("--metallic", default="auto")
    p.add_argument("--mat-props", default="")
    p.add_argument("--sharp-angle", type=float, default=40.0, help="smooth shading with sharp edges above this angle")
    p.add_argument("--double-sided", action="store_true")
    p.add_argument("--tangents", choices=["auto", "yes", "no"], default="auto")
    p.add_argument("--keep-objects", action="store_true")
    p.add_argument("--max-tris-per-mesh", type=int, default=None)
    p.add_argument("--max-materials", type=int, default=2)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--work-dir", default=None, help="where intermediate textures go (default: temp)")
    p.add_argument("--preview", default=None, help="render a preview sheet PNG of the result")
    a = p.parse_args(C.script_args())
    if a.origin is None:
        a.origin = "keep" if a.keep_objects else "bottom"
    if a.tris is None and not a.keep_objects:
        a.tris = 1000
    if a.proxy != "none":
        a.bake = True
    return a


def parse_box(s):
    """glTF-axes box string -> Blender-axes (lo, hi) arrays."""
    v = [float(x) for x in s.split(",")]
    if len(v) != 6:
        raise SystemExit("box needs 6 numbers: x0,y0,z0,x1,y1,z1")
    gx0, gy0, gz0, gx1, gy1, gz1 = v
    lo = np.array([min(gx0, gx1), -max(gz0, gz1), min(gy0, gy1)])
    hi = np.array([max(gx0, gx1), -min(gz0, gz1), max(gy0, gy1)])
    return lo, hi


def parse_mat_props(s):
    out = []
    for item in [x for x in s.split(";") if x.strip()]:
        pat, _, rest = item.partition(":")
        props = {}
        for kv in rest.split(","):
            k, _, v = kv.partition("=")
            k = k.strip().lower()
            if k:
                props[{"metal": "metallic", "rough": "roughness"}.get(k, k)] = float(v)
        out.append((re.compile(pat.strip(), re.I), props))
    return out


# ---------------------------------------------------------------------------------- mesh helpers

def vertex_components(nv, edges):
    """Connected-component label per vertex (min-label propagation with pointer jumping)."""
    lab = np.arange(nv)
    if len(edges) == 0:
        return lab
    e0, e1 = edges[:, 0], edges[:, 1]
    for _ in range(10000):
        m = np.minimum(lab[e0], lab[e1])
        new = lab.copy()
        np.minimum.at(new, e0, m)
        np.minimum.at(new, e1, m)
        new = new[new]
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    while True:
        nn = lab[lab]
        if np.array_equal(nn, lab):
            return lab
        lab = nn


def face_parts(me):
    """Per-polygon part label (connected through shared vertices)."""
    nv = len(me.vertices)
    ed = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", ed)
    lab = vertex_components(nv, ed.reshape(-1, 2))
    lstart = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get("loop_start", lstart)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    return lab[lv[lstart]]


def poly_material_indices(me):
    mi = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get("material_index", mi)
    return mi


def delete_polys(ob, mask):
    """Delete polygons where mask is True (plus loose verts/edges left behind)."""
    if not mask.any():
        return
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    dead = [bm.faces[i] for i in np.nonzero(mask)[0]]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def part_bounds(me, parts):
    """Per-part bbox (lo, hi) arrays indexed by part label (dense remap)."""
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lstart = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get("loop_start", lstart)
    ltot = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get("loop_total", ltot)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    poly_of_loop = np.repeat(np.arange(len(me.polygons)), ltot)
    uniq, dense = np.unique(parts, return_inverse=True)
    lp = dense[poly_of_loop]
    lo = np.full((len(uniq), 3), 1e30)
    hi = np.full((len(uniq), 3), -1e30)
    np.minimum.at(lo, lp, co[lv])
    np.maximum.at(hi, lp, co[lv])
    return dense, lo, hi


def merge_by_distance(ob, dist):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def triangulate(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.validate(clean_customdata=False)
    ob.data.update()


def cleanup(ob, dist):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges[:])
    loose_e = [e for e in bm.edges if not e.link_faces]
    if loose_e:
        bmesh.ops.delete(bm, geom=loose_e, context='EDGES')
    loose_v = [v for v in bm.verts if not v.link_faces]
    if loose_v:
        bmesh.ops.delete(bm, geom=loose_v, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def set_normals(ob, sharp_angle):
    """Drop imported custom normals; smooth shading split at edges sharper than sharp_angle."""
    C.select_only([ob])
    me = ob.data
    if me.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    me.shade_smooth()
    if sharp_angle < 180:
        me.set_sharp_from_angle(angle=math.radians(sharp_angle))
    me.update()


def seam_vertex_group(ob, name="__seams"):
    """Vertex group of verts that sit on a UV seam (loops with different UVs)."""
    me = ob.data
    if not me.uv_layers:
        return None
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    lv = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    nv = len(me.vertices)
    umin = np.full((nv, 2), 1e9)
    umax = np.full((nv, 2), -1e9)
    np.minimum.at(umin, lv, uv)
    np.maximum.at(umax, lv, uv)
    seam = np.nonzero((umax - umin).max(1) > 1e-5)[0]
    if len(seam) == 0:
        return None
    vg = ob.vertex_groups.new(name=name)
    vg.add(seam.tolist(), 1.0, 'REPLACE')
    return vg.name


def fill_holes(ob):
    """Cap open boundaries; cap loops get the mean UV of their vertices (so they sample nearby
    texture instead of the atlas corner)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    old = set(bm.faces)
    bnd = [e for e in bm.edges if e.is_boundary]
    if not bnd:
        bm.free()
        return 0
    bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
    new = [f for f in bm.faces if f not in old]
    if uvl is not None:
        for f in new:
            for loop in f.loops:
                uvs = [l[uvl].uv.copy() for l in loop.vert.link_loops if l.face in old]
                if uvs:
                    loop[uvl].uv = sum(uvs, uvs[0] * 0) / len(uvs)
    bmesh.ops.triangulate(bm, faces=new)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return len(new)


def reduce_to_budget(ob, budget, protect_group=None, max_rounds=40, min_tris_per_part=0):
    """Collapse-decimate; if that stalls above budget (many small separate pieces whose
    boundaries resist collapsing), drop the smallest parts and decimate again.
    min_tris_per_part > 0 first keeps only the budget // min_tris_per_part largest parts."""
    if min_tris_per_part > 0 and C.tri_count(ob) > budget:
        dense, plo, phi = part_bounds(ob.data, face_parts(ob.data))
        size = np.linalg.norm(phi - plo, axis=1)
        m = max(1, budget // min_tris_per_part)
        if len(size) > m:
            dead = np.ones(len(size), bool)
            dead[np.argsort(-size)[:m]] = False
            delete_polys(ob, dead[dense])
            log("kept the %d largest of %d parts (>= %.3f m)" % (m, len(size), np.sort(size)[::-1][m - 1]))
    n = decimate_to(ob, budget, protect_group)
    rounds = 0
    while n > budget and rounds < max_rounds and len(ob.data.polygons):
        rounds += 1
        dense, plo, phi = part_bounds(ob.data, face_parts(ob.data))
        size = np.linalg.norm(phi - plo, axis=1)
        tris_per_part = np.bincount(dense, minlength=len(size))
        order = np.argsort(size)
        excess = n - budget
        cum = np.cumsum(tris_per_part[order])
        k = int(np.searchsorted(cum, excess * 0.6)) + 1
        k = max(k, int(0.1 * len(size)), 1)
        k = min(k, len(size) - 1) if len(size) > 1 else 1
        dead = np.zeros(len(size), bool)
        dead[order[:k]] = True
        delete_polys(ob, dead[dense])
        n = decimate_to(ob, budget, protect_group if (protect_group and protect_group in ob.vertex_groups) else None)
        log("  dropped %d smallest parts (< %.3f m) -> %d tris" % (k, size[order[k - 1]], n))
    return n


def evaluated_tris(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    me = eo.to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    eo.to_mesh_clear()
    return n


def _search_ratio(ob, mod, cur, target):
    """Largest decimate ratio whose result has <= target triangles: (ratio, tris) or (None, tris)."""
    lo, hi = 0.0, 1.0
    best, best_n = None, None
    ratio = target / cur
    n = cur
    for _ in range(24):
        mod.ratio = ratio
        n = evaluated_tris(ob)
        if n <= target:
            if best is None or ratio > best:
                best, best_n = ratio, n
            lo = max(lo, ratio)
            if n >= target * 0.985:
                break
        else:
            hi = min(hi, ratio)
        guess = ratio * target / max(n, 1) * (0.997 if n > target else 1.0)
        if not (lo < guess < hi):
            guess = (lo + hi) / 2
        if abs(guess - ratio) < 1e-7:
            break
        ratio = guess
    return best, (best_n if best is not None else n)


def decimate_to(ob, target, protect_group=None):
    """Collapse-decimate ob to at most target triangles (searching the ratio). UV-seam vertices
    in protect_group resist collapsing; the protection is weakened step by step (and finally
    dropped) when it would keep the mesh above target. Returns the new triangle count."""
    cur = C.tri_count(ob)
    if cur <= target:
        return cur
    if ob.data.shape_keys:
        log("WARNING %s has shape keys; Blender can't apply Decimate to it, left at %d tris" % (ob.name, cur))
        return cur
    mod = ob.modifiers.new("__decimate", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.use_collapse_triangulate = True
    C.select_only([ob])
    if len(ob.modifiers) > 1:  # e.g. an Armature modifier: decimate the rest-pose base mesh
        bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
        mod = ob.modifiers[0]
    # Collapse mode: group weight 1 = free, 0 = costly. Seam verts are in the group, so invert it.
    factors = [1.0, 0.1, 0.01, 0.001, 0.0] if protect_group else [0.0]
    chosen = None
    for f in factors:
        if f > 0:
            mod.vertex_group = protect_group
            mod.invert_vertex_group = True
            mod.vertex_group_factor = f
        else:
            mod.vertex_group = ""
        ratio, n = _search_ratio(ob, mod, cur, target)
        if ratio is not None:
            chosen = (ratio, f)
            break
    if chosen is None:
        log("WARNING %s: decimation cannot get below %d tris (target %d)" % (ob.name, n, target))
        mod.ratio = 0.0
    else:
        mod.ratio = chosen[0]
        if protect_group and chosen[1] < 1.0:
            log("  %s: seam protection weakened to %g to reach %d tris" % (ob.name, chosen[1], target))
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if protect_group and protect_group in ob.vertex_groups:
        ob.vertex_groups.remove(ob.vertex_groups[protect_group])
    ob.data.validate(clean_customdata=False)
    return C.tri_count(ob)


def transform_mesh(ob, mat):
    ob.data.transform(mat)
    if mat.determinant() < 0:
        ob.data.flip_normals()
    ob.data.update()


def mesh_bbox(ob):
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return co.min(0), co.max(0)


# ------------------------------------------------------------------------------ material helpers

def principled(mat):
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            return n
    return None


def upstream_image(socket, depth=0):
    """(image node, output name) of the first image texture feeding socket."""
    if socket is None or not socket.is_linked or depth > 10:
        return None, None
    link = socket.links[0]
    node = link.from_node
    if node.type == 'TEX_IMAGE':
        return node, link.from_socket.name
    for inp in node.inputs:
        if inp.is_linked:
            r = upstream_image(inp, depth + 1)
            if r[0] is not None:
                return r
    return None, None


def trace_base(socket, depth=0):
    """(image or None, linear RGBA factor) feeding a Base Color input: an image, an image times a
    constant colour (glTF baseColorFactor -> Mix Multiply), or a constant colour."""
    if not socket.is_linked:
        return None, tuple(socket.default_value)
    node = socket.links[0].from_node
    if node.type == 'TEX_IMAGE':
        return node.image, (1.0, 1.0, 1.0, 1.0)
    if depth < 6 and node.type in ('MIX', 'MIX_RGB') and node.blend_type == 'MULTIPLY':
        ins = [i for i in node.inputs if i.identifier in ('A_Color', 'B_Color', 'Color1', 'Color2')]
        linked = [i for i in ins if i.is_linked]
        const = [i for i in ins if not i.is_linked]
        if len(linked) == 1 and len(const) == 1:
            img, f = trace_base(linked[0], depth + 1)
            c = tuple(const[0].default_value)
            return img, tuple(f[k] * c[k] for k in range(4))
    img_node, _ = upstream_image(socket)
    return (img_node.image if img_node is not None else None), (1.0, 1.0, 1.0, 1.0)


def source_alpha(bsdf):
    """Alpha mode of an imported material: ('OPAQUE'|'MASK'|'BLEND', cutoff, constant alpha)."""
    sock = bsdf.inputs["Alpha"]
    if not sock.is_linked:
        a = float(sock.default_value)
        return ("OPAQUE" if a >= 0.999 else "BLEND"), 0.5, a
    node = sock.links[0].from_node
    if node.type == 'MATH':
        if node.operation == 'ROUND':
            return "MASK", 0.5, 1.0
        if node.operation == 'SUBTRACT' and node.inputs[1].is_linked:
            n2 = node.inputs[1].links[0].from_node
            if n2.type == 'MATH' and n2.operation == 'LESS_THAN':
                return "MASK", float(n2.inputs[1].default_value), 1.0
        if node.operation == 'GREATER_THAN' and not node.inputs[1].is_linked:
            return "MASK", float(node.inputs[1].default_value), 1.0
    return "BLEND", 0.5, 1.0


def trace_scalar(socket, depth=0):
    """(image, channel, factor, const) for a scalar BSDF input fed by a texture channel."""
    if not socket.is_linked:
        return None, None, 1.0, float(socket.default_value)
    if depth > 10:
        return None, None, 1.0, 0.5
    link = socket.links[0]
    node, out = link.from_node, link.from_socket
    if node.type in ('SEPARATE_COLOR', 'SEPRGB', 'SEPARATE_RGB'):
        ch = {"Red": 0, "Green": 1, "Blue": 2, "R": 0, "G": 1, "B": 2}.get(out.name, 0)
        img, _ = upstream_image(node.inputs[0])
        return (img.image if img else None), ch, 1.0, 0.5
    if node.type == 'MATH' and node.operation == 'MULTIPLY':
        a, b = node.inputs[0], node.inputs[1]
        if a.is_linked and not b.is_linked:
            i, c, f, k = trace_scalar(a, depth + 1)
            return i, c, f * b.default_value, k * b.default_value
        if b.is_linked and not a.is_linked:
            i, c, f, k = trace_scalar(b, depth + 1)
            return i, c, f * a.default_value, k * a.default_value
    if node.type == 'TEX_IMAGE':
        return node.image, (3 if out.name == "Alpha" else 0), 1.0, 0.5
    return None, None, 1.0, 0.5


class SlotInfo:
    pass


def analyse_slots(ob, args, card_re, alpha_maps, base_maps=()):
    """Describe each material slot: base image, alpha use, normal map, rough/metal estimates."""
    me = ob.data
    A = C.mesh_arrays(me)
    areas = C.tri_areas(A["co"], A["verts"])
    arr_cache = {}

    def arr(img):
        if img.name not in arr_cache:
            arr_cache[img.name] = C.image_to_array(img)
        return arr_cache[img.name]

    infos = []
    for si, slot in enumerate(ob.material_slots):
        m = slot.material
        s = SlotInfo()
        s.index = si
        s.name = m.name if m else "material_%d" % si
        s.material = m
        bsdf = principled(m)
        s.base_img = None
        s.base_color = (0.8, 0.8, 0.8, 1.0)
        s.base_factor = (1.0, 1.0, 1.0, 1.0)
        s.normal_img = None
        s.alpha_used = False
        s.double = bool(m and not m.use_backface_culling)
        sel = A["mats"] == si
        s.area = float(areas[sel].sum())
        s.tris = int(sel.sum())
        rough_spec = (None, None, 1.0, 0.8)
        metal_spec = (None, None, 1.0, 0.0)
        if bsdf is not None:
            node, _ = upstream_image(bsdf.inputs["Base Color"])
            for pat, path in base_maps:
                if pat.search(s.name) and node is not None:
                    node.image = bpy.data.images.load(path, check_existing=True)
                    log("slot %d base colour replaced by %s" % (si, os.path.basename(path)))
            img, fac = trace_base(bsdf.inputs["Base Color"])
            if img is not None and img.size[0] > 0:
                s.base_img = img
                s.base_factor = tuple(round(v, 4) for v in fac)
            elif not bsdf.inputs["Base Color"].is_linked:
                s.base_color = tuple(bsdf.inputs["Base Color"].default_value)
            s.alpha_used = bsdf.inputs["Alpha"].is_linked or bsdf.inputs["Alpha"].default_value < 0.999
            nnode, _ = upstream_image(bsdf.inputs["Normal"])
            if nnode is not None and nnode.image is not None and nnode.image.size[0] > 0:
                s.normal_img = nnode.image
            rough_spec = trace_scalar(bsdf.inputs["Roughness"])
            metal_spec = trace_scalar(bsdf.inputs["Metallic"])
        s.card = bool(card_re and card_re.search(s.name))
        s.alpha_map = None
        for pat, path in alpha_maps:
            if pat.search(s.name):
                s.alpha_map = path
        s.mask = s.card or s.alpha_map is not None or (s.alpha_used and s.base_img is not None)
        # area-weighted texture estimates at triangle UV centroids
        uvc = None
        if A["uv"] is not None and sel.any():
            uvc = A["uv"][A["loops"][sel]].mean(axis=1)
            w = areas[sel] / max(areas[sel].sum(), 1e-12)

        def estimate(spec):
            img, ch, fac, const = spec
            if img is None or uvc is None or img.size[0] == 0:
                return const
            vals = C.sample_image_at_uvs(arr(img), uvc)[:, ch]
            return float((vals * w).sum() * fac)
        s.rough = min(max(estimate(rough_spec), 0.0), 1.0)
        s.metal = min(max(estimate(metal_spec), 0.0), 1.0)
        infos.append(s)
        log("slot %d %-34s tris=%6d base=%s alpha=%s card=%s normal=%s rough=%.2f metal=%.2f" % (
            si, s.name, s.tris, s.base_img.name if s.base_img else None, s.mask, s.card,
            s.normal_img.name if s.normal_img else None, s.rough, s.metal))
    return infos


def make_material(name, base_img=None, base_color=(0.8, 0.8, 0.8, 1.0), normal_img=None,
                  rough=0.8, metal=0.0, mask=False, cutoff=0.5, double=False, blend=False, alpha_value=1.0):
    """Principled material the glTF exporter maps 1:1: base colour texture or colour, optional
    normal map, constant roughness/metalness, alphaMode MASK (mask=True, cutoff) or BLEND."""
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    nodes = nt.nodes
    bsdf = principled(m)
    if bsdf is None:
        for n in list(nodes):
            nodes.remove(n)
        bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        out = nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    if base_img is not None:
        t = nodes.new("ShaderNodeTexImage")
        t.image = base_img
        t.location = (-500, 300)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if blend:
            if alpha_value < 0.999:
                mul = nodes.new("ShaderNodeMath")
                mul.operation = 'MULTIPLY'
                mul.inputs[1].default_value = alpha_value
                nt.links.new(t.outputs["Alpha"], mul.inputs[0])
                nt.links.new(mul.outputs[0], bsdf.inputs["Alpha"])
            else:
                nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
            m.surface_render_method = 'BLENDED'
        elif mask:
            if abs(cutoff - 0.5) < 1e-6:
                r = nodes.new("ShaderNodeMath")
                r.operation = 'ROUND'
                nt.links.new(t.outputs["Alpha"], r.inputs[0])
                nt.links.new(r.outputs[0], bsdf.inputs["Alpha"])
            else:
                lt = nodes.new("ShaderNodeMath")
                lt.operation = 'LESS_THAN'
                lt.inputs[1].default_value = cutoff
                sub = nodes.new("ShaderNodeMath")
                sub.operation = 'SUBTRACT'
                sub.inputs[0].default_value = 1.0
                nt.links.new(t.outputs["Alpha"], lt.inputs[0])
                nt.links.new(lt.outputs[0], sub.inputs[1])
                nt.links.new(sub.outputs[0], bsdf.inputs["Alpha"])
    else:
        bsdf.inputs["Base Color"].default_value = base_color
        if blend:
            bsdf.inputs["Alpha"].default_value = alpha_value
            m.surface_render_method = 'BLENDED'
    if normal_img is not None:
        normal_img.colorspace_settings.name = 'Non-Color'
        t2 = nodes.new("ShaderNodeTexImage")
        t2.image = normal_img
        t2.location = (-700, -200)
        nm = nodes.new("ShaderNodeNormalMap")
        nm.location = (-300, -200)
        nt.links.new(t2.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    m.use_backface_culling = not double
    return m


def apply_mat_props(names, rough, metal, mat_props):
    for pat, props in mat_props:
        if any(pat.search(n) for n in names):
            rough = props.get("roughness", rough)
            metal = props.get("metallic", metal)
    return rough, metal


# ------------------------------------------------------------------------------------- textures

class TexWriter:
    def __init__(self, args, workdir, stem):
        self.a = args
        self.dir = workdir
        self.stem = stem
        self.cache = {}
        self.names = set()

    def _unique(self, label):
        name = "%s_%s" % (self.stem, label)
        i = 1
        while name in self.names:
            i += 1
            name = "%s_%s_%d" % (self.stem, label, i)
        self.names.add(name)
        return name

    def _target_size(self, w, h):
        f = min(1.0, self.a.tex / max(w, h))
        return max(1, int(round(w * f))), max(1, int(round(h * f)))

    def base(self, img, alpha_path=None, with_alpha=False, label="basecolor", factor=None):
        factor = tuple(factor) if factor is not None else (1.0, 1.0, 1.0, 1.0)
        key = (img.name, alpha_path, with_alpha, factor)
        if key in self.cache:
            return self.cache[key]
        if not with_alpha:
            # an RGBA version may already exist for this image: share it
            for k, v in self.cache.items():
                if len(k) == 4 and k[0] == img.name and k[2] and k[3] == factor:
                    return v
        arr = C.image_to_array(img)
        if factor != (1.0, 1.0, 1.0, 1.0):  # bake a baseColorFactor into the texture (linear space)
            arr = arr.copy()
            rgb = arr[:, :, :3]
            lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
            lin = lin * np.array(factor[:3], np.float32)
            arr[:, :, :3] = np.where(lin <= 0.0031308, lin * 12.92,
                                     1.055 * np.power(np.maximum(lin, 0), 1 / 2.4) - 0.055)
            arr[:, :, 3] *= factor[3]
        if with_alpha:
            if alpha_path:
                ai = bpy.data.images.load(alpha_path, check_existing=True)
                am = C.image_to_array(ai)
                if am.shape[:2] != arr.shape[:2]:
                    am = C.resize(am, arr.shape[1], arr.shape[0])
                arr = arr.copy()
                arr[:, :, 3] = am[:, :, 0]
            arr = C.bleed_alpha(arr)
        w, h = self._target_size(arr.shape[1], arr.shape[0])
        arr = np.clip(C.resize(arr, w, h), 0, 1)
        if with_alpha:
            arr = C.bleed_alpha(arr, threshold=0.05)
            fmt = "WEBP" if self.a.alpha_format == "webp" else "PNG"
            ext = ".webp" if fmt == "WEBP" else ".png"
            q = self.a.alpha_quality
        else:
            fmt, ext, q = "JPEG", ".jpg", self.a.jpeg_quality
        name = self._unique(label)
        out = C.save_array(arr, os.path.join(self.dir, name + ext), fmt=fmt, quality=q, name=name)
        self.cache[key] = out
        return out

    def normal(self, img, label="normal"):
        key = ("__normal__", img.name)
        if key in self.cache:
            return self.cache[key]
        arr = C.image_to_array(img)
        w, h = self._target_size(arr.shape[1], arr.shape[0])
        arr = C.renormalize_normals(np.clip(C.resize(arr, w, h), 0, 1))
        return self.normal_from_array(arr, key, label)

    def normal_from_array(self, arr, key, label="normal"):
        fmt = "JPEG" if self.a.normal_format == "jpeg" else "PNG"
        ext = ".jpg" if fmt == "JPEG" else ".png"
        name = self._unique(label)
        out = C.save_array(arr, os.path.join(self.dir, name + ext), fmt=fmt, quality=self.a.normal_quality, name=name)
        out.colorspace_settings.name = 'Non-Color'
        self.cache[key] = out
        return out


# ---------------------------------------------------------------------------------------- cards

def convex_hull_2d(pts):
    pts = np.unique(np.round(pts, 7), axis=0)
    if len(pts) < 3:
        return pts
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def min_area_rect(hull):
    if len(hull) < 3:
        lo, hi = hull.min(0), hull.max(0)
        return np.array([[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]])
    best = None
    n = len(hull)
    for i in range(n):
        e = hull[(i + 1) % n] - hull[i]
        L = np.hypot(*e)
        if L < 1e-12:
            continue
        ux = e / L
        uy = np.array([-ux[1], ux[0]])
        px, py = hull @ ux, hull @ uy
        area = (px.max() - px.min()) * (py.max() - py.min())
        if best is None or area < best[0]:
            best = (area, ux, uy, px.min(), px.max(), py.min(), py.max())
    _, ux, uy, x0, x1, y0, y1 = best
    return np.array([x0 * ux + y0 * uy, x1 * ux + y0 * uy, x1 * ux + y1 * uy, x0 * ux + y1 * uy])


def points_in_tris(P, tri):
    """P (N,2), tri (T,3,2) -> bool (N,) inside any triangle."""
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    v0 = (c - a)[None]
    v1 = (b - a)[None]
    v2 = P[:, None, :] - a[None]
    d00 = (v0 * v0).sum(-1)
    d01 = (v0 * v1).sum(-1)
    d11 = (v1 * v1).sum(-1)
    d20 = (v2 * v0).sum(-1)
    d21 = (v2 * v1).sum(-1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-20, 1e-20, den)
    u = (d11 * d20 - d01 * d21) / den
    v = (d00 * d21 - d01 * d20) / den
    eps = 1e-6
    return ((u >= -eps) & (v >= -eps) & (u + v <= 1 + eps)).any(1)


def label_mask(mask):
    """4-connected component labels of a bool image (background = -1)."""
    h, w = mask.shape
    big = h * w
    idx = np.arange(big).reshape(h, w)
    lab = np.where(mask, idx, big)
    for _ in range(5000):
        m = lab.copy()
        both_v = mask[1:, :] & mask[:-1, :]
        both_h = mask[:, 1:] & mask[:, :-1]
        m[1:, :] = np.where(both_v, np.minimum(m[1:, :], lab[:-1, :]), m[1:, :])
        m[:-1, :] = np.where(both_v, np.minimum(m[:-1, :], lab[1:, :]), m[:-1, :])
        m[:, 1:] = np.where(both_h, np.minimum(m[:, 1:], lab[:, :-1]), m[:, 1:])
        m[:, :-1] = np.where(both_h, np.minimum(m[:, :-1], lab[:, 1:]), m[:, :-1])
        flat = m.reshape(-1)
        valid = flat < big
        flat[valid] = flat[flat[valid]]
        if np.array_equal(m, lab):
            break
        lab = m
    return np.where(mask, lab, -1)


class SpriteAtlas:
    """Alpha map + sprite labels for the leak test of quad-ified cards."""

    def __init__(self, alpha):  # alpha (h, w) row 0 = bottom
        self.alpha = alpha
        self.h, self.w = alpha.shape
        self.labels = label_mask(alpha > 0.5)

    def sample(self, P):
        x = np.clip((np.mod(P[:, 0], 1.0) * self.w).astype(int), 0, self.w - 1)
        y = np.clip((np.mod(P[:, 1], 1.0) * self.h).astype(int), 0, self.h - 1)
        return self.alpha[y, x], self.labels[y, x]


def quad_for_card(uv, co, atlas, cache, max_err=0.12, max_overdraw=6.0, max_leak=0.04):
    """Fit a 2-triangle quad that shows the same sprite as the card, or None if unsafe."""
    size = np.linalg.norm(co.max(0) - co.min(0))
    X = np.c_[uv, np.ones(len(uv))]
    M, _res, rank, _sv = np.linalg.lstsq(X, co, rcond=None)
    if rank < 3 or size <= 0:
        return None
    if np.abs(X @ M - co).max() / size > max_err:
        return None
    key = tuple(np.round(uv, 5).reshape(-1))
    if key not in cache:
        uvt = uv.reshape(-1, 3, 2)
        rect = min_area_rect(convex_hull_2d(uv))
        ok = atlas is not None
        if ok:
            e1, e2 = rect[1] - rect[0], rect[3] - rect[0]
            rect_area = abs(e1[0] * e2[1] - e1[1] * e2[0])
            d1, d2 = uvt[:, 1] - uvt[:, 0], uvt[:, 2] - uvt[:, 0]
            poly_area = 0.5 * np.abs(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]).sum()
            ok = poly_area > 0 and rect_area / poly_area <= max_overdraw
        if ok:
            G = 40
            s = (np.arange(G) + 0.5) / G
            P = (rect[0] + s[:, None, None] * e1 + s[None, :, None] * e2).reshape(-1, 2)
            inside = points_in_tris(P, uvt)
            a, lab = atlas.sample(P)
            own = set(np.unique(lab[inside & (a > 0.5)]).tolist()) - {-1}
            foreign = (~inside) & (a > 0.5) & ~np.isin(lab, list(own))
            ok = len(own) > 0 and foreign.mean() < max_leak
        cache[key] = (rect, ok)
    rect, ok = cache[key]
    if not ok:
        return None
    corners = np.c_[rect, np.ones(4)] @ M
    return rect, corners


def analyse_cards(ob, args, atlases):
    """Split the card mesh into cards (connected pieces) and find which can become quads."""
    A = C.mesh_arrays(ob.data)
    if len(A["mats"]) == 0:
        return [], A
    tris_v = A["verts"]
    edges = np.concatenate([tris_v[:, [0, 1]], tris_v[:, [1, 2]], tris_v[:, [2, 0]]])
    lab = vertex_components(len(A["co"]), edges)
    comp = lab[tris_v[:, 0]]
    order = np.argsort(comp, kind="stable")
    _u, starts, counts = np.unique(comp[order], return_index=True, return_counts=True)
    fn = np.cross(A["co"][tris_v[:, 1]] - A["co"][tris_v[:, 0]], A["co"][tris_v[:, 2]] - A["co"][tris_v[:, 0]])
    cards = []
    cache = {}
    for k in range(len(starts)):
        t = order[starts[k]:starts[k] + counts[k]]
        slot = int(np.bincount(A["mats"][t]).argmax())
        uv = A["uv"][A["loops"][t].reshape(-1)]
        co = A["co"][tris_v[t].reshape(-1)]
        nrm = fn[t].sum(0)
        q = None
        if args.card_quads == "auto":
            q = quad_for_card(uv, co, atlases.get(slot), cache, max_leak=args.card_leak)
        area = 0.5 * np.linalg.norm(fn[t], axis=1)
        cen = (co.reshape(-1, 3, 3).mean(1) * area[:, None]).sum(0) / max(area.sum(), 1e-12)
        cards.append(dict(slot=slot, tris=t, uv=uv, co=co, normal=nrm, quad=q,
                          cost=2 if q is not None else len(t), center=cen))
    return cards, A


def thin_cards(ob, cards, A, infos, budget, args):
    """Replace the card mesh of ob by a thinned, enlarged subset that fits budget triangles."""
    me = ob.data
    if not cards:
        return 0
    rng = np.random.default_rng(args.seed)
    tris_v = A["verts"]
    # budget per material
    slots = sorted({c["slot"] for c in cards})
    shares = {}
    fixed = {}
    for item in [x for x in args.card_material_share.split(",") if x.strip()]:
        pat, _, v = item.partition("=")
        for s in slots:
            if re.search(pat.strip(), infos[s].name, re.I):
                fixed[s] = float(v)
    free = [s for s in slots if s not in fixed]
    rest = max(0.0, 1.0 - sum(fixed.values()))
    tot_free = sum(sum(c["cost"] for c in cards if c["slot"] == s) for s in free) or 1
    for s in slots:
        shares[s] = fixed[s] if s in fixed else rest * sum(c["cost"] for c in cards if c["slot"] == s) / tot_free
    need = {s: sum(c["cost"] for c in cards if c["slot"] == s) for s in slots}
    budgets = {s: budget * shares[s] for s in slots}
    for _ in range(3):  # hand budget a material can't use to the others
        spare = sum(max(0.0, budgets[s] - need[s]) for s in slots)
        hungry = [s for s in slots if budgets[s] < need[s]]
        if spare <= 0 or not hungry:
            break
        for s in slots:
            budgets[s] = min(budgets[s], need[s])
        tot = sum(shares[s] for s in hungry) or 1
        for s in hungry:
            budgets[s] += spare * shares[s] / tot
    kept = []
    for s in slots:
        group = [c for c in cards if c["slot"] == s]
        b = int(budgets[s])
        # spatially stratified random order: one card per cell per round
        P = np.array([c["center"] for c in group])
        want = max(1, b // 2)
        span = np.maximum(P.max(0) - P.min(0), 1e-6)
        cell = (np.prod(span) / want) ** (1 / 3)
        cid = np.floor((P - P.min(0)) / cell).astype(np.int64)
        keys = cid[:, 0] * 1000003 + cid[:, 1] * 1009 + cid[:, 2]
        perm = rng.permutation(len(group))
        rank = np.zeros(len(group), np.int64)
        seen = {}
        for i in perm:
            rank[i] = seen.get(keys[i], 0)
            seen[keys[i]] = rank[i] + 1
        cell_order = {kk: r for r, kk in enumerate(rng.permutation(np.unique(keys)))}
        prio = sorted(range(len(group)), key=lambda i: (rank[i], cell_order[keys[i]]))
        used = 0
        sel = []
        for i in prio:
            if used + group[i]["cost"] > b:
                continue
            sel.append(group[i])
            used += group[i]["cost"]
        grow = 1.0
        if sel:
            grow = min(max((len(group) / len(sel)) ** args.card_grow_exp, 1.0), args.card_grow_max)
        nq = sum(1 for c in sel if c["quad"] is not None)
        log("cards %-30s %5d -> %4d kept (%d as quads), %4d tris, grow x%.2f" % (
            infos[s].name, len(group), len(sel), nq, used, grow))
        for c in sel:
            c["grow"] = grow
        kept += sel
    # enlarged cards: cap their size and pull them inwards so the crown keeps its outline
    allco = A["co"][tris_v.reshape(-1)]
    crown_c = (allco.min(0) + allco.max(0)) / 2
    max_size = args.card_max_frac * float(np.linalg.norm(allco.max(0) - allco.min(0)))

    def placed(c, pts, cen):
        size = float(np.linalg.norm(pts.max(0) - pts.min(0)))
        g = min(c["grow"], max(1.0, max_size / max(size, 1e-9)))
        r = float(np.linalg.norm(pts - cen, axis=1).max())
        d = cen - crown_c
        dl = float(np.linalg.norm(d))
        shift = min((g - 1.0) * r, dl)
        cen2 = cen - (d / dl * shift if dl > 1e-9 else 0.0)
        return cen2 + (pts - cen) * g

    # rebuild the card mesh
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for c in kept:
        if c["quad"] is not None:
            rect, corners = c["quad"]
            cen = corners.mean(0)
            pts = placed(c, corners, cen)
            uvs = rect
            n_q = np.cross(pts[1] - pts[0], pts[2] - pts[0])
            if np.dot(n_q, c["normal"]) < 0:
                pts, uvs = pts[::-1], uvs[::-1]
            vs = [bm.verts.new(p) for p in pts]
            f = bm.faces.new(vs)
            f.material_index = c["slot"]
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
        else:
            co = placed(c, c["co"], c["center"])
            for i in range(0, len(co), 3):
                vs = [bm.verts.new(co[i + j]) for j in range(3)]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = c["slot"]
                for j, loop in enumerate(f.loops):
                    loop[uvl].uv = c["uv"][i + j]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for uvname in [l.name for l in me.uv_layers]:
        me.uv_layers.remove(me.uv_layers[uvname])
    bm.to_mesh(me)
    bm.free()
    me.update()
    return C.tri_count(ob)


# ----------------------------------------------------------------------------------------- bake

def smart_uv(ob, angle, margin):
    C.select_only([ob])
    me = ob.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    try:  # tighter packing than smart_project's own (Blender 3.6+ packer)
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    except Exception as e:
        log("pack_islands skipped:", e)
    bpy.ops.object.mode_set(mode='OBJECT')


def emission_copy(mat):
    """Copy of mat whose surface is an emission of its base colour (for albedo baking)."""
    m = mat.copy()
    nt = m.node_tree
    bsdf = principled(m)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    if out is None:
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if out is None:
        out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    if bsdf is not None and bsdf.inputs["Base Color"].is_linked:
        nt.links.new(bsdf.inputs["Base Color"].links[0].from_socket, em.inputs["Color"])
    elif bsdf is not None:
        em.inputs["Color"].default_value = bsdf.inputs["Base Color"].default_value
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def bake(low, high, args, size, do_normal):
    """Bake base colour (+ tangent normal) from high onto low's active UVs. Returns arrays."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = args.bake_samples
    try:
        sc.cycles.use_denoising = False
    except Exception:
        pass
    lo, hi = mesh_bbox(low)
    diag = float(np.linalg.norm(hi - lo))
    ext = args.bake_extrusion * diag
    ray = args.bake_ray * diag
    res = size * max(1, args.bake_supersample)
    tgt = bpy.data.materials.new("__bake_target")
    tex = tgt.node_tree.nodes.new("ShaderNodeTexImage")
    tgt.node_tree.nodes.active = tex
    low.data.materials.clear()
    low.data.materials.append(tgt)
    low.data.polygons.foreach_set("material_index", np.zeros(len(low.data.polygons), np.int32))
    low.data.update()
    C.select_only([high, low], active=low)
    out = {}
    margin = max(4, res // 64)
    if do_normal:
        img = bpy.data.images.new("__bake_normal", res, res, alpha=True)
        img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(np.tile(np.array([0.5, 0.5, 1.0, 0.0], np.float32), res * res))
        tex.image = img
        t0 = time.time()
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                            cage_extrusion=ext, max_ray_distance=ray, margin=margin,
                            margin_type='EXTEND', target='IMAGE_TEXTURES', use_clear=False)
        log("baked normal %dpx in %.1fs" % (res, time.time() - t0))
        out["normal"] = C.image_to_array(img)
    # albedo via emission
    originals = [s.material for s in high.material_slots]
    for s in high.material_slots:
        if s.material:
            s.material = emission_copy(s.material)
    img = bpy.data.images.new("__bake_color", res, res, alpha=True)
    img.pixels.foreach_set(np.zeros(res * res * 4, np.float32))
    tex.image = img
    t0 = time.time()
    bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=ext,
                        max_ray_distance=ray, margin=margin, margin_type='EXTEND',
                        target='IMAGE_TEXTURES', use_clear=False)
    log("baked colour %dpx in %.1fs" % (res, time.time() - t0))
    out["color"] = C.image_to_array(img)
    for s, m in zip(high.material_slots, originals):
        s.material = m
    low.data.materials.clear()
    return out


def finish_baked(arr, size, is_normal=False):
    """Fill un-baked texels (alpha 0) from their neighbours, downsample to size."""
    filled = C.bleed_alpha(arr, threshold=0.5)
    filled[:, :, 3] = 1.0
    if filled.shape[0] != size:
        filled = np.clip(C.resize(filled, size, size), 0, 1)
    if is_normal:
        filled = C.renormalize_normals(filled)
    return filled


def hull_proxy(src, parts_box, dissolve_deg, to_source=None, min_size=0.0):
    me = src.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    if parts_box is not None or min_size > 0:
        parts = face_parts(me)
        dense, plo, phi = part_bounds(me, parts)
        cen = (plo + phi) / 2
        if to_source is not None:
            m = np.array(to_source)
            cen = cen @ m[:3, :3].T + m[:3, 3]
        inside = np.ones(len(cen), bool)
        if parts_box is not None:
            inside &= np.all((cen >= parts_box[0]) & (cen <= parts_box[1]), axis=1)
        if min_size > 0:
            inside &= np.linalg.norm(phi - plo, axis=1) >= min_size
        keep_poly = inside[dense]
        lstart = np.empty(len(me.polygons), np.int64)
        me.polygons.foreach_get("loop_start", lstart)
        ltot = np.empty(len(me.polygons), np.int64)
        me.polygons.foreach_get("loop_total", ltot)
        lv = np.empty(len(me.loops), np.int64)
        me.loops.foreach_get("vertex_index", lv)
        keep_loop = np.repeat(keep_poly, ltot)
        co = co[np.unique(lv[keep_loop])]
        log("hull from %d of %d parts" % (int(inside.sum()), len(inside)))
    bm = bmesh.new()
    for p in co:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:], use_existing_faces=False)
    junk = list(dict.fromkeys(g for g in res["geom_interior"] + res["geom_unused"]
                              if isinstance(g, bmesh.types.BMVert)))
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(dissolve_deg), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me2 = bpy.data.meshes.new("proxy")
    bm.to_mesh(me2)
    bm.free()
    ob = bpy.data.objects.new("proxy", me2)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------------------------- pipeline

def bake_world_transforms(objs):
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
    mws = {o: o.matrix_world.copy() for o in objs}
    for o in objs:
        transform_mesh(o, mws[o])
        o.parent = None
        o.matrix_world = Matrix.Identity(4)


def run_prop(args, stem, workdir, meshes):
    t0 = time.time()
    card_re = re.compile(args.cards, re.I) if args.cards else None
    alpha_maps = []
    for spec in args.alpha_map:
        pat, _, path = spec.partition("=")
        alpha_maps.append((re.compile(pat, re.I), os.path.abspath(path)))
    mat_props = parse_mat_props(args.mat_props)
    base_maps = []
    for spec in args.base_map:
        pat, _, path = spec.partition("=")
        base_maps.append((re.compile(pat, re.I), os.path.abspath(path)))

    for o in bpy.context.scene.objects:
        if o.type == 'ARMATURE':
            raise SystemExit("rigged model: use --keep-objects")
    bake_world_transforms(meshes)
    for o in list(bpy.context.scene.objects):
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    C.select_only(meshes, active=meshes[0])
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = stem
    ob.data.name = stem
    while len(ob.data.uv_layers) > 1:
        ob.data.uv_layers.remove(ob.data.uv_layers[-1])
    log("joined %d meshes: %d tris" % (len(meshes), C.tri_count(ob)))

    # keep only parts inside a box (source axes)
    if args.keep_parts_in:
        box = parse_box(args.keep_parts_in)
        dense, plo, phi = part_bounds(ob.data, face_parts(ob.data))
        cen = (plo + phi) / 2
        inside = np.all((cen >= box[0]) & (cen <= box[1]), axis=1)
        delete_polys(ob, ~inside[dense])
        log("kept %d of %d parts inside the box: %d tris" % (int(inside.sum()), len(inside), C.tri_count(ob)))

    # orientation and scale (applied to the data)
    lo, hi = mesh_bbox(ob)
    rot = Matrix.Identity(4)
    if args.align == "long-z":
        ext = hi - lo
        if ext[0] > ext[1] * 1.05:  # long side on Blender X -> turn it onto Blender Y (glTF Z)
            rot = Matrix.Rotation(math.radians(90), 4, 'Z')
    if args.yaw:
        rot = Matrix.Rotation(math.radians(args.yaw), 4, 'Z') @ rot
    transform_mesh(ob, rot)
    lo, hi = mesh_bbox(ob)
    s = 1.0
    if args.scale:
        s = args.scale
    elif args.height:
        s = args.height / max(hi[2] - lo[2], 1e-9)
    elif args.length:
        s = args.length / max(max(hi[0] - lo[0], hi[1] - lo[1]), 1e-9)
    if s != 1.0:
        transform_mesh(ob, Matrix.Scale(s, 4))
    to_source = (Matrix.Scale(s, 4) @ rot).inverted()
    lo, hi = mesh_bbox(ob)
    diag = float(np.linalg.norm(hi - lo))
    log("size after orient/scale: %.3f x %.3f x %.3f m (glTF x,y,z)" % (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]))

    infos = analyse_slots(ob, args, card_re, alpha_maps, base_maps)
    for s_ in infos:  # free the source names for the new materials (infos keep the original names)
        if s_.material is not None and not s_.material.name.endswith("__src"):
            s_.material.name = s_.material.name + "__src"
    mi = poly_material_indices(ob.data)
    card_slots = [s.index for s in infos if s.card]
    is_card_poly = np.isin(mi, card_slots)

    # split cards / solid
    cards_ob = None
    if is_card_poly.any():
        cards_ob = ob.copy()
        cards_ob.data = ob.data.copy()
        cards_ob.name = stem + "_cards"
        bpy.context.scene.collection.objects.link(cards_ob)
        delete_polys(cards_ob, ~is_card_poly)
        delete_polys(ob, is_card_poly)

    # solid part
    merge_by_distance(ob, max(1e-9, args.merge_dist * diag))
    if args.min_part_size > 0 and len(ob.data.polygons):
        dense, plo, phi = part_bounds(ob.data, face_parts(ob.data))
        small = np.linalg.norm(phi - plo, axis=1) < args.min_part_size
        delete_polys(ob, small[dense])
        log("dropped %d parts smaller than %.3f m: %d tris left" % (int(small.sum()), args.min_part_size, C.tri_count(ob)))
    solid_tris = C.tri_count(ob)
    card_tris_src = C.tri_count(cards_ob) if cards_ob else 0
    cards, cardA = [], None
    if cards_ob:
        atlases = {}
        for s in infos:
            if not s.card:
                continue
            alpha = None
            if s.alpha_map:
                alpha = C.image_to_array(bpy.data.images.load(s.alpha_map, check_existing=True))[:, :, 0]
            elif s.base_img is not None:
                alpha = C.image_to_array(s.base_img)[:, :, 3]
            if alpha is not None and alpha.min() < 0.5:
                key = s.alpha_map or s.base_img.name
                cached = next((v for v in atlases.values() if getattr(v, "key", None) == key), None)
                atlas = cached or SpriteAtlas(alpha)
                atlas.key = key
                atlases[s.index] = atlas
        cards, cardA = analyse_cards(cards_ob, args, atlases)
        card_cost = sum(c["cost"] for c in cards)
        solid_budget = min(solid_tris, int(round(args.tris * (1 - args.card_share))))
        card_budget = args.tris - solid_budget
        if card_cost <= card_budget:  # every card fits: the rest goes to the solid part
            card_budget = card_cost
            solid_budget = min(solid_tris, args.tris - card_budget)
    else:
        solid_budget, card_budget = args.tris, 0
    log("budget: solid %d (from %d), cards %d (from %d)" % (solid_budget, solid_tris, card_budget, card_tris_src))

    high = None
    if args.bake and solid_tris:
        high = ob.copy()
        high.data = ob.data.copy()
        high.name = stem + "_high"
        bpy.context.scene.collection.objects.link(high)
        if args.bake_skip_materials:
            skip = re.compile(args.bake_skip_materials, re.I)
            dead = np.isin(poly_material_indices(high.data), [s.index for s in infos if skip.search(s.name)])
            delete_polys(high, dead)

    if solid_tris:
        if args.proxy == "hull":
            box = parse_box(args.proxy_parts_in) if args.proxy_parts_in else None
            proxy = hull_proxy(ob, box, args.proxy_dissolve, to_source, args.proxy_min_part_size)
            bpy.data.objects.remove(ob, do_unlink=True)
            ob = proxy
            ob.name = stem
            ob.data.name = stem
            log("hull proxy: %d tris" % C.tri_count(ob))
        protect = args.protect_seams == "yes" or (args.protect_seams == "auto" and not args.bake)
        if args.fill_holes:
            log("capped %d holes" % fill_holes(ob))
        vg = seam_vertex_group(ob) if protect else None
        n = reduce_to_budget(ob, solid_budget, vg, min_tris_per_part=args.min_tris_per_part)
        cleanup(ob, 1e-6 * diag)
        log("solid decimated to %d tris (seam protection %s)" % (n, "on" if vg else "off"))
        set_normals(ob, args.sharp_angle)

    # cards
    if cards_ob:
        n = thin_cards(cards_ob, cards, cardA, infos, card_budget, args)
        log("cards: %d tris" % n)

    # textures and materials
    tw = TexWriter(args, workdir, stem)
    groups = []  # dict(key, slots, mask, base, normal, ...)
    slot_group = {}
    if high is not None:
        # all solid slots -> one baked material
        solid_slots = [s for s in infos if not s.card]
        g = dict(key="__baked__", slots=solid_slots, mask=False, baked=True)
        groups.append(g)
        for s in solid_slots:
            slot_group[s.index] = 0
    for s in infos:
        if s.index in slot_group:
            continue
        nkey = s.normal_img.name if (args.normal and s.normal_img is not None) else None
        key = (s.base_img.name if s.base_img else tuple(round(c, 3) for c in s.base_color), s.mask, nkey,
               s.alpha_map, s.base_factor)
        for gi, g in enumerate(groups):
            if g["key"] == key:
                g["slots"].append(s)
                slot_group[s.index] = gi
                break
        else:
            groups.append(dict(key=key, slots=[s], mask=s.mask, baked=False))
            slot_group[s.index] = len(groups) - 1
    # only groups that still have faces
    used_slots = set()
    for o in [ob, cards_ob]:
        if o is not None and len(o.data.polygons):
            used_slots |= set(np.unique(poly_material_indices(o.data)).tolist())
    if high is not None:
        used_slots |= {s.index for s in infos if not s.card}
    groups_used = sorted({slot_group[i] for i in used_slots if i in slot_group})
    if len(groups_used) > args.max_materials:
        raise SystemExit("%d materials after merging (max %d): %s. Try --bake." % (
            len(groups_used), args.max_materials, [groups[g]["slots"][0].name for g in groups_used]))

    baked = None
    if high is not None:
        smart_uv(ob, args.uv_angle, args.uv_margin)
        baked = bake(ob, high, args, args.tex, args.normal)
        bpy.data.objects.remove(high, do_unlink=True)

    for gi in groups_used:  # alpha textures first: opaque groups on the same image reuse them
        g = groups[gi]
        if g["mask"] and not g["baked"] and g["slots"][0].base_img is not None:
            tw.base(g["slots"][0].base_img, g["slots"][0].alpha_map, with_alpha=True,
                    factor=g["slots"][0].base_factor)
    final_mats = []
    remap = {}
    n_opaque = n_mask = 0
    for new_i, gi in enumerate(groups_used):
        g = groups[gi]
        names = [s.name for s in g["slots"]]
        area = sum(s.area for s in g["slots"]) or 1.0
        rough = sum(s.rough * s.area for s in g["slots"]) / area
        metal = sum(s.metal * s.area for s in g["slots"]) / area
        if args.roughness != "auto":
            rough = float(args.roughness)
        if args.metallic != "auto":
            metal = float(args.metallic)
        elif metal < 0.35 or metal > 0.65:  # a constant metalness is either metal or not
            metal = 0.0 if metal < 0.35 else 1.0
        if g["mask"]:
            mname = stem + "_cutout" + ("_%d" % n_mask if n_mask else "")
            n_mask += 1
        else:
            mname = stem + ("_%d" % n_opaque if n_opaque else "")
            n_opaque += 1
        rough, metal = apply_mat_props(names + [mname], rough, metal, mat_props)
        double = args.double_sided or g["mask"]
        if g["baked"]:
            col = finish_baked(baked["color"], args.tex)
            base = C.save_array(col, os.path.join(workdir, stem + "_basecolor.jpg"), "JPEG",
                                args.jpeg_quality, name=stem + "_basecolor")
            nimg = None
            if args.normal and "normal" in baked:
                nimg = tw.normal_from_array(finish_baked(baked["normal"], args.tex, True), ("__baked_n",))
            m = make_material(mname, base, normal_img=nimg, rough=rough, metal=metal, double=double)
        else:
            s0 = g["slots"][0]
            base = None
            if s0.base_img is not None:
                base = tw.base(s0.base_img, s0.alpha_map, with_alpha=g["mask"], factor=s0.base_factor)
            nimg = tw.normal(s0.normal_img) if (args.normal and s0.normal_img is not None) else None
            m = make_material(mname, base, s0.base_color, nimg, rough, metal, mask=g["mask"],
                              cutoff=args.alpha_cutoff, double=double)
        log("material %-22s from %s rough=%.2f metal=%.2f %s%s" % (
            mname, names, rough, metal, "MASK " if g["mask"] else "", "double-sided" if double else ""))
        final_mats.append(m)
        for s in g["slots"]:
            remap[s.index] = new_i

    # merge solid + cards, assign materials
    parts = [o for o in (ob, cards_ob) if o is not None and len(o.data.polygons)]
    for o in parts:
        mi = poly_material_indices(o.data)
        if o is ob and high is not None or (o is ob and args.proxy == "hull"):
            mi = np.zeros_like(mi)
        else:
            mi = np.array([remap.get(int(i), 0) for i in mi], np.int64)
        o.data.materials.clear()
        for m in final_mats:
            o.data.materials.append(m)
        o.data.polygons.foreach_set("material_index", mi.astype(np.int32))
        o.data.update()
    # unify UV layer names before joining
    for o in parts:
        if o.data.uv_layers:
            o.data.uv_layers[0].name = "UVMap"
    C.select_only(parts, active=parts[0])
    if len(parts) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = stem
    ob.data.name = stem
    triangulate(ob)

    # origin: lowest vertex at 0, centred
    if args.origin == "bottom":
        lo, hi = mesh_bbox(ob)
        transform_mesh(ob, Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
    log("prop pipeline done in %.1fs" % (time.time() - t0))
    return [ob]


def run_keep_objects(args, stem, workdir, meshes):
    mat_props = parse_mat_props(args.mat_props)
    for o in meshes:
        if o.data.users > 1:
            o.data = o.data.copy()
    counts = {o: C.tri_count(o) for o in meshes}
    total = sum(counts.values())
    targets = {}
    for o in meshes:
        t = counts[o]
        if args.tris and total > args.tris:
            t = max(12, int(args.tris * counts[o] / total))
        if args.max_tris_per_mesh:
            t = min(t, args.max_tris_per_mesh)
        targets[o] = t
    for o in meshes:
        n0 = counts[o]
        if n0 <= targets[o]:
            log("%-28s %6d tris (kept)" % (o.name, n0))
            continue
        lo, hi = mesh_bbox(o)
        merge_by_distance(o, max(1e-9, args.merge_dist * float(np.linalg.norm(hi - lo))))
        vg = seam_vertex_group(o) if args.protect_seams != "no" else None
        n = decimate_to(o, targets[o], vg)
        set_normals(o, args.sharp_angle)
        log("%-28s %6d -> %d tris" % (o.name, n0, n))
    tw = TexWriter(args, workdir, stem)
    done = {}   # source material pointer -> new material
    made = set()
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            if m is None or m.as_pointer() in made:
                continue
            if m.as_pointer() in done:
                slot.material = done[m.as_pointer()]
                continue
            bsdf = principled(m)
            base, color, nimg = None, (0.8, 0.8, 0.8, 1.0), None
            mode, cutoff, alpha_value = "OPAQUE", args.alpha_cutoff, 1.0
            rough, metal = 0.5, 0.0
            if bsdf is not None:
                mode, cutoff, alpha_value = source_alpha(bsdf)
                img, fac = trace_base(bsdf.inputs["Base Color"])
                if img is not None and img.size[0] > 0:
                    textured_alpha = mode != "OPAQUE" and bsdf.inputs["Alpha"].is_linked
                    base = tw.base(img, with_alpha=textured_alpha, label=re.sub(r"\W+", "_", m.name), factor=fac)
                else:
                    color = tuple(bsdf.inputs["Base Color"].default_value)
                nnode, _ = upstream_image(bsdf.inputs["Normal"])
                if args.normal and nnode is not None and nnode.image is not None:
                    nimg = tw.normal(nnode.image, label=re.sub(r"\W+", "_", m.name) + "_normal")
                r = trace_scalar(bsdf.inputs["Roughness"])
                mt = trace_scalar(bsdf.inputs["Metallic"])
                rough, metal = r[3] if r[0] is None else 0.5, mt[3] if mt[0] is None else 0.0
            if args.roughness != "auto":
                rough = float(args.roughness)
            if args.metallic != "auto":
                metal = float(args.metallic)
            rough, metal = apply_mat_props([m.name, o.name], rough, metal, mat_props)
            name = m.name
            m.name = name + "__src"
            nm = make_material(name, base, color, nimg, rough, metal, mask=(mode == "MASK"), cutoff=cutoff,
                               double=not m.use_backface_culling, blend=(mode == "BLEND"), alpha_value=alpha_value)
            log("material %-22s rough=%.2f metal=%.2f alpha=%s base=%s normal=%s" % (
                name, rough, metal, mode, base.name if base else None, nimg.name if nimg else None))
            done[m.as_pointer()] = nm
            made.add(nm.as_pointer())
            slot.material = nm
    return meshes


def export_glb(path, objs, args, has_normal_maps, animated):
    keep = set(objs)
    for o in list(objs):
        p = o.parent
        while p is not None:
            keep.add(p)
            p = p.parent
        for c in o.children_recursive:
            if c.type in ('EMPTY', 'ARMATURE'):
                keep.add(c)
    for o in bpy.context.scene.objects:
        if o.type == 'ARMATURE':
            keep.add(o)
    C.select_only(list(keep), active=objs[0])
    skins = any(o.type == 'ARMATURE' for o in keep)
    tangents = args.tangents == "yes" or (args.tangents == "auto" and has_normal_maps)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=tangents,
        export_materials='EXPORT', export_image_format='AUTO', export_image_quality=args.jpeg_quality,
        export_vertex_color='NONE', export_attributes=False, export_extras=False,
        export_cameras=False, export_lights=False, export_animations=animated, export_skins=skins,
        export_morph=False, export_unused_images=False, export_unused_textures=False)


def main():
    args = parse_args()
    stem = args.name or os.path.splitext(os.path.basename(args.out))[0]
    workdir = args.work_dir or tempfile.mkdtemp(prefix="convert_prop_")
    os.makedirs(workdir, exist_ok=True)
    C.reset_scene()
    objs = C.import_model(os.path.abspath(args.inp))
    meshes = C.mesh_objects(objs)
    if args.objects:
        meshes = [o for o in meshes if re.search(args.objects, o.name)]
    if args.exclude:
        meshes = [o for o in meshes if not re.search(args.exclude, o.name)]
    if not meshes:
        raise SystemExit("no mesh objects selected; available: %s" % [o.name for o in C.mesh_objects(objs)])
    log("input %s: %d mesh objects selected %s" % (args.inp, len(meshes), [o.name for o in meshes]))
    animated = bool(bpy.data.actions) and args.keep_objects
    if args.keep_objects:
        for o in C.mesh_objects(objs):
            if o not in meshes:
                bpy.data.objects.remove(o, do_unlink=True)
        result = run_keep_objects(args, stem, workdir, meshes)
    else:
        result = run_prop(args, stem, workdir, meshes)
    has_nm = any(principled(s.material) is not None and principled(s.material).inputs["Normal"].is_linked
                 for o in result for s in o.material_slots if s.material)
    export_glb(os.path.abspath(args.out), result, args, has_nm, animated)

    # verify
    C.reset_scene()
    objs = C.import_model(os.path.abspath(args.out))
    ms = C.mesh_objects(objs)
    tris = sum(C.tri_count(o) for o in ms)
    mats = sorted({s.material.name for o in ms for s in o.material_slots if s.material})
    lo, hi = C.world_bbox(ms)
    gl_lo = (lo.x, lo.z, -hi.y)
    gl_hi = (hi.x, hi.z, -lo.y)
    size = os.path.getsize(args.out)
    print("RESULT %s tris=%d materials=%d size=%.1fKB bbox_min=(%.3f,%.3f,%.3f) bbox_max=(%.3f,%.3f,%.3f) nodes=%s" % (
        os.path.basename(args.out), tris, len(mats), size / 1024, *gl_lo, *gl_hi, [o.name for o in ms]), flush=True)
    if args.tris and tris > args.tris:
        print("WARNING over triangle budget: %d > %d" % (tris, args.tris))
    for o in ms:
        if args.max_tris_per_mesh and C.tri_count(o) > args.max_tris_per_mesh:
            print("WARNING %s has %d triangles > %d" % (o.name, C.tri_count(o), args.max_tris_per_mesh))
    if args.origin == "bottom" and (abs(gl_lo[1]) > 1e-3 or abs(gl_lo[0] + gl_hi[0]) > 2e-3 or abs(gl_lo[2] + gl_hi[2]) > 2e-3):
        print("WARNING origin is not at the bottom centre")
    if args.preview:
        C.setup_preview_scene()
        C.render_views(ms, args.preview)
        print("preview ->", args.preview)
    if not args.work_dir:
        shutil.rmtree(workdir, ignore_errors=True)


main()
