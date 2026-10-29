# Builds the game's guided bomb prop (public/assets/models/gbu.glb): a generic guided bomb with a
# seeker nose and small canards, an olive body with a yellow band, and an X-pattern tail kit.
# Untextured PBR materials (it is a few dozen pixels on screen at most), ~1.2k triangles.
#
# Usage:
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --factory-startup \
#       --python scripts/blender/make_gbu.py -- public/assets/models/gbu.glb [preview.png]
#
# Axes: Blender -Y becomes glTF +Z, so the bomb is built along Y with the nose toward -Y and comes
# out of the exporter facing +Z with Y up. Origin at the centre of the body, metres.
import math
import sys

import bmesh
import bpy

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'gbu.glb'
PREVIEW = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, rgb, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    return m


# Linear colours.
# Light grey (as on navy and many export stores), so it stands out against dry ground from altitude.
BODY = material('Body', (0.34, 0.35, 0.35), 0.0, 0.5)
BAND = material('Band', (0.75, 0.5, 0.02), 0.0, 0.5)
KIT = material('Kit', (0.12, 0.125, 0.12), 0.3, 0.45)
SEEKER = material('Seeker', (0.015, 0.015, 0.02), 0.0, 0.08)


def lathe(name, profile, mat, segs=24):
    """Spins (radius, y) profile points around the Y axis."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))
    # Close the ends with fans.
    for ring, y in ((rings[0], profile[0][1]), (rings[-1], profile[-1][1])):
        if profile[0][0] > 1e-4 or ring is rings[-1]:
            c = bm.verts.new((0, y, 0))
            for i in range(segs):
                j = (i + 1) % segs
                if ring is rings[0]:
                    bm.faces.new((c, ring[j], ring[i]))
                else:
                    bm.faces.new((c, ring[i], ring[j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def fin(name, root_y0, root_y1, tip_y0, tip_y1, r0, span, angle, thick, mat):
    """Thin trapezoid fin standing out from radius r0 at the given roll angle."""
    bm = bmesh.new()
    pts = [(r0, root_y0), (r0, root_y1), (r0 + span, tip_y1), (r0 + span, tip_y0)]
    top, bot = [], []
    for rad, y in pts:
        for side, lst in ((thick / 2, top), (-thick / 2, bot)):
            # Fin plane: radial direction (cos a, sin a), thickness along the tangent.
            x = rad * math.cos(angle) - side * math.sin(angle)
            z = rad * math.sin(angle) + side * math.cos(angle)
            lst.append(bm.verts.new((x, y, z)))
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


parts = []
# Seeker head: a dark glass dome on a slim guidance section, flaring into the body.
parts.append(lathe('Seeker', [(0.0, -1.66), (0.035, -1.655), (0.06, -1.635), (0.075, -1.6), (0.082, -1.57)], SEEKER))
parts.append(lathe('Nose', [(0.082, -1.57), (0.09, -1.55), (0.09, -1.22), (0.1, -1.12), (0.125, -0.98), (0.136, -0.86)], KIT))
# Warhead body with a tail cone.
parts.append(lathe('Body', [(0.136, -0.86), (0.137, -0.6), (0.137, 0.62), (0.13, 0.82), (0.112, 1.05), (0.1, 1.22), (0.0, 1.24)], BODY))
# Yellow band: high-explosive filling.
parts.append(lathe('Band', [(0.1385, -0.74), (0.1385, -0.64)], BAND))
# Tail kit housing.
parts.append(lathe('Tail', [(0.118, 0.95), (0.122, 1.0), (0.122, 1.42), (0.1, 1.48), (0.0, 1.49)], KIT))

for k in range(4):
    a = math.pi / 4 + k * math.pi / 2
    parts.append(fin(f'Canard{k}', -1.48, -1.34, -1.44, -1.38, 0.088, 0.1, a, 0.012, KIT))
    parts.append(fin(f'Wing{k}', 0.98, 1.42, 1.22, 1.44, 0.12, 0.33, a, 0.016, KIT))

bpy.ops.object.select_all(action='DESELECT')
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[2]
bpy.ops.object.join()
bomb = bpy.context.view_layer.objects.active
bomb.name = 'GBU'
bpy.ops.object.shade_auto_smooth(angle=math.radians(40)) if hasattr(bpy.ops.object, 'shade_auto_smooth') else None

tris = sum(len(p.vertices) - 2 for p in bomb.data.polygons)
print(f'GBU triangles: {tris}, materials: {len(bomb.data.materials)}')

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_apply=True, export_yup=True)
print('wrote', OUT)

if PREVIEW:
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (2.6, 0.2, 1.4)
    cam.rotation_euler = (math.radians(62), 0, math.radians(95))
    cam_data.lens = 22
    scene.camera = cam
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4
    sun_ob = bpy.data.objects.new('sun', sun)
    sun_ob.rotation_euler = (math.radians(40), 0, math.radians(30))
    scene.collection.objects.link(sun_ob)
    world = bpy.data.worlds.new('w')
    world.color = (0.25, 0.27, 0.3)
    scene.world = world
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items.keys() else 'BLENDER_EEVEE'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 500
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)

# Optional third argument: a transparent side-view icon (nose right, 512x128) for the HUD.
ICON = args[2] if len(args) > 2 else None
if ICON:
    for ob in list(scene.objects):
        if ob.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(ob, do_unlink=True)
    cam_data = bpy.data.cameras.new('icon_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 3.45
    cam = bpy.data.objects.new('icon_cam', cam_data)
    scene.collection.objects.link(cam)
    # Looking along +X with the nose (-Y) to the right of the frame.
    cam.location = (-6, -0.08, 0)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    scene.camera = cam
    for rot, energy in (((math.radians(35), math.radians(-20), math.radians(-60)), 3.5), ((math.radians(-60), 0, math.radians(120)), 1.0)):
        light = bpy.data.lights.new('icon_light', 'SUN')
        light.energy = energy
        lob = bpy.data.objects.new('icon_light', light)
        lob.rotation_euler = rot
        scene.collection.objects.link(lob)
    world = bpy.data.worlds.new('icon_world')
    world.color = (0.35, 0.36, 0.38)
    scene.world = world
    scene.render.film_transparent = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 128
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = ICON
    bpy.ops.render.render(write_still=True)
    print('icon', ICON)
