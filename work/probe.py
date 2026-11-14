import bpy
from mathutils import Vector, Matrix
# --- test edit_bone.matrix + length ---
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.armature_add(enter_editmode=True)
arm = bpy.context.object
eb = arm.data.edit_bones[0]
head = Vector((0.1, 0.0, 0.5))
y = Vector((0.3, 0.0, -0.9)).normalized()
x = Vector((1,0,0)) - y * Vector((1,0,0)).dot(y); x.normalize()
z = x.cross(y)
rot = Matrix((x, y, z)).to_4x4()
eb.matrix = Matrix.Translation(head) @ rot
print("after matrix: head", tuple(round(v,3) for v in eb.head), "tail", tuple(round(v,3) for v in eb.tail), "len", round(eb.length,3))
eb.length = 0.35
print("after length=0.35: head", tuple(round(v,3) for v in eb.head), "tail", tuple(round(v,3) for v in eb.tail))
# check local X axis via matrix
m = eb.matrix
print("matrix X col", tuple(round(v,3) for v in m.col[0][:3]), "Y col", tuple(round(v,3) for v in m.col[1][:3]))

# --- female root bone + stray verts ---
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_f_r64_final.glb')
arm = [o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0]
for b in arm.data.bones:
    if b.name in ('root','DEF-spine','DEF-spine.006'):
        print(f"bone {b.name} head={tuple(round(v,3) for v in b.head_local)} tail={tuple(round(v,3) for v in b.tail_local)}")
        print("   matrix_local X", tuple(round(v,3) for v in b.matrix_local.col[0][:3]), "Y", tuple(round(v,3) for v in b.matrix_local.col[1][:3]))
for b in arm.data.bones:
    if b.name in ('DEF-upper_arm.L','DEF-thigh.L','DEF-hand.L','DEF-forearm.L','DEF-shoulder.L'):
        print(f"bone {b.name} matrix_local X", tuple(round(v,3) for v in b.matrix_local.col[0][:3]), "Y", tuple(round(v,3) for v in b.matrix_local.col[1][:3]), "Z", tuple(round(v,3) for v in b.matrix_local.col[2][:3]))
mesh = [o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('warrior')][0]
mw = mesh.matrix_world
verts=[mw @ v.co for v in mesh.data.vertices]
far=[v for v in verts if abs(v.y)>0.16]
print("female verts |y|>0.16:", len(far))
if far:
    print("  x", round(min(v.x for v in far),3), round(max(v.x for v in far),3), "y", round(min(v.y for v in far),3), round(max(v.y for v in far),3), "z", round(min(v.z for v in far),3), round(max(v.z for v in far),3))
# female DEF group weight sums
import collections
tot=collections.Counter()
for v in mesh.data.vertices:
    s=sum(g.weight for g in v.groups if mesh.vertex_groups[g.group].name.startswith('DEF-'))
    tot['zero' if s==0 else 'ok' if s>0.9 else 'partial']+=1
print("female DEF weight sums:", dict(tot))
