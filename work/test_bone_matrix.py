import bpy
from mathutils import Vector, Matrix

def rot_from_axes(x, y, z):
    return Matrix(((x.x,y.x,z.x),(x.y,y.y,z.y),(x.z,y.z,z.z)))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.armature_add(enter_editmode=True, location=(0,0,0))
arm = bpy.context.object
for eb in list(arm.data.edit_bones):
    arm.data.edit_bones.remove(eb)

# test A: matrix + length (exact rig script sequence)
head = Vector((0.068,0.005,0.48)); tail = Vector((0.065,-0.003,0.375))
y = (tail-head).normalized()
hx = Vector((0.928,-0.371,0.0))
x = hx - y*hx.dot(y); x.normalize()
z = x.cross(y)
eb = arm.data.edit_bones.new('A')
eb.matrix = Matrix.Translation(head) @ rot_from_axes(x, y, z).to_4x4()
print("A after matrix: head", tuple(round(v,3) for v in eb.head), "tail", tuple(round(v,3) for v in eb.tail))
eb.length = (tail-head).length
print("A after length: head", tuple(round(v,3) for v in eb.head), "tail", tuple(round(v,3) for v in eb.tail))
print("A matrix Y col:", tuple(round(v,3) for v in eb.matrix.col[1][:3]))

# test B: matrix only, no length
eb2 = arm.data.edit_bones.new('B')
eb2.matrix = Matrix.Translation(head) @ rot_from_axes(x, y, z).to_4x4()
print("B after matrix: head", tuple(round(v,3) for v in eb2.head), "tail", tuple(round(v,3) for v in eb2.tail))

# test C: head/tail + roll
eb3 = arm.data.edit_bones.new('C')
eb3.head = head; eb3.tail = tail
print("C head/tail: head", tuple(round(v,3) for v in eb3.head), "tail", tuple(round(v,3) for v in eb3.tail), "roll", round(eb3.roll,3))
print("C matrix Y col:", tuple(round(v,3) for v in eb3.matrix.col[1][:3]), "X col:", tuple(round(v,3) for v in eb3.matrix.col[0][:3]))
# set roll so local X matches x: roll from matrix math
# Blender: eb.roll is angle; compute via atan2 of x projected on bone frame
# Use matrix decomposition: build R, then roll = atan2(R[0][2]... ) -- test with known util:
from mathutils import Matrix as M
R = rot_from_axes(x, y, z)
# mat3_to_vec_roll equivalent: 
import math
# reference from Blender source: 
#   nor = y; 
#   x0 = R col0 projected... 
#   roll = atan2(dot(cross(y, ref), x), dot(ref, x)) where ref = normalized(cross(y, (0,0,1))) if |y.z|<1 else (1,0,0)
ref = y.cross(Vector((0,0,1)))
if ref.length < 1e-6:
    ref = Vector((1,0,0))
ref.normalize()
roll = math.atan2(ref.cross(y).dot(x), ref.dot(x))
print("computed roll:", round(roll,4))
eb3.roll = roll
print("C after roll: X col:", tuple(round(v,3) for v in eb3.matrix.col[0][:3]), "want", tuple(round(v,3) for v in x))
