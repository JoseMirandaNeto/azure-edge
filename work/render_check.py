import bpy, math
from mathutils import Vector

def setup_render(path, w=500, h=600):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device='CPU'
    sc.cycles.samples=16
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    # world background dark gray
    wld = bpy.data.worlds.new('w'); wld.color = (0.12,0.12,0.14)
    sc.world = wld

def add_camera(loc, target):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    bpy.context.scene.camera = cam
    return cam

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_apose.glb')
setup_render('/tmp/x.png')
# front = looking from -Y (character faces -Y per render.ts)
add_camera((0,-2.2,0.55),(0,0,0.5))
bpy.ops.render.render(write_still=True)
bpy.context.scene.render.filepath='/home/hatch/workspace/azure-edge/work/male_from_negY.png'
bpy.ops.render.render(write_still=True)
# from +Y
bpy.context.scene.camera.location=(0,2.2,0.55)
d=Vector((0,0,0.5))-Vector((0,2.2,0.55))
bpy.context.scene.camera.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
bpy.context.scene.render.filepath='/home/hatch/workspace/azure-edge/work/male_from_posY.png'
bpy.ops.render.render(write_still=True)
# side from +X
bpy.context.scene.camera.location=(2.2,0,0.55)
d=Vector((0,0,0.5))-Vector((2.2,0,0.55))
bpy.context.scene.camera.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
bpy.context.scene.render.filepath='/home/hatch/workspace/azure-edge/work/male_from_posX.png'
bpy.ops.render.render(write_still=True)
print("renders done")
