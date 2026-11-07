"""Generates the NiceTools app icon (monochrome scissors) as PNG + ICO."""
from PIL import Image, ImageDraw

S = 2048
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

margin = int(S * 0.045)
radius = int(S * 0.215)
d.rounded_rectangle([margin, margin, S - margin, S - margin], radius=radius, fill=(0, 0, 0, 255))
# subtle inner edge
d.rounded_rectangle(
    [margin + 5, margin + 5, S - margin - 5, S - margin - 5],
    radius=radius - 4,
    outline=(255, 255, 255, 28),
    width=5,
)

white = (255, 255, 255, 255)
lw = int(S * 0.034)
# scissor rings
r = int(S * 0.096)
cx = int(S * 0.305)
d.ellipse([cx - r, int(S * 0.36) - r, cx + r, int(S * 0.36) + r], outline=white, width=lw)
d.ellipse([cx - r, int(S * 0.64) - r, cx + r, int(S * 0.64) + r], outline=white, width=lw)
# crossing blades: top ring to lower right, bottom ring to upper right
d.line([(int(S * 0.380), int(S * 0.405)), (int(S * 0.755), int(S * 0.715))], fill=white, width=lw)
d.line([(int(S * 0.380), int(S * 0.595)), (int(S * 0.755), int(S * 0.285))], fill=white, width=lw)
# round line caps
for pt in [
    (int(S * 0.380), int(S * 0.405)),
    (int(S * 0.755), int(S * 0.715)),
    (int(S * 0.380), int(S * 0.595)),
    (int(S * 0.755), int(S * 0.285)),
]:
    d.ellipse([pt[0] - lw // 2, pt[1] - lw // 2, pt[0] + lw // 2, pt[1] + lw // 2], fill=white)

img = img.resize((1024, 1024), Image.LANCZOS)
img.save("build/icon.png")
img.resize((256, 256), Image.LANCZOS).save("app/assets/icon.png")
img.save(
    "build/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icons written")
