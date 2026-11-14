import bpy, math
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.armature_add(enter_editmode=True, location=(0,0,0))
arm = bpy.context.object
for eb in list(arm.data.edit_bones):
    arm.data.edit_bones.remove(eb)

head = Vector((0.068,0.005,0.48)); tail = Vector((0.065,-0.003,0.375))
y = (tail-head).normalized()
xdes = Vector((0.928,-0.371,0.002)).normalized()
# orthogonalize desired against y
xdes = xdes - y*xdes.dot(y); xdes.normalize()

eb = arm.data.edit_bones.new('T')
eb.head = head; eb.tail = tail
eb.roll = 0.0
X0 = Vector(eb.matrix.col[0][:3])
print("roll0 X0:", tuple(round(v,3) for v in X0))
a = X0.dot(xdes)
b = y.cross(X0).dot(xdes)
r = math.atan2(b, a)
print("r =", round(r,4))
eb.roll = r
X1 = Vector(eb.matrix.col[0][:3])
print("after roll=r X:", tuple(round(v,3) for v in X1), "want", tuple(round(v,3) for v in xdes), "dot", round(X1.dot(xdes),4))
if X1.dot(xdes) < 0.99:
    eb.roll = -r
    X2 = Vector(eb.matrix.col[0][:3])
    print("after roll=-r X:", tuple(round(v,3) for v in X2), "dot", round(X2.dot(xdes),4))
