import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_apose.glb')
mesh = [o for o in bpy.context.scene.objects if o.type=='MESH'][0]
mw = mesh.matrix_world
verts = [mw @ v.co for v in mesh.data.vertices]
low = [(i,v) for i,v in enumerate(verts) if v.z < 0.008]
print("verts z<0.008:", len(low))
if low:
    xs=[v.x for _,v in low]; ys=[v.y for _,v in low]
    print("  x", round(min(xs),3), round(max(xs),3), "y", round(min(ys),3), round(max(ys),3))
    # how many are outside boot footprints (|x|>0.13 or |y|>0.09)?
    out = [(i,v) for i,v in low if abs(v.x)>0.13 or abs(v.y)>0.09]
    print("  outside boot footprint:", len(out))
    if out:
        xs=[v.x for _,v in out]; ys=[v.y for _,v in out]
        print("  out x", round(min(xs),3), round(max(xs),3), "y", round(min(ys),3), round(max(ys),3))
# connected components of low verts via faces
polys = mesh.data.polygons
lowset = set(i for i,_ in low)
# build adjacency among low verts through faces
parent = {}
def find(a):
    while parent[a]!=a: parent[a]=parent[parent[a]]; a=parent[a]
    return a
def union(a,b):
    ra,rb=find(a),find(b)
    if ra!=rb: parent[ra]=rb
for i in lowset: parent[i]=i
for p in polys:
    idxs=[i for i in p.vertices if i in lowset]
    for a in idxs[1:]:
        union(idxs[0],a)
comps={}
for i in lowset:
    comps.setdefault(find(i),[]).append(i)
print("low-vert connected components:", len(comps), "sizes:", sorted([len(c) for c in comps.values()], reverse=True)[:10])
# are low verts connected to non-low verts (shared edges)? count faces mixing low/non-low
mix = sum(1 for p in polys if any(i in lowset for i in p.vertices) and any(i not in lowset for i in p.vertices))
print("faces mixing low and non-low verts:", mix)
