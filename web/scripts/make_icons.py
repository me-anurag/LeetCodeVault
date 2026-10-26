"""Builds every icon from web/scripts/logo-source.png: the site logo, the installable-app icons in
web/public/icons, and the extension icons. Run: python web/scripts/make_icons.py"""

import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
ICONS = PUBLIC / "icons"
EXTENSION_ICONS = HERE.parents[1] / "extension" / "icons"
ICONS.mkdir(exist_ok=True)

source = Image.open(HERE / "logo-source.png").convert("RGB")
BLACK = source.getpixel((source.width // 2, int(source.height * 0.93)))  # the logo's own background black

# The logo is a black squircle on a white canvas. Flood-fill the white from the corners to find the
# outside, grow it a little to swallow the anti-aliased edge, and use the rest as the icon shape.
marker = (255, 0, 255)
probe = source.copy()
w, h = probe.size
for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
    ImageDraw.floodfill(probe, corner, marker, thresh=140)
outside = ImageChops.difference(probe, Image.new("RGB", probe.size, marker)).convert("L").point(lambda v: 255 if v < 8 else 0)
outside = outside.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(1.5))
shape = ImageChops.invert(outside)

rounded = source.convert("RGBA")
rounded.putalpha(shape)  # transparent outside the squircle
full_bleed = Image.composite(source, Image.new("RGB", source.size, BLACK), shape)  # corners filled black


def save(img, size, path):
    img.resize((size, size), Image.LANCZOS).save(path)
    print("wrote", path.relative_to(HERE.parents[1]))


def padded(scale):
    """The full-bleed logo shrunk to `scale` and centred on black, for icons the OS crops (maskable, iOS)."""
    canvas = Image.new("RGB", source.size, BLACK)
    inner = round(source.size[0] * scale)
    offset = (source.size[0] - inner) // 2
    canvas.paste(full_bleed.resize((inner, inner), Image.LANCZOS), (offset, offset))
    return canvas


save(rounded, 128, PUBLIC / "logo.png")  # favicon + small header logo
save(rounded, 192, ICONS / "icon-192.png")
save(rounded, 512, ICONS / "icon-512.png")
save(padded(0.8), 512, ICONS / "maskable-512.png")  # Android crops to a circle: keep the swords inside
save(padded(0.92), 180, ICONS / "apple-touch-icon.png")  # iOS rounds the corners itself
for size in (16, 32, 48, 128):
    save(rounded, size, EXTENSION_ICONS / f"icon{size}.png")
