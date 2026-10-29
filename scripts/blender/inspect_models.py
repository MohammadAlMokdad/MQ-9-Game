"""Print stats for model files and optionally render preview sheets.

Usage:
  blender -b --factory-startup --python scripts/blender/inspect_models.py -- \
      [--preview-dir DIR] [--engine EEVEE|WORKBENCH|CYCLES] [--views persp,front,side,top] \
      [--size 384] [--components] [--json OUT.json] model1.glb [model2.gltf ...]

For each file: size on disk, triangle count, material count/names (with glTF alphaMode and
textures for .glb/.gltf), mesh nodes with their triangle counts, and the bounding box in glTF
axes (x, y up, z front). --components lists connected-piece statistics per material (useful to
tell alpha-card foliage from solid geometry). --preview-dir renders <name>.png contact sheets.
"""
import json
import os
import struct
import sys

import bpy
import numpy as np

sys.dont_write_bytecode = True  # keep the scripts folder free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_common as C  # noqa: E402


def gltf_json(path):
    if path.lower().endswith(".glb"):
        with open(path, "rb") as f:
            magic, _ver, _len = struct.unpack("<4sII", f.read(12))
            if magic != b"glTF":
                return None
            clen, ctype = struct.unpack("<I4s", f.read(8))
            return json.loads(f.read(clen))
    if path.lower().endswith(".gltf"):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def components_report(obj):
    """Connected pieces per material: count, tris per piece (min/median/max), piece size."""
    me = obj.data
    a = C.mesh_arrays(me)
    nv = len(me.vertices)
    parent = np.arange(nv)

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    for e in me.edges:
        r1, r2 = find(e.vertices[0]), find(e.vertices[1])
        if r1 != r2:
            parent[r1] = r2
    roots = np.array([find(v) for v in range(nv)])
    out = []
    for mi in np.unique(a["mats"]):
        sel = a["mats"] == mi
        comp = roots[a["verts"][sel, 0]]
        uniq, counts = np.unique(comp, return_counts=True)
        # piece extent
        sizes = []
        for u in uniq[:4000]:
            vs = a["verts"][sel][comp == u].reshape(-1)
            co = a["co"][vs]
            sizes.append(np.linalg.norm(co.max(0) - co.min(0)))
        mname = obj.material_slots[mi].material.name if mi < len(obj.material_slots) and obj.material_slots[mi].material else str(mi)
        out.append("    mat %-34s pieces=%6d tris/piece min=%d med=%d max=%d  piece size med=%.3f max=%.3f" % (
            mname, len(uniq), counts.min(), int(np.median(counts)), counts.max(),
            float(np.median(sizes)), float(np.max(sizes))))
    return "\n".join(out)


def main():
    args = C.script_args()
    preview_dir = None
    engine = "EEVEE"
    views = ("persp", "front", "side", "top")
    size = 384
    comps = False
    json_out = None
    files = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--preview-dir":
            preview_dir = args[i + 1]; i += 2
        elif a == "--engine":
            engine = args[i + 1].upper(); i += 2
        elif a == "--views":
            views = tuple(args[i + 1].split(",")); i += 2
        elif a == "--size":
            size = int(args[i + 1]); i += 2
        elif a == "--components":
            comps = True; i += 1
        elif a == "--json":
            json_out = args[i + 1]; i += 2
        else:
            files.append(a); i += 1

    results = []
    for path in files:
        C.reset_scene()
        objs = C.import_model(path)
        meshes = C.mesh_objects(objs)
        tris = sum(C.tri_count(o) for o in meshes)
        mats = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})
        lo, hi = C.world_bbox(meshes)
        gl_lo = (lo.x, lo.z, -hi.y)
        gl_hi = (hi.x, hi.z, -lo.y)
        info = dict(file=os.path.basename(path), bytes=os.path.getsize(path), tris=tris,
                    materials=len(mats), bbox_min=[round(v, 4) for v in gl_lo],
                    bbox_max=[round(v, 4) for v in gl_hi])
        print("=" * 100)
        print("%s  %.1f KB  tris=%d  materials=%d" % (path, os.path.getsize(path) / 1024, tris, len(mats)))
        print("  bbox (glTF x,y,z) min=(%.3f, %.3f, %.3f) max=(%.3f, %.3f, %.3f) size=(%.3f, %.3f, %.3f)" % (
            *gl_lo, *gl_hi, gl_hi[0] - gl_lo[0], gl_hi[1] - gl_lo[1], gl_hi[2] - gl_lo[2]))
        print("  center x=%.4f z=%.4f  min y=%.4f" % ((gl_lo[0] + gl_hi[0]) / 2, (gl_lo[2] + gl_hi[2]) / 2, gl_lo[1]))
        for o in meshes:
            mw = o.matrix_world
            print("  mesh %-32s tris=%6d verts=%6d loc=(%.3f, %.3f, %.3f) parent=%s mats=%s" % (
                o.name, C.tri_count(o), len(o.data.vertices), mw.translation.x, mw.translation.z,
                -mw.translation.y, o.parent.name if o.parent else None,
                [s.material.name if s.material else None for s in o.material_slots]))
            if comps:
                print(components_report(o))
        g = gltf_json(path)
        if g:
            for m in g.get("materials", []):
                pbr = m.get("pbrMetallicRoughness", {})
                print("  material %-28s alpha=%s cutoff=%s double=%s base=%s mf=%s rf=%s normal=%s mr=%s" % (
                    m.get("name"), m.get("alphaMode", "OPAQUE"), m.get("alphaCutoff"), m.get("doubleSided", False),
                    "tex" if "baseColorTexture" in pbr else pbr.get("baseColorFactor"),
                    pbr.get("metallicFactor", 1.0), pbr.get("roughnessFactor", 1.0),
                    "yes" if "normalTexture" in m else "no", "yes" if "metallicRoughnessTexture" in pbr else "no"))
            for im in g.get("images", []):
                bv = im.get("bufferView")
                nbytes = g["bufferViews"][bv]["byteLength"] if bv is not None else None
                print("  image %-30s %s %s bytes" % (im.get("name"), im.get("mimeType", im.get("uri")), nbytes))
            print("  nodes:", [n.get("name") for n in g.get("nodes", [])])
            print("  extensionsUsed:", g.get("extensionsUsed"), "required:", g.get("extensionsRequired"))
            info["gltf_materials"] = [m.get("name") for m in g.get("materials", [])]
            info["nodes"] = [n.get("name") for n in g.get("nodes", [])]
        for img in bpy.data.images:
            if img.size[0]:
                print("  blender image %-30s %dx%d %s" % (img.name, img.size[0], img.size[1], img.file_format))
        results.append(info)
        if preview_dir:
            C.setup_preview_scene(engine=engine)
            out = os.path.join(preview_dir, os.path.splitext(os.path.basename(path))[0] + ".png")
            C.render_views(meshes, out, views=views, size=size)
            print("  preview ->", out)
    if json_out:
        with open(json_out, "w") as f:
            json.dump(results, f, indent=1)


main()
