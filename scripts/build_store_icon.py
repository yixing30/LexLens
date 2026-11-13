"""Render the existing LexLens mark as a padded Chrome Web Store icon."""

import math
import struct
import zlib

from package_extension import ROOT, color_at, png_chunk


SIZE = 128
ART_SIZE = 96
OFFSET = (SIZE - ART_SIZE) / 2
SAMPLES = (0.125, 0.375, 0.625, 0.875)
OUTPUT = ROOT / "store-assets" / "LexLens-store-icon-128.png"


def rounded_rect_distance(x: float, y: float) -> float:
    left, top, right, bottom, radius = 0.03, 0.03, 0.97, 0.97, 0.19
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return math.hypot(x - cx, y - cy) - radius


def sample(x: float, y: float) -> tuple[int, int, int, int]:
    x = (x - OFFSET) / ART_SIZE
    y = (y - OFFSET) / ART_SIZE
    if not (-0.04 <= x <= 1.04 and -0.04 <= y <= 1.04):
        return (0, 0, 0, 0)
    color = color_at(x, y)
    if color[3]:
        return color
    distance = rounded_rect_distance(x, y)
    if 0 < distance < 0.027:
        alpha = round(135 * (1 - distance / 0.027) ** 2)
        return (250, 248, 238, alpha)
    return (0, 0, 0, 0)


def main() -> None:
    rows = bytearray()
    for y in range(SIZE):
        rows.append(0)
        for x in range(SIZE):
            colors = [sample(x + dx, y + dy) for dy in SAMPLES for dx in SAMPLES]
            alpha_sum = sum(color[3] for color in colors)
            if alpha_sum:
                rgb = [round(sum(color[channel] * color[3] for color in colors) / alpha_sum) for channel in range(3)]
                rows.extend((*rgb, round(alpha_sum / len(colors))))
            else:
                rows.extend((0, 0, 0, 0))
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + png_chunk(b"IEND", b"")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(png)
    print(f"Store icon: {OUTPUT}")


if __name__ == "__main__":
    main()
