import bpy
from mathutils import Vector
from collections import Counter
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_rigged.glb')
mesh = [o for o in bpy.context.scene.objects if o.type=='MESH' and o.name=='LOW'][0]
mw = mesh.matrix_world
# panel region: front waist, y<-0.06, z 0.42..0.60
sel = []
for v in mesh.data.vertices:
    co = mw @ v.co
    if co.y < -0.06 and 0.42 < co.z < 0.60 and abs(co.x) < 0.18:
        sel.append((v, co))
print("panel-region verts:", len(sel))
if sel:
    xs=[c.x for _,c in sel]; ys=[c.y for _,c in sel]; zs=[c.z for _,c in sel]
    print("  x", round(min(xs),3), round(max(xs),3), "y", round(min(ys),3), round(max(ys),3), "z", round(min(zs),3), round(max(zs),3))
    dom = Counter()
    for v, co in sel:
        if v.groups:
            g = max(v.groups, key=lambda gr: gr.weight)
            dom[mesh.vertex_groups[g.group].name] += 1
    print("  dominant groups:", dom.most_common(8))
# also check the whole front waist band weights for context
sel2 = [(v, mw @ v.co) for v in mesh.data.vertices if 0.35 < (mw @ v.co).z < 0.55 and (mw @ v.co).y < -0.05]
dom2 = Counter()
for v, co in sel2:
    if v.groups:
        g = max(v.groups, key=lambda gr: gr.weight)
        dom2[mesh.vertex_groups[g.group].name] += 1
print("front waist band verts:", len(sel2), "dominant:", dom2.most_common(8))
