"""Turn the raw browser captures into landing-page assets.

    python3 scripts/prepare_shots.py <artifact-dir>

Input:  1280x800 PNGs of the Runmesh app, captured from the preview browser.
Output: frontend/public/shots/*.webp

The app shell's left sidebar is 210px in a 1280-wide capture. The hero keeps
the full frame (the nav is part of the story), trimmed to the last complete
table row; the feature sections use the content area only, trimmed to their
last row of content so the card has no dead space below it.
"""

import os
import sys

from PIL import Image

SIDEBAR = 210
# The hero's audit table has a row divider at y=747; cut just below it so no
# row is sliced in half.
HERO_HEIGHT = 776
SRC = sys.argv[1] if len(sys.argv) > 1 else "/Users/apple/.t3/userdata/browser-artifacts"
DST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend",
    "public",
    "shots",
)

# capture file stem -> output name
CAPTURES = {
    "browser-screenshot-localhost-mvfanvj7-c65dfb88": "control-room",
    "browser-screenshot-localhost-mvfana0s-093d2d8e": "grants",
    "browser-screenshot-localhost-mvfanci3-9b3cad9b": "audit",
    "browser-screenshot-localhost-mvfaneze-a95420ba": "policies",
    "browser-screenshot-localhost-mvfanhg9-0b626319": "agents",
    "browser-screenshot-localhost-mvfanjxq-92f9d8d1": "connect",
}

# The app background is #0a0a0b; anything brighter is content.
BACKGROUND = (10, 10, 11)
TOLERANCE = 14


def content_bottom(img: Image.Image) -> int:
    """Last row (from the bottom) that holds a non-background pixel."""
    px = img.load()
    w, h = img.size
    for y in range(h - 1, -1, -1):
        for x in range(0, w, 3):
            r, g, b = px[x, y]
            if (
                abs(r - BACKGROUND[0]) > TOLERANCE
                or abs(g - BACKGROUND[1]) > TOLERANCE
                or abs(b - BACKGROUND[2]) > TOLERANCE
            ):
                return y
    return h


def save(img: Image.Image, name: str) -> None:
    out = os.path.join(DST, f"{name}.webp")
    img.save(out, "WEBP", quality=88, method=6)
    print(f"{name}.webp  {img.size[0]}x{img.size[1]}  {os.path.getsize(out) // 1024}KB")


def main() -> None:
    os.makedirs(DST, exist_ok=True)
    for stem, name in CAPTURES.items():
        src = os.path.join(SRC, f"{stem}.png")
        if not os.path.exists(src):
            print(f"skip (missing): {stem}")
            continue
        img = Image.open(src).convert("RGB")
        if name == "control-room":
            save(img.crop((0, 0, img.width, HERO_HEIGHT)), name)
            continue
        # Content crop: drop the app sidebar, keep the content area.
        content = img.crop((SIDEBAR, 40, img.width, img.height))
        bottom = content_bottom(content)
        # 24px of breathing room under the last row.
        content = content.crop((0, 0, content.width, min(content.height, bottom + 24)))
        save(content, name)


if __name__ == "__main__":
    main()
