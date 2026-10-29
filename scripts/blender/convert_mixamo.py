# Combines a Mixamo character and its animations into one game-ready GLB for the soldier baker
# (src/render/models.js bakeSoldier), with the clip names the game expects:
#   Run, Walk, Idle_Gun, Idle_Gun_Shoot, Death, HitRecieve
#
# Download from mixamo.com as "FBX Binary", 30 fps: the character once "With Skin", and each
# animation "Without Skin" (tick "In Place" for Run and Walk).
#
# Usage:
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --factory-startup \
#     --python scripts/blender/convert_mixamo.py -- <character.fbx> <output.glb> \
#     Run=<run.fbx> Walk=<walk.fbx> Idle_Gun=<idle.fbx> Idle_Gun_Shoot=<firing.fbx> \
#     Death=<dying.fbx> HitRecieve=<hit.fbx> [--tex=512]
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pos = [a for a in argv if not a.startswith('--') and '=' not in a]
clips = dict(a.split('=', 1) for a in argv if '=' in a and not a.startswith('--'))
opt = dict(a[2:].split('=', 1) for a in argv if a.startswith('--') and '=' in a)
if len(pos) < 2 or not clips:
    raise SystemExit('usage: convert_mixamo.py -- <character.fbx> <out.glb> Clip=<anim.fbx> ...')
CHAR, OUT = os.path.abspath(pos[0]), os.path.abspath(pos[1])
TEX = int(opt.get('tex', 512))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(path), automatic_bone_orientation=False)
    return [o for o in bpy.data.objects if o not in before]


objs = import_fbx(CHAR)
arm = next(o for o in objs if o.type == 'ARMATURE')
arm.name = 'Soldier'
if arm.animation_data is None:
    arm.animation_data_create()
# Drop any animation that came with the character file.
if arm.animation_data.action:
    arm.animation_data.action = None

for name, path in clips.items():
    new = import_fbx(path)
    src = next(o for o in new if o.type == 'ARMATURE')
    act = src.animation_data.action if src.animation_data else None
    if act is None:
        raise SystemExit(f'no animation in {path}')
    act.name = name
    act.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    start = int(act.frame_range[0])
    track.strips.new(name, start, act)
    track.mute = False
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f'clip {name}: frames {act.frame_range[0]:.0f}-{act.frame_range[1]:.0f}')

# Smaller textures: the soldiers are a few dozen pixels tall on screen.
for img in bpy.data.images:
    if img.size[0] > TEX or img.size[1] > TEX:
        k = TEX / max(img.size)
        img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'character: {tris} triangles')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_yup=True,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_image_format='JPEG',
    export_jpeg_quality=85,
)
print(f'wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)')
