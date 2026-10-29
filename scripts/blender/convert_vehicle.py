# Converts a downloaded vehicle (Sketchfab glTF/GLB, FBX or OBJ) into a game-ready GLB:
#   - joins every mesh, optionally reduces it to a triangle budget,
#   - bakes all of its materials' base colour into ONE texture atlas (Cycles), so the game can draw
#     it with a single material and keep the real paint, rust and decals,
#   - turns it to face +Z (glTF) at real size in metres, base on the ground, centred,
#   - exports a GLB with a JPEG atlas, and renders top and side previews for checking.
#
# Usage:
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --factory-startup \
#     --python scripts/blender/convert_vehicle.py -- <input> <output.glb> \
#     [--front=-y] [--length=5.3] [--tris=15000] [--atlas=1024] [--preview=<prefix>] [--probe=1]
#
#   --front   which way the vehicle's nose points in the source, in Blender axes (+x -x +y -y).
#             Sketchfab imports usually point it at -y or +x. Check the side preview.
#   --length  real nose-to-tail length in metres (rescales); omit to keep the source scale.
#   --tris    triangle budget (decimates when above it).
#   --atlas   atlas size in pixels.
#   --probe   only orient, size and render the previews of the source (fast), to check --front.
#   --exclude regular expression: drop meshes whose object, mesh or parent name matches
#             (display plates and turntables).
#   --cage, --ray  bake cage extrusion and ray distance in metres (defaults 0.03 and 0.25).
#
# Use models under about 30,000 triangles. Reducing one to less than about a third of its
# triangles tears its shape and breaks its atlas into specks (the script warns when you ask it to).
import json
import math
import os
import re
import shutil
import struct
import sys
import tempfile
import urllib.parse

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pos = [a for a in argv if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in argv if a.startswith('--') and '=' in a)
if len(pos) < 2:
    raise SystemExit('usage: convert_vehicle.py -- <input> <output.glb> [options]')
SRC, OUT = os.path.abspath(pos[0]), os.path.abspath(pos[1])
FRONT = opt.get('front', '-y')
LENGTH = float(opt['length']) if 'length' in opt else None
TRIS = int(opt.get('tris', 15000))
ATLAS = int(opt.get('atlas', 1024))
PREVIEW = os.path.abspath(opt['preview']) if 'preview' in opt else None
PROBE = opt.get('probe') == '1'
EXCLUDE = re.compile(opt['exclude']) if 'exclude' in opt else None
CAGE = float(opt.get('cage', 0.03))
RAY = float(opt.get('ray', 0.25))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def flatten_gltf(path):
    """Writes a copy of a glTF or GLB whose mesh nodes all sit at the root with identity
    transforms. Returns its path and, per new node name, the node's exact world matrix (glTF axes)
    and the names of the nodes on its path from the root.

    Blender keeps an object's transform as location, rotation and scale, so its importer
    approximates any node matrix that has shear. Sketchfab's conversions of 3DS models have such
    nodes (a sheared mesh matrix under a node that cancels it out), and the approximation skews
    the whole model. Multiplying the matrices here and applying the product to the vertices later
    is exact."""
    base = os.path.dirname(path)
    chunks = b''
    if path.lower().endswith('.glb'):
        with open(path, 'rb') as f:
            data = f.read()
        n_json = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20 + n_json].decode('utf-8'))
        chunks = data[20 + n_json:]  # the binary chunk, unchanged
    else:
        with open(path, encoding='utf-8') as f:
            doc = json.load(f)
    # External files are referenced relative to the source, so point the copy at them.
    for coll in ('buffers', 'images'):
        for item in doc.get(coll, []):
            uri = item.get('uri')
            if uri and not uri.startswith('data:'):
                item['uri'] = urllib.parse.quote(os.path.join(base, urllib.parse.unquote(uri)).replace('\\', '/'), safe=':/')
    nodes = doc.get('nodes', [])

    def local(n):
        if 'matrix' in n:
            return np.array(n['matrix'], dtype=float).reshape(4, 4).T  # stored column-major
        x, y, z, w = n.get('rotation', (0, 0, 0, 1))
        m = np.eye(4)
        m[:3, :3] = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]) * np.array(n.get('scale', (1, 1, 1)), dtype=float)
        m[:3, 3] = n.get('translation', (0, 0, 0))
        return m

    flat, info = [], {}

    def walk(i, parent, names):
        n = nodes[i]
        w = parent @ local(n)
        names = names + [n.get('name', '')]
        if 'mesh' in n:
            name = f'node{len(flat):04d}'
            flat.append({'name': name, 'mesh': n['mesh']})
            info[name] = (w, names)
        for c in n.get('children', []):
            walk(c, w, names)

    for r in doc.get('scenes', [{}])[doc.get('scene', 0)].get('nodes', []):
        walk(r, np.eye(4), [])
    doc['nodes'] = flat
    doc['scenes'] = [{'nodes': list(range(len(flat)))}]
    doc['scene'] = 0
    for k in ('animations', 'skins', 'cameras'):
        doc.pop(k, None)
    out = os.path.join(tempfile.mkdtemp(prefix='convert_vehicle_'), 'flat' + os.path.splitext(path)[1].lower())
    js = json.dumps(doc).encode('utf-8')
    if out.endswith('.glb'):
        js += b' ' * (-len(js) % 4)
        body = struct.pack('<II', len(js), 0x4E4F534A) + js + chunks
        with open(out, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + len(body)) + body)
    else:
        with open(out, 'wb') as f:
            f.write(js)
    return out, info


ext = os.path.splitext(SRC)[1].lower()
exact = {}
if ext in ('.gltf', '.glb'):
    flat_path, exact = flatten_gltf(SRC)
    bpy.ops.import_scene.gltf(filepath=flat_path)
    shutil.rmtree(os.path.dirname(flat_path), ignore_errors=True)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=SRC)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=SRC)
else:
    raise SystemExit(f'unsupported input {ext}')

# Keep only meshes; drop cameras, lights, armatures (vehicles here are static), and anything
# matched by --exclude.
def lineage(o):
    """The object's name, its mesh's name, and the names of all its parents (for glTF, the
    original node names)."""
    names = [o.name, o.data.name if o.data else '']
    if o.name in exact:
        return names + exact[o.name][1][::-1]
    p = o.parent
    while p:
        names.append(p.name)
        p = p.parent
    return names


if EXCLUDE:
    for o in [o for o in scene.objects if o.type == 'MESH' and any(EXCLUDE.search(n) for n in lineage(o))]:
        print('excluded', lineage(o)[1:])
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in scene.objects if o.type == 'MESH']
for o in list(scene.objects):
    if o.type not in ('MESH', 'EMPTY'):
        bpy.data.objects.remove(o, do_unlink=True)
if not meshes:
    raise SystemExit('no meshes in input')

# Bake each mesh's world transform into its vertices, then join. Writing the matrix straight into
# the mesh is exact, where unparenting and applying transforms would decompose it again. glTF is
# Y-up, and the importer turns its vertices to Blender's Z-up: (x, y, z) -> (x, -z, y).
YUP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)
world = {o: Matrix((YUP @ exact[o.name][0] @ YUP.T).tolist()) if o.name in exact else o.matrix_world.copy() for o in meshes}
for o in meshes:
    if o.data.users > 1:
        o.data = o.data.copy()
    o.data.transform(world[o])
    if world[o].determinant() < 0:
        o.data.flip_normals()  # a mirroring transform turns the faces inside out
for o in meshes:
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
src.name = 'source'
for o in [o for o in scene.objects if o.type == 'EMPTY']:
    bpy.data.objects.remove(o, do_unlink=True)


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def bounds(ob):
    n = len(ob.data.vertices)
    arr = np.empty(n * 3)
    ob.data.vertices.foreach_get('co', arr)
    arr = arr.reshape(-1, 3)
    return arr.min(axis=0), arr.max(axis=0)


def render_views(ob, prefix, size, light='STUDIO', oblique=False):
    """Top view (nose up the image) and side view (nose to the right), textured, orthographic.
    light='FLAT' shows the pure colour. oblique adds a lit 3/4 view from above, the way the
    gunship sees it, with back faces culled so flipped faces show up as holes."""
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = light
    scene.display.shading.show_backface_culling = False
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 600
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    # Stand well outside the model whatever its units (the probe sees sources in centimetres).
    dist = 4 * float(max(size)) + 10
    cam_data.clip_end = 3 * dist
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # The frame is 3:2, and ortho_scale spans its width: fit both of each view's axes.
    aspect = scene.render.resolution_x / scene.render.resolution_y
    for name, loc, rot, span in (
        ('top', (0, 0, dist), (0, 0, math.pi), max(size[0], size[1] * aspect)),
        ('side', (-dist, 0, size[2] / 2), (math.radians(90), 0, math.radians(-90)), max(size[1], size[2] * aspect)),
    ):
        cam_data.ortho_scale = span * 1.15
        cam.location = loc
        cam.rotation_euler = rot
        scene.render.filepath = f'{prefix}_{name}.png'
        bpy.ops.render.render(write_still=True)
        print('preview', scene.render.filepath)
    if oblique:
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.show_backface_culling = True
        mid = Vector((0, 0, size[2] / 2))
        cam.location = mid + Vector((-1.0, -1.2, 1.3)).normalized() * dist
        cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam_data.ortho_scale = max(size) * 1.25
        scene.render.filepath = f'{prefix}_oblique.png'
        bpy.ops.render.render(write_still=True)
        print('preview', scene.render.filepath)
    bpy.data.objects.remove(cam, do_unlink=True)


lo, hi = bounds(src)
ext = hi - lo
print(f'source: {tri_count(src)} triangles, {len(src.data.materials)} materials, extent x {ext[0]:.3f} y {ext[1]:.3f} z {ext[2]:.3f}')

# Orient (nose to Blender -Y, which is glTF +Z) and size the source first, so the rest of the
# work, and the bake distances in particular, happen in metres at the final scale.
turn = {'-y': 0.0, '+x': -math.pi / 2, '+y': math.pi, '-x': math.pi / 2}[FRONT]
src.data.transform(Matrix.Rotation(turn, 4, 'Z'))
lo, hi = bounds(src)
s = LENGTH / (hi[1] - lo[1]) if LENGTH else 1.0
src.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
lo, hi = bounds(src)
size = hi - lo
print(f'oriented and scaled: (w, l, h) m {size[0]:.2f} {size[1]:.2f} {size[2]:.2f}')

if PROBE:
    # Orientation check only: render the source as it is now and stop.
    render_views(src, PREVIEW or OUT[:-4], size)
    raise SystemExit(0)

# Target: a copy, reduced, with fresh non-overlapping UVs for the atlas.
dst = src.copy()
dst.data = src.data.copy()
dst.name = 'vehicle'
scene.collection.objects.link(dst)
bpy.ops.object.select_all(action='DESELECT')
dst.select_set(True)
bpy.context.view_layer.objects.active = dst
# The copy inherits the imported custom normals, and the bake casts its rays along the target's
# normals. Drop them and shade flat, so the rays follow the real faces (the game computes flat
# normals itself anyway).
if dst.data.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
n0 = tri_count(dst)
if n0 > TRIS:
    if TRIS < n0 / 3:
        # Measured on a 155k-triangle tank cut to 15k and a 2.9M-triangle Humvee: the mesh tears,
        # and the jagged result unwraps into thousands of one-face islands, so the atlas is
        # mostly margin and the vehicle bakes dark.
        print(f'WARNING: cutting {n0} triangles to {TRIS} is more than this converter handles well; '
              'check the previews, or use a lighter model (under about 30k triangles)')
    # glTF splits vertices along every UV and normal seam. Weld them (this copy gets new UVs
    # anyway), so the decimator sees connected surfaces and does not tear them open at seams.
    bm = bmesh.new()
    bm.from_mesh(dst.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.to_mesh(dst.data)
    bm.free()
    mod = dst.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = TRIS / tri_count(dst)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
for p in dst.data.polygons:
    p.use_smooth = False
print(f'target: {tri_count(dst)} triangles')

me = dst.data
while len(me.uv_layers) > 0:
    me.uv_layers.remove(me.uv_layers[0])
me.uv_layers.new(name='atlas')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
bpy.ops.object.mode_set(mode='OBJECT')

img = bpy.data.images.new('atlas', ATLAS, ATLAS, alpha=False)
img.colorspace_settings.name = 'sRGB'
# Texels no face covers keep this colour until the bake is done (the bake must not clear it).
FILL = np.array([0.3, 0.29, 0.27, 1.0], dtype=np.float32)
img.pixels.foreach_set(np.tile(FILL, ATLAS * ATLAS))
bake_mat = bpy.data.materials.new('atlas')
bake_mat.use_nodes = True
nt = bake_mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.6
bsdf.inputs['Metallic'].default_value = 0.0
me.materials.clear()
me.materials.append(bake_mat)
nt.nodes.active = tex

# Bake the source's base colour onto the target's atlas.
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 4
bake = scene.render.bake
bake.use_selected_to_active = True
bake.cage_extrusion = CAGE
bake.max_ray_distance = RAY
bake.margin = 6
bake.use_clear = False
bpy.ops.object.select_all(action='DESELECT')
src.select_set(True)
dst.select_set(True)
bpy.context.view_layer.objects.active = dst
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True, cage_extrusion=CAGE,
                    max_ray_distance=RAY, margin=6, use_clear=False)
bpy.data.objects.remove(src, do_unlink=True)

# Give the texels no face covers the atlas's mean colour. Mipmaps blend them into the vehicle when
# it is far away, which is most of the time from a gunship, and black there darkens it.
px = np.empty(ATLAS * ATLAS * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(-1, 4)
empty = np.all(np.abs(px[:, :3] - FILL[:3]) < 0.003, axis=1)
if (~empty).any():
    px[empty, :3] = px[~empty, :3].mean(axis=0)
img.pixels.foreach_set(px.ravel())
img.update()
print(f'baked atlas: the model covers {100 * (1 - empty.mean()):.0f}% of it')

# Already oriented and sized: just re-centre on the reduced mesh.
lo, hi = bounds(dst)
dst.data.transform(Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
lo, hi = bounds(dst)
size = hi - lo
print(f'size (w, l, h) m: {size[0]:.2f} {size[1]:.2f} {size[2]:.2f}')
for p in dst.data.polygons:
    p.use_smooth = True

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_image_format='JPEG', export_jpeg_quality=86)
print(f'wrote {OUT} ({os.path.getsize(OUT) // 1024} KB, {tri_count(dst)} triangles)')

if PREVIEW:
    render_views(dst, PREVIEW, size, light='FLAT', oblique=True)
    img.filepath_raw = f'{PREVIEW}_atlas.png'
    img.file_format = 'PNG'
    img.save()
    print('atlas', img.filepath_raw)
