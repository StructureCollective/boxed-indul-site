"""Generate warm black/gold placeholder tiles for the Instagram-style grid,
since real Instagram photos require the client's own API credentials. Each
tile is clearly labeled so it's obvious to swap out. The hero background and
about-section photo use the client's real supplied product photography
instead of a generated placeholder (see public/img/hero-bg.jpg / chef.png).
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "img")
os.makedirs(OUT, exist_ok=True)

INK = (20, 17, 10)
GOLD = (192, 136, 48)
GOLD_DARK = (139, 94, 30)
CREAM = (245, 239, 224)
CHAMPAGNE = (232, 213, 168)
MAROON = (92, 31, 31)

PALETTES = [
    [(24, 20, 12), (139, 94, 30), (192, 136, 48)],
    [(18, 15, 10), (92, 31, 31), (192, 136, 48)],
    [(22, 18, 11), (192, 136, 48), (232, 213, 168)],
    [(26, 21, 13), (139, 94, 30), (232, 213, 168)],
    [(16, 13, 9), (92, 31, 31), (139, 94, 30)],
    [(20, 16, 10), (192, 136, 48), (139, 94, 30)],
]

LABELS = [
    "SIGNATURE BOX",
    "CHARCUTERIE SET",
    "CORPORATE GIFTING",
    "WEDDING FAVORS",
    "HOLIDAY BOXES",
    "CLIENT GIFTS",
]

def find_font(bold=True, size=40):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()

def diagonal_gradient(size, c1, c2):
    w, h = size
    base = Image.new("RGB", (w, h), c1)
    top = Image.new("RGB", (w, h), c2)
    import numpy as np
    xs, ys = np.meshgrid(np.linspace(0, 1, w), np.linspace(0, 1, h))
    grad = ((xs + ys) / 2 * 255).astype("uint8")
    mask = Image.fromarray(grad, mode="L")
    return Image.composite(top, base, mask)

def make_tile(size, palette, label, seed):
    random.seed(seed)
    c1, c2, c3 = palette
    im = diagonal_gradient((size, size), c1, c2)
    draw = ImageDraw.Draw(im, "RGBA")

    for _ in range(14):
        r = random.randint(int(size * 0.08), int(size * 0.28))
        x = random.randint(0, size)
        y = random.randint(0, size)
        alpha = random.randint(10, 28)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(*c3, alpha))
    im = im.filter(ImageFilter.GaussianBlur(radius=size * 0.01))
    draw = ImageDraw.Draw(im, "RGBA")

    import numpy as np
    arr = np.array(im).astype("int16")
    noise = np.random.randint(-8, 8, arr.shape[:2] + (1,))
    arr = np.clip(arr + noise, 0, 255).astype("uint8")
    im = Image.fromarray(arr, "RGB")
    draw = ImageDraw.Draw(im, "RGBA")

    vignette = Image.new("L", (size, size), 0)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse([-size * 0.2, -size * 0.2, size * 1.2, size * 1.2], fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(size * 0.15))
    dark = Image.new("RGB", (size, size), (0, 0, 0))
    im = Image.composite(im, dark, vignette)
    draw = ImageDraw.Draw(im, "RGBA")

    plate_h = int(size * 0.22)
    draw.rectangle([0, size - plate_h, size, size], fill=(20, 17, 10, 190))

    font_size = int(size * 0.075)
    font = find_font(size=font_size)
    small_font = find_font(size=int(size * 0.04))
    label_text = label
    tw = draw.textlength(label_text, font=font)
    # Shrink to fit if a longer label would overflow the tile.
    max_w = size * 0.92
    while tw > max_w and font_size > 14:
        font_size -= 2
        font = find_font(size=font_size)
        tw = draw.textlength(label_text, font=font)
    draw.text(
        ((size - tw) / 2, size - plate_h + plate_h * 0.18),
        label_text,
        font=font,
        fill=CREAM,
    )
    tag = "PLACEHOLDER — REPLACE WITH REAL PHOTO"
    small_size = int(size * 0.04)
    tw2 = draw.textlength(tag, font=small_font)
    while tw2 > max_w and small_size > 10:
        small_size -= 1
        small_font = find_font(size=small_size)
        tw2 = draw.textlength(tag, font=small_font)
    draw.text(
        ((size - tw2) / 2, size - plate_h + plate_h * 0.60),
        tag,
        font=small_font,
        fill=(*GOLD,),
    )
    return im

SIZE = 640
for i, (palette, label) in enumerate(zip(PALETTES, LABELS)):
    tile = make_tile(SIZE, palette, label, seed=i)
    tile.save(os.path.join(OUT, f"insta-{i+1}.jpg"), quality=87)

# Menu/section texture (subtle, for background panels) — black/gold smoke
def make_bg(w, h, seed=99):
    random.seed(seed)
    im = diagonal_gradient((w, h), (14, 11, 8), (46, 32, 14))
    draw = ImageDraw.Draw(im, "RGBA")
    for _ in range(28):
        r = random.randint(int(h * 0.15), int(h * 0.5))
        x = random.randint(0, w)
        y = random.randint(0, h)
        alpha = random.randint(8, 22)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(192, 136, 48, alpha))
    im = im.filter(ImageFilter.GaussianBlur(radius=h * 0.01))
    vignette = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse([-w * 0.15, -h * 0.4, w * 1.15, h * 1.4], fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(h * 0.2))
    dark = Image.new("RGB", (w, h), (8, 6, 4))
    im = Image.composite(im, dark, vignette)
    return im

menu_bg = make_bg(1600, 900, seed=7)
menu_bg = menu_bg.filter(ImageFilter.GaussianBlur(6))
menu_bg.save(os.path.join(OUT, "menu-bg.jpg"), quality=85)

print("done:", os.listdir(OUT))
