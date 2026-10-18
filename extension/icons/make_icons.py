"""Regenerates the extension icons (monochrome "L" mark). Run: python extension/icons/make_icons.py"""

import pathlib

from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).parent

for size in (16, 32, 48, 128):
    scale = 8  # draw large, downsample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=(10, 10, 10, 255), outline=(82, 82, 91, 255), width=max(scale, s // 40))
    w = int(s * 0.11)
    # "L"
    d.line([(s * 0.31, s * 0.24), (s * 0.31, s * 0.76), (s * 0.70, s * 0.76)], fill=(250, 250, 250, 255), width=w, joint="curve")
    # small "v" (vault) mark
    d.line([(s * 0.52, s * 0.24), (s * 0.61, s * 0.50), (s * 0.70, s * 0.24)], fill=(161, 161, 170, 255), width=int(w * 0.8), joint="curve")
    img.resize((size, size), Image.LANCZOS).save(HERE / f"icon{size}.png")
    print("wrote", f"icon{size}.png")
