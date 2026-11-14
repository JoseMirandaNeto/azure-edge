#!/usr/bin/env python3
"""Merge round-3: move the inline mob kit from render.ts into procedural.ts.

- Extracts render.ts lines 189..342 (kit fns, incl. latheGeo + LatheProfile).
- Appends exported equivalents to procedural.ts (latheGeo dropped: latheProfile
  already exists there with identical semantics; internal calls retargeted).
- In render.ts: replaces the kit block with a pointer comment, extends the
  procedural import, and retargets remaining latheGeo( calls to latheProfile(.
Idempotent guard: aborts if render.ts no longer contains 'function latheGeo('.
"""
import re
import sys

RENDER = "/home/hatch/workspace/azure-edge/apps/client/src/render.ts"
PROC = "/home/hatch/workspace/azure-edge/apps/client/src/procedural.ts"

render = open(RENDER, encoding="utf-8").read()
if "function latheGeo(" not in render:
    print("ABORT: kit already moved (no 'function latheGeo(' in render.ts)")
    sys.exit(1)

lines = render.split("\n")  # 0-based; file lines 188..342 -> idx 187..341
kit = lines[187:341]
assert kit[0].startswith("/** One lathe profile point"), kit[0]
assert kit[-1] == "}", kit[-1]
kit_src = "\n".join(kit)

# --- Build the procedural.ts version -------------------------------------
moved = kit_src
# Drop the LatheProfile alias + latheGeo (latheProfile/LathePoint exist).
moved = re.sub(
    r"/\*\* One lathe profile point[^\n]*\ntype LatheProfile = Array<\[number, number\]>;\n\n"
    r"/\*\* Lathe from an anatomical profile \(revolves around \+Y\)\. \*/\n"
    r"function latheGeo\(profile: LatheProfile, segments = 20\): THREE\.BufferGeometry \{\n"
    r"  const pts = profile\.map\(\(\[r, y\]\) => new THREE\.Vector2\(Math\.max\(0, r\), y\)\);\n"
    r"  return new THREE\.LatheGeometry\(pts, segments\);\n"
    r"\}\n\n",
    "",
    moved,
    count=1,
)
assert "function latheGeo(" not in moved
moved = moved.replace("LatheProfile", "LathePoint")
moved = moved.replace("latheGeo(", "latheProfile(")
# Export every top-level function in the moved block.
moved = re.sub(r"^function ", "export function ", moved, flags=re.M)

header = """
// ---------------------------------------------------------------------------
// Kit orgânico dos mobs (fonte única — migrado de render.ts no merge da
// rodada 3). Os construtores de mobs (makeScorpion, makeSerket, makeGolem,
// ...) importam daqui; nada de kit duplicado em render.ts. As geometrias
// são as MESMAS de antes (código movido, não reescrito) para não mudar a
// aparência já verificada. latheGeo virou latheProfile (idêntico, com o
// clamp de raio >= 0 mantido nos perfis que o usavam).
// ---------------------------------------------------------------------------

"""
proc = open(PROC, encoding="utf-8").read()
if "Kit orgânico dos mobs (fonte única" in proc:
    print("NOTE: procedural.ts already has the mob kit (previous partial run) — skipping append")
else:
    proc = proc.rstrip("\n") + "\n" + header + moved + "\n"
    open(PROC, "w", encoding="utf-8").write(proc)

# --- Rewrite render.ts -----------------------------------------------------
pointer = """// ---------------------------------------------------------------------------
// Zero Primitivas (Regra Anti-Blocos, permanente): nenhum mob usa primitiva
// nua visível (Box/Cylinder/Cone/Sphere/Capsule/Torus). Corpos são
// LatheGeometry de perfis anatômicos subdivididos; membros, mandíbulas e
// chifres são extrusões chanfradas ou lathes afilados; o rim light vem de
// um termo Fresnel injetado no material (WebGL2) + um shell invertido
// (BackSide) que carrega o rim sob o WebGPURenderer. Os anéis planos no
// chão (mobRing/eliteRing) são indicadores de gameplay, não partes do
// modelo, e ficam. O kit orgânico dos mobs (eggGeo, limbGeo, bladeGeo,
// applyFresnelRim, rimShellOf, ...) vive em ./procedural.ts (fonte única);
// o helper local de torno agora é latheProfile, importado de lá.
// ---------------------------------------------------------------------------
"""
# lines 176..342 (idx 175..341): comment block + kit + trailing blank line.
assert lines[175].startswith("// ---"), lines[175]
assert lines[341] == "", repr(lines[341])
assert lines[342].startswith("/**"), lines[342]
new_lines = lines[:175] + pointer.rstrip("\n").split("\n") + [""] + lines[342:]
render2 = "\n".join(new_lines)

# Extend the procedural import with the moved kit functions.
old_import_tail = "  organicRockGeo,\n"
assert old_import_tail in render2
new_import = (
    "  organicRockGeo,\n"
    "  applyFresnelRim,\n"
    "  bandGeo,\n"
    "  bladeGeo,\n"
    "  domeGeo,\n"
    "  eggGeo,\n"
    "  limbGeo,\n"
    "  rboxGeo,\n"
    "  rimShellOf,\n"
    "  spikeGeo,\n"
)
render2 = render2.replace(old_import_tail, new_import, 1)
assert "function latheGeo(" not in render2
n_calls = render2.count("latheGeo(")
render2 = render2.replace("latheGeo(", "latheProfile(")
assert "latheGeo(" not in render2, "leftover latheGeo( call"
assert "LatheProfile" not in render2, "leftover LatheProfile reference"
open(RENDER, "w", encoding="utf-8").write(render2)
print(f"OK: moved kit to procedural.ts; retargeted {n_calls} latheGeo( calls in render.ts")
