import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_rigged.glb')
arm = [o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0]
print("bones:", len(arm.data.bones), "mesh objects:", [o.name for o in bpy.context.scene.objects if o.type=='MESH'])
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
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=16
sc.render.resolution_x=500; sc.render.resolution_y=600
sc.render.image_settings.file_format='PNG'
wld=bpy.data.worlds.new('w'); wld.color=(0.12,0.12,0.14); sc.world=wld
bpy.ops.object.light_add(type='SUN', location=(2,-3,4)); bpy.context.object.data.energy=4
def shot(path, loc):
    for o in list(bpy.data.objects):
        if o.type=='CAMERA': bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.camera_add(location=loc)
    cam=bpy.context.object
    d=Vector((0,0,0.5))-Vector(loc)
    cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
    sc.camera=cam; sc.render.filepath=path
    bpy.ops.render.render(write_still=True)
shot('/home/hatch/workspace/azure-edge/work/attack_side.png',(2.2,0,0.55))
shot('/home/hatch/workspace/azure-edge/work/attack_back.png',(0,2.2,0.55))
print("done")
