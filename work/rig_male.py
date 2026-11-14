import bpy, math
from mathutils import Vector, Matrix

FEMALE = '/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_f_r64_final.glb'
MALE = '/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_apose.glb'
OUT = '/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_rigged.glb'
WORK = '/home/hatch/workspace/azure-edge/work/'

# ---------------------------------------------------------------- bones
# (name, head, tail, parent) — L side explicit; R mirrored on x.
L_BONES = [
    ('root',            (0.0,0.0,0.0),     (0.0,0.275,0.0),   None),
    ('DEF-spine',       (0.0,0.0,0.5),     (0.0,0.0,0.62),    'root'),
    ('DEF-spine.001',   (0.0,0.0,0.62),    (0.0,0.0,0.74),    'DEF-spine'),
    ('DEF-spine.002',   (0.0,0.0,0.74),    (0.0,0.0,0.82),    'DEF-spine.001'),
    ('DEF-spine.003',   (0.0,0.0,0.82),    (0.0,0.0,0.87),    'DEF-spine.002'),
    ('DEF-spine.004',   (0.0,0.0,0.87),    (0.0,0.0,0.90),    'DEF-spine.003'),
    ('DEF-spine.005',   (0.0,0.0,0.90),    (0.0,0.0,0.93),    'DEF-spine.004'),
    ('DEF-spine.006',   (0.0,0.0,0.93),    (0.0,0.0,0.96),    'DEF-spine.005'),
    ('DEF-pelvis.L',    (0.0,0.0,0.5),     (0.035,-0.012,0.535),'DEF-spine'),
    ('DEF-thigh.L',     (0.068,0.005,0.48),(0.065,-0.003,0.375),'DEF-spine'),
    ('DEF-thigh.L.001', (0.065,-0.003,0.375),(0.062,-0.01,0.27),'DEF-thigh.L'),
    ('DEF-shin.L',      (0.062,-0.01,0.27),(0.065,-0.003,0.165),'DEF-thigh.L.001'),
    ('DEF-shin.L.001',  (0.065,-0.003,0.165),(0.068,0.005,0.06),'DEF-shin.L'),
    ('DEF-foot.L',      (0.068,0.005,0.06),(0.068,-0.085,0.055),'DEF-shin.L.001'),
    ('DEF-toe.L',       (0.068,-0.085,0.055),(0.068,-0.171,0.026),'DEF-foot.L'),
    ('DEF-shoulder.L',  (0.04,0.01,0.80),  (0.15,0.02,0.78),  'DEF-spine.002'),
    ('DEF-upper_arm.L', (0.15,0.02,0.78),  (0.19,0.02,0.735), 'DEF-shoulder.L'),
    ('DEF-upper_arm.L.001',(0.19,0.02,0.735),(0.225,0.02,0.69),'DEF-upper_arm.L'),
    ('DEF-forearm.L',   (0.225,0.02,0.69), (0.225,0.01,0.61), 'DEF-upper_arm.L.001'),
    ('DEF-forearm.L.001',(0.225,0.01,0.61), (0.22,0.0,0.53),  'DEF-forearm.L'),
    ('DEF-hand.L',      (0.22,0.0,0.53),   (0.22,0.0,0.44),   'DEF-forearm.L.001'),
]
def mirror(name):
    return name.replace('.L', '.R')
def mirror_vec(v):
    return (-v[0], v[1], v[2])

BONES = list(L_BONES)
for (n, h, t, p) in L_BONES:
    if '.L' in n:
        BONES.append((mirror(n), mirror_vec(h), mirror_vec(t), mirror(p) if p else None))

# ---------------------------------------------------------------- import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=FEMALE)
female_arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
female_mesh = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('warrior')][0]
# female bone X-axis hints (armature space), by name
hint = {}
for b in female_arm.data.bones:
    hint[b.name] = Vector(b.matrix_local.col[0][:3])
print("hint DEF-hand.R:", tuple(round(v,3) for v in hint['DEF-hand.R']))
print("hint DEF-upper_arm.R:", tuple(round(v,3) for v in hint['DEF-upper_arm.R']))
print("hint DEF-thigh.R:", tuple(round(v,3) for v in hint['DEF-thigh.R']))

bpy.ops.import_scene.gltf(filepath=MALE)
male_mesh = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name == 'LOW'][0]
print("male mesh:", male_mesh.name, "verts", len(male_mesh.data.vertices))

# ---------------------------------------------------------------- weight transfer (a): female -> male by nearest face
DEF_NAMES = [n for (n,_,_,_) in BONES if n.startswith('DEF-')]
for gname in DEF_NAMES:
    male_mesh.vertex_groups.new(name=gname)
bpy.ops.object.select_all(action='DESELECT')
male_mesh.select_set(True)
female_mesh.select_set(True)
bpy.context.view_layer.objects.active = female_mesh  # active = source
try:
    bpy.ops.object.data_transfer(data_type='VGROUP_WEIGHTS', use_create=True,
        vert_mapping='POLYINTERP_NEAREST', use_object_transform=True,
        layers_select_src='ALL', layers_select_dst='NAME',
        mix_mode='REPLACE', mix_factor=1.0)
    print("data_transfer OK")
except Exception as e:
    print("data_transfer FAILED:", e)
    raise
# normalize + diagnostics
bpy.ops.object.select_all(action='DESELECT')
male_mesh.select_set(True)
bpy.context.view_layer.objects.active = male_mesh
# prune non-DEF groups (data_transfer ALL copied all 256 female groups)
for g in list(male_mesh.vertex_groups):
    if g.name not in DEF_NAMES:
        male_mesh.vertex_groups.remove(g)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
mw = male_mesh.matrix_world
bad = 0; zero = 0
for v in male_mesh.data.vertices:
    s = sum(g.weight for g in v.groups)
    if s == 0: zero += 1
    elif abs(s - 1.0) > 0.01: bad += 1
print(f"weight check: verts={len(male_mesh.data.vertices)} zero_weight={zero} not_normalized={bad}")
if zero:
    gsp = male_mesh.vertex_groups['DEF-spine']
    for v in male_mesh.data.vertices:
        if sum(g.weight for g in v.groups) == 0:
            gsp.add([v.index], 1.0, 'REPLACE')
    print(f"assigned {zero} zero-weight verts to DEF-spine")
for gname in DEF_NAMES:
    g = male_mesh.vertex_groups.get(gname)
    n = sum(1 for v in male_mesh.data.vertices if any(male_mesh.vertex_groups[gr.group].name == gname and gr.weight > 0.01 for gr in v.groups))
    print(f"  group {gname}: {n} verts w>0.01")

# blade cleanup: back blade (y>0.088, clearly outside torso) -> spine by z
def set_group(vi, gname, w=1.0):
    g = male_mesh.vertex_groups[gname]
    for grp in list(male_mesh.data.vertices[vi].groups):
        male_mesh.vertex_groups[grp.group].remove([vi])
    g.add([vi], w, 'REPLACE')
blade = 0; frontblade = 0
for i, v in enumerate(male_mesh.data.vertices):
    co = mw @ v.co
    if abs(co.x) < 0.07 and co.y > 0.088 and 0.40 < co.z < 0.90:
        z = co.z
        bn = 'DEF-spine.003' if z > 0.74 else 'DEF-spine.002' if z > 0.62 else 'DEF-spine.001' if z > 0.50 else 'DEF-spine'
        set_group(i, bn); blade += 1
    elif abs(co.x) < 0.035 and co.y < -0.082 and 0.20 < co.z < 0.50:
        # front blade tip between/before the shins (no leg surface at |x|<0.035 there)
        set_group(i, 'DEF-spine'); frontblade += 1
print(f"blade verts reassigned: back={blade} front={frontblade}")
# front skirt/tasset panels: hang in front of the thighs (y<-0.085, z 0.35..0.55)
# but the transfer gave them thigh weights -> they swing out with the leg.
# Reassign to DEF-spine so they hang from the waist like the female's skirt.
skirt = 0
for i, v in enumerate(male_mesh.data.vertices):
    co = mw @ v.co
    if co.y < -0.085 and 0.35 < co.z < 0.55 and 0.03 < abs(co.x) < 0.17:
        set_group(i, 'DEF-spine'); skirt += 1
print(f"skirt panel verts reassigned to spine: {skirt}")
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

# ---------------------------------------------------------------- build armature (DEF-only, 33 + root)
bpy.ops.object.armature_add(enter_editmode=True, location=(0,0,0))
arm = bpy.context.object
arm.name = 'rig'
arm.data.display_type = 'STICK'
# remove default bone
for eb in list(arm.data.edit_bones):
    arm.data.edit_bones.remove(eb)
ebs = {}
for (name, h, t, parent) in BONES:
    eb = arm.data.edit_bones.new(name)
    head = Vector(h); tail = Vector(t)
    eb.head = head; eb.tail = tail
    y = (tail - head).normalized()
    hx = hint.get(name)
    if hx is None:
        hx = Vector((1,0,0))
    xdes = hx - y * hx.dot(y)
    if xdes.length < 1e-6:
        xdes = Vector((1,0,0)) - y * y.x
    xdes.normalize()
    eb.roll = 0.0
    X0 = Vector(eb.matrix.col[0][:3])
    r = math.atan2(y.cross(X0).dot(xdes), X0.dot(xdes))
    eb.roll = r
    X1 = Vector(eb.matrix.col[0][:3])
    if X1.dot(xdes) < 0.99:
        eb.roll = -r
        X1 = Vector(eb.matrix.col[0][:3])
    assert X1.dot(xdes) > 0.99, f"{name}: roll failed dot={X1.dot(xdes)}"
    ebs[name] = eb
for (name, h, t, parent) in BONES:
    if parent:
        ebs[name].parent = ebs[parent]
        ebs[name].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
print("armature bones:", len(arm.data.bones))
for b in arm.data.bones:
    print(f"  {b.name} head={tuple(round(v,3) for v in b.head_local)} tail={tuple(round(v,3) for v in b.tail_local)} parent={b.parent.name if b.parent else None}")

# ---------------------------------------------------------------- parent mesh to armature
male_mesh.parent = arm
mod = male_mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
mod.use_vertex_groups = True
bpy.context.view_layer.objects.active = male_mesh

# ---------------------------------------------------------------- pose test (replicates render.ts glbPoseTarget)
def apply_pose(state):
    # returns dict bone->(x,y,z) local euler deltas
    import math
    if state == 'walk':
        s = 1.0
        return {
            'DEF-thigh.L': (-0.25,0,0), 'DEF-thigh.L.001': (-0.25,0,0),
            'DEF-thigh.R': (0.25,0,0), 'DEF-thigh.R.001': (0.25,0,0),
            'DEF-shin.L': (0.04,0,0), 'DEF-shin.L.001': (0.04,0,0),
            'DEF-shin.R': (0.29,0,0), 'DEF-shin.R.001': (0.29,0,0),
            'DEF-upper_arm.L': (-0.175,0,0), 'DEF-upper_arm.L.001': (-0.175,0,0),
            'DEF-upper_arm.R': (0.175,0,0), 'DEF-upper_arm.R.001': (0.175,0,0),
            'DEF-forearm.L': (0.15,0,0), 'DEF-forearm.L.001': (0.15,0,0),
            'DEF-forearm.R': (0.15,0,0), 'DEF-forearm.R.001': (0.15,0,0),
            'DEF-spine': (0.0245,0.07,0), 'DEF-spine.001': (0.0175,0,0),
            'DEF-spine.002': (0.014,0,0), 'DEF-spine.003': (0.014,0,0),
        }
    if state == 'attack':
        return {
            'DEF-upper_arm.R': (0.525,0,0), 'DEF-upper_arm.R.001': (0.525,0,0),
            'DEF-forearm.R': (0.05,0,0), 'DEF-forearm.R.001': (0.05,0,0),
            'DEF-upper_arm.L': (-0.175,0,0), 'DEF-upper_arm.L.001': (-0.175,0,0),
            'DEF-forearm.L': (0.25,0,0), 'DEF-forearm.L.001': (0.25,0,0),
            'DEF-thigh.L': (-0.15,0,0), 'DEF-thigh.L.001': (-0.15,0,0),
            'DEF-thigh.R': (0.175,0,0), 'DEF-thigh.R.001': (0.175,0,0),
            'DEF-spine': (0.063,0.3,0), 'DEF-spine.001': (0.045,0,0),
            'DEF-spine.002': (0.036,0,0), 'DEF-spine.003': (0.036,0,0),
        }
    return {}

def set_pose(state):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0,0,0)
    for name, e in apply_pose(state).items():
        pb = arm.pose.bones.get(name)
        if pb: pb.rotation_euler = e
    bpy.context.view_layer.update()
    bpy.context.scene.frame_set(bpy.context.scene.frame_current)

def render_view(path, cam_loc, target=(0,0,0.5)):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'; sc.cycles.samples = 16
    sc.render.resolution_x = 500; sc.render.resolution_y = 600
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    wld = bpy.data.worlds.new('w'); wld.color = (0.12,0.12,0.14)
    sc.world = wld
    # remove old cameras
    for o in list(bpy.data.objects):
        if o.type == 'CAMERA': bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.camera_add(location=cam_loc)
    cam = bpy.context.object
    d = Vector(target) - Vector(cam_loc)
    cam.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    sc.camera = cam
    # light
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT': bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.light_add(type='SUN', location=(2,-3,4))
    bpy.context.object.data.energy = 4
    bpy.ops.render.render(write_still=True)

set_pose('rest')
render_view(WORK + 'male_rigged_rest.png', (0,-2.2,0.55))
# measure hand/foot displacement in walk pose vs rest
def hand_pos():
    # world pos of a vertex near the left wrist (x~0.22,z~0.53) and left ankle
    dg = bpy.context.evaluated_depsgraph_get()
    ev = male_mesh.evaluated_get(dg)
    vs = [ev.matrix_world @ v.co for v in ev.data.vertices]
    def near(cx, cy, cz, r=0.05):
        sel = [v for v in vs if (v.x-cx)**2 + (v.y-cy)**2 + (v.z-cz)**2 < r*r]
        if not sel: return None
        n = len(sel)
        return tuple(round(sum(v[i] for v in sel)/n, 3) for i in range(3))
    return near(0.22, 0.0, 0.53), near(0.07, 0.0, 0.06), near(-0.22, 0.0, 0.53)
print("rest wristL/ankleL/wristR:", hand_pos())
set_pose('walk')
render_view(WORK + 'male_rigged_walk.png', (0,-2.2,0.55))
print("walk wristL/ankleL/wristR:", hand_pos())
set_pose('attack')
render_view(WORK + 'male_rigged_attack.png', (0,-2.2,0.55))
print("attack wristL/ankleL/wristR:", hand_pos())

# ---------------------------------------------------------------- export
set_pose('rest')
bpy.ops.object.select_all(action='DESELECT')
# delete female objects + icosphere junk
for o in list(bpy.context.scene.objects):
    if o is not male_mesh and o is not arm:
        bpy.data.objects.remove(o, do_unlink=True)
male_mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_skins=True, export_animations=False,
    export_texcoords=True, export_normals=True, export_image_format='AUTO')
print("EXPORTED", OUT)
import os
print("size MB:", round(os.path.getsize(OUT)/1e6, 2))
