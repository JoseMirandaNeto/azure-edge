#!/usr/bin/env python3
"""Scenery post-process: TRELLIS2 GLB -> low-poly textured GLB.

Run with Blender (headless), NOT system python:
  blender -b --python scenery_bake.py -- --in raw.glb --out final.glb \
      --height 8 --tris 12000 --res 1024

Steps: import, join meshes, normalise to --height metres, keep HIGH copy,
voxel-remesh a LOW copy to ~--tris, cube-project UV on LOW, bake DIFFUSE
(colour only) + NORMAL (tangent) from HIGH selected-to-active, export GLB
with packed textures.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
import bmesh


def log(m):
    print("[SCENERY] " + str(m), flush=True)


def parse():
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--height", type=float, default=5.0)
    p.add_argument("--tris", type=int, default=12000)
    p.add_argument("--res", type=int, default=1024)
    p.add_argument("--name", default="")
    p.add_argument("--no-voxel", action="store_true",
                   help="skip voxel remesh (thin parts like fronds); decimate COLLAPSE only")
    p.add_argument("--drop-floor", action="store_true",
                   help="delete near-horizontal faces at the very bottom (TRELLIS2 "
                        "turns the concept's contact shadow into a floor plane)")
    a = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
    return a


def tris_of(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def select_only(obj):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def audit(obj, tag):
    me = obj.data
    me.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(me)
    bnd = sum(1 for e in bm.edges if e.is_boundary)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    comps = len({f for f in bm.faces})  # placeholder, replaced below
    bm.free()
    # components via flood fill on faces
    seen = set()
    ncomp = 0
    # cheap component count using bmesh islands
    bm2 = bmesh.new()
    bm2.from_mesh(me)
    faces = set(bm2.faces)
    while faces:
        ncomp += 1
        stack = [faces.pop()]
        while stack:
            f = stack.pop()
            for e in f.edges:
                for lf in e.link_faces:
                    if lf in faces:
                        faces.discard(lf)
                        stack.append(lf)
    bm2.free()
    log(f"{tag}: tris={len(me.loop_triangles)} verts={len(me.vertices)} "
        f"boundary={bnd} nonmanifold={nonman} components={ncomp}")
    return dict(tris=len(me.loop_triangles), boundary=bnd,
                nonmanifold=nonman, components=ncomp)


def main():
    a = parse()
    inp, out = Path(a.inp).resolve(), Path(a.out).resolve()
    name = a.name or inp.stem
    out.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(inp))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh in " + str(inp))
    # Join into one object.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    high = bpy.context.view_layer.objects.active
    high.name = name + "__HIGH"
    audit(high, "raw")

    if a.drop_floor:
        me = high.data
        zs = [v.co.z for v in me.vertices]
        zmin, zmax = min(zs), max(zs)
        span = max(zmax - zmin, 1e-6)
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        doomed = [f for f in bm.faces
                  if abs(f.normal.z) > 0.9
                  and all(v.co.z < zmin + 0.05 * span for v in f.verts)]
        log(f"dropping floor: {len(doomed)} faces at z~{zmin:.3f}")
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(me)
        bm.free()
        me.update()
        audit(high, "raw-defloored")

    # Normalise: centre on origin (XZ), base at y=0, height = --height.
    bpy.context.view_layer.update()
    dims = high.dimensions
    h = max(dims.z, 1e-6)
    s = a.height / h
    high.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()
    # Move so min Z = 0 and centre X/Y at 0 (Blender Z-up; glTF Y-up on export).
    bb = [high.matrix_world @ __import__("mathutils").Vector(c)
          for c in high.bound_box]
    minx = min(v.x for v in bb)
    maxx = max(v.x for v in bb)
    miny = min(v.y for v in bb)
    maxy = max(v.y for v in bb)
    minz = min(v.z for v in bb)
    high.location.x -= (minx + maxx) / 2
    high.location.y -= (miny + maxy) / 2
    high.location.z -= minz
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bpy.context.view_layer.update()
    log(f"normalised height={a.height}m dims={tuple(round(d, 2) for d in high.dimensions)}")

    # LOW copy: voxel remesh, adaptive voxel size to land near --tris.
    low = high.copy()
    low.data = high.data.copy()
    low.name = name + "_LOW"
    bpy.context.scene.collection.objects.link(low)
    select_only(low)
    # Voxel remesh: start from a size guess, shrink until tris >= target*0.7
    # (remesh first makes the mesh manifold; decimate COLLAPSE then trims).
    voxel = a.height / 60.0
    for _ in range(4):
        # fresh copy each attempt would be cleaner; instead remesh once with
        # a conservative size then decimate to target.
        break
    if not a.no_voxel:
        mod = low.modifiers.new("VoxelRemesh", "REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = voxel
        mod.adaptivity = 0.0
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.context.view_layer.update()
        log(f"after voxel remesh (size={voxel:.4f}): tris={tris_of(low)}")
    # Decimate COLLAPSE to target (voxel mesh is manifold, collapse is safe).
    t = tris_of(low)
    if t > a.tris:
        mod = low.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.002, a.tris / t)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.context.view_layer.update()
    audit(low, "low-remesh")

    # Smart UV Project on LOW (cube projection overlaps opposite faces and
    # tiles the bake; Smart UV gives real islands for the selected-to-active
    # bake). Voxel mesh is manifold enough for this at 12k tris.
    select_only(low)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.04,
                             area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Material + bake targets.
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 4
    sc.cycles.use_denoising = False
    sc.cycles.device = "CPU"
    sc.cycles.bake_type = "DIFFUSE"
    albedo = bpy.data.images.new(name + "_albedo", width=a.res, height=a.res, alpha=False)
    albedo.generated_color = (0.5, 0.5, 0.5, 1.0)
    normal = bpy.data.images.new(name + "_normal", width=a.res, height=a.res, alpha=False)
    normal.colorspace_settings.name = "Non-Color"
    normal.generated_color = (0.5, 0.5, 1.0, 1.0)
    mat = bpy.data.materials.new(name + "_PBR")
    mat.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(mat)
    for p in low.data.polygons:
        p.material_index = 0
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = albedo
    nodes.active = tex
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9

    select_only(low)
    high.hide_render = False
    high.select_set(True)
    bpy.context.view_layer.objects.active = low
    log("baking diffuse...")
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"},
                        use_selected_to_active=True, cage_extrusion=0.02,
                        max_ray_distance=0.0, margin=8, margin_type="EXTEND",
                        use_clear=True)
    tex.image = normal
    nodes.active = tex
    log("baking normal...")
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT",
                        use_selected_to_active=True, cage_extrusion=0.02,
                        max_ray_distance=0.0, margin=8, margin_type="EXTEND",
                        use_clear=True)
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.space = "TANGENT"
    nmap.uv_map = "UVMap"
    links.new(tex.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    # Re-link albedo as base colour (active image is now normal; add a node).
    tex2 = nodes.new("ShaderNodeTexImage")
    tex2.image = albedo
    links.new(tex2.outputs["Color"], bsdf.inputs["Base Color"])

    for img in (albedo, normal):
        img.filepath_raw = str(out.parent / (name + "_" + ("albedo" if img is albedo else "normal") + ".png"))
        img.file_format = "PNG"
        img.save()
        img.pack()

    high.hide_render = True
    high.hide_set(True)
    select_only(low)
    audit(low, "low-final")
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB",
                              use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True,
                              export_tangents=True, export_texcoords=True,
                              export_materials="EXPORT",
                              export_image_format="AUTO",
                              export_animations=False, export_cameras=False,
                              export_lights=False)
    log(f"exported {out} ({out.stat().st_size / 1024:.0f} KB)")
    if not out.is_file() or out.stat().st_size == 0:
        raise RuntimeError("missing output")


main()
