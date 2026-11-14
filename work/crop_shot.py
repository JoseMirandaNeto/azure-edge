#!/usr/bin/env python3
"""Crop the center-top region of a 1280x720 verify screenshot (where the
player/mob usually is) and upscale 2x, for legibility checks."""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
# x0,y0,x1,y1 in the 1280x720 frame; default: center band where mobs stand.
box = tuple(int(v) for v in (sys.argv[3].split(",") if len(sys.argv) > 3 else "340,40,940,520"))
im = Image.open(src)
crop = im.crop(box)
crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
crop.save(dst)
print(dst, crop.size)
