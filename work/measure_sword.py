import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_apose.glb')
mesh_obj = [o for o in bpy.context.scene.objects if o.type=='MESH'][0]
mw = mesh_obj.matrix_world
verts = [mw @ v.co for v in mesh_obj.data.vertices]
# blade = thin flat verts near x=0 center, away from torso depth: |y|>0.06 or in leg gap
for z0 in [0.8,0.7,0.6,0.5,0.45,0.4,0.35,0.3,0.25,0.2]:
    sel=[v for v in verts if abs(v.z-z0)<0.015 and abs(v.x)<0.05]
    if sel:
        ys=sorted(round(v.y,3) for v in sel)
        print(f"z={z0} n={len(sel)} y min={ys[0]} max={ys[-1]} mid-y={sorted(set(ys))[:12]}")
# foot direction: verts z<0.06, |x| in 0.05..0.16 (feet), y range
for z0 in [0.03,0.05]:
    sel=[v for v in verts if abs(v.z-z0)<0.01 and 0.04<abs(v.x)<0.17]
    ys=sorted(round(v.y,3) for v in sel)
    print(f"foot z={z0} n={len(sel)} y {ys[0]}..{ys[-1]}")
