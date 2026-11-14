import bpy
from mathutils import Vector
from collections import Counter
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_rigged.glb')
arm = [o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0]
mesh = [o for o in bpy.context.scene.objects if o.type=='MESH' and o.name=='LOW'][0]
ATTACK = {
 'DEF-upper_arm.R': (0.525,0,0), 'DEF-upper_arm.R.001': (0.525,0,0),
 'DEF-forearm.R': (0.05,0,0), 'DEF-forearm.R.001': (0.05,0,0),
 'DEF-upper_arm.L': (-0.175,0,0), 'DEF-upper_arm.L.001': (-0.175,0,0),
 'DEF-forearm.L': (0.25,0,0), 'DEF-forearm.L.001': (0.25,0,0),
 'DEF-thigh.L': (-0.15,0,0), 'DEF-thigh.L.001': (-0.15,0,0),
 'DEF-thigh.R': (0.175,0,0), 'DEF-thigh.R.001': (0.175,0,0),
 'DEF-spine': (0.063,0.3,0), 'DEF-spine.001': (0.045,0,0),
 'DEF-spine.002': (0.036,0,0), 'DEF-spine.003': (0.036,0,0),
}
for pb in arm.pose.bones:
    pb.rotation_mode='XYZ'; pb.rotation_euler=(0,0,0)
for n,e in ATTACK.items():
    arm.pose.bones[n].rotation_euler=e
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(dg)
mw = mesh.matrix_world
rest = {v.index: mw @ v.co for v in mesh.data.vertices}
posed = {v.index: ev.matrix_world @ v.co for v in ev.data.vertices}
# verts that end up far forward at waist height in attack pose
far = []
for i, pc in posed.items():
    if pc.y < -0.12 and 0.35 < pc.z < 0.65:
        far.append((i, rest[i], pc))
print("attack verts y<-0.12, z 0.35..0.65:", len(far))
if far:
    xs=[p.x for _,_,p in far]; ys=[p.y for _,_,p in far]; zs=[p.z for _,_,p in far]
    print("  posed x", round(min(xs),3), round(max(xs),3), "y", round(min(ys),3), round(max(ys),3), "z", round(min(zs),3), round(max(zs),3))
    dom = Counter()
    for i, rc, pc in far:
        v = mesh.data.vertices[i]
        if v.groups:
            g = max(v.groups, key=lambda gr: gr.weight)
            dom[mesh.vertex_groups[g.group].name] += 1
    print("  dominant groups:", dom.most_common(8))
    # rest positions of the farthest ones
    far.sort(key=lambda t: t[2].y)
    for i, rc, pc in far[:6]:
        print(f"  v{i} rest={tuple(round(v,3) for v in rc)} posed={tuple(round(v,3) for v in pc)}")
