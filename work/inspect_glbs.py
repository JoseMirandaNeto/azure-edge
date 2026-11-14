import bpy, sys, math
from mathutils import Vector

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def load(path):
    bpy.ops.import_scene.gltf(filepath=path)

def report(tag):
    print(f"===== {tag} =====")
    for o in bpy.context.scene.objects:
        print(f"OBJ {o.type} name={o.name} loc={tuple(round(v,3) for v in o.location)} scale={tuple(round(v,3) for v in o.scale)}")
        if o.type == 'MESH':
            me = o.data
            print(f"  mesh verts={len(me.vertices)} tris={len(me.polygons)} mats={[m.name if m else None for m in me.materials]} vgroups={len(o.vertex_groups)}")
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
            mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
            print(f"  world bbox min={tuple(round(v,3) for v in mn)} max={tuple(round(v,3) for v in mx)} size={tuple(round(v,3) for v in (mx-mn))}")
        if o.type == 'ARMATURE':
            print(f"  armature bones={len(o.data.bones)}")
            defs = [b for b in o.data.bones if b.name.startswith('DEF-')]
            print(f"  DEF bones={len(defs)}")
            for b in defs:
                print(f"    {b.name} head={tuple(round(v,3) for v in b.head_local)} tail={tuple(round(v,3) for v in b.tail_local)} parent={b.parent.name if b.parent else None} use_deform={b.use_deform}")
            nondef = [b.name for b in o.data.bones if not b.name.startswith('DEF-')]
            print(f"  non-DEF sample: {nondef[:20]} total={len(nondef)}")

reset()
load('/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_f_r64_final.glb')
report('FEMALE')
# vertex groups with weights on female meshes
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        print(f"VG {o.name}: {[g.name for g in o.vertex_groups]}")
reset()
load('/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_apose.glb')
report('MALE')
