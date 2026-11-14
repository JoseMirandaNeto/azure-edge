import bpy, math
from mathutils import Vector
from collections import defaultdict

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/home/hatch/workspace/azure-edge/apps/client/public/assets/characters/warrior_m_r64_final_apose.glb')
mesh_obj = [o for o in bpy.context.scene.objects if o.type=='MESH'][0]
mw = mesh_obj.matrix_world
verts = [mw @ v.co for v in mesh_obj.data.vertices]
print(f"verts={len(verts)}")

def slice_centroids(z0, dz=0.012):
    sel = [v for v in verts if abs(v.z-z0)<dz]
    if not sel: return None
    left = [v for v in sel if v.x>0.01]
    right = [v for v in sel if v.x<-0.01]
    mid = [v for v in sel if -0.01<=v.x<=0.01]
    def c(vs):
        if not vs: return None
        n=len(vs)
        return (round(sum(v.x for v in vs)/n,3), round(sum(v.y for v in vs)/n,3), round(sum(v.z for v in vs)/n,3), n)
    return c(left), c(right), c(mid)

print("--- leg/body slices (Lx,Ly,Lz,n | Rx,Ry,Rz,n | mid) ---")
for z in [0.95,0.9,0.85,0.8,0.75,0.7,0.65,0.6,0.55,0.5,0.45,0.4,0.35,0.3,0.25,0.2,0.15,0.1,0.05,0.02]:
    print(z, slice_centroids(z))
print("--- Y extent by region ---")
for name, cond in [("x>0.2 (arms/hands)", lambda v: v.x>0.2),
                   ("x<-0.2", lambda v: v.x<-0.2),
                   ("y<-0.08 (back/sword?)", lambda v: v.y<-0.08),
                   ("y>0.08 (front)", lambda v: v.y>0.08)]:
    sel=[v for v in verts if cond(v)]
    if sel:
        print(name, "n=",len(sel), "x",round(min(v.x for v in sel),3),round(max(v.x for v in sel),3),
              "y",round(min(v.y for v in sel),3),round(max(v.y for v in sel),3),
              "z",round(min(v.z for v in sel),3),round(max(v.z for v in sel),3))
# arm verts: outside torso |x|>0.16, z>0.45: PCA line fit
import mathutils
arm=[v for v in verts if v.x>0.16 and v.z>0.4]
print("arm verts L n=",len(arm))
if arm:
    c=Vector((sum(v.x for v in arm)/len(arm), sum(v.y for v in arm)/len(arm), sum(v.z for v in arm)/len(arm)))
    # covariance PCA
    import numpy as np
    A=np.array([[v.x-c.x, v.y-c.y, v.z-c.z] for v in arm])
    cov=np.cov(A.T)
    w,V=np.linalg.eigh(cov)
    axis=V[:,np.argmax(w)]
    print("arm centroid", tuple(round(v,3) for v in c), "axis", tuple(round(float(v),3) for v in axis))
    # project verts on axis, find extent + elbow kink: centroid of cross-sections along axis
    ts=[float(np.dot(np.array([v.x-c.x,v.y-c.y,v.z-c.z]),axis)) for v in arm]
    for t0 in sorted(set(round(t,1) for t in ts)):
        sel=[v for v,t in zip(arm,ts) if abs(t-t0)<0.05]
        if len(sel)>20:
            cc=Vector((sum(v.x for v in sel)/len(sel), sum(v.y for v in sel)/len(sel), sum(v.z for v in sel)/len(sel)))
            print(f"  arm t={t0} n={len(sel)} centroid={tuple(round(v,3) for v in cc)}")
