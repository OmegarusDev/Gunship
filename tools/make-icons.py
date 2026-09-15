#!/usr/bin/env python3
"""Generate PWA PNG icons (stdlib only)."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'icons'


def png_rgba(w: int, h: int, pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for r, g, b, a in pixels[y]:
            raw.extend((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c0, c1, t):
    return tuple(int(lerp(c0[i], c1[i], t)) for i in range(4))


def paint(size: int) -> list[list[tuple[int, int, int, int]]]:
    bg = (18, 28, 14, 255)
    pad = (32, 48, 22, 255)
    body = (90, 122, 58, 255)
    body_d = (58, 90, 42, 255)
    steel = (138, 138, 122, 255)
    cock = (136, 204, 221, 255)
    rotor = (70, 70, 70, 255)
    tip = (230, 200, 74, 255)
    px = [[bg for _ in range(size)] for _ in range(size)]
    cx = cy = size / 2
    s = size / 512

    def setp(x, y, c):
        if 0 <= x < size and 0 <= y < size:
            px[y][x] = c

    def disc(x0, y0, r, color, edge=None):
        r2 = r * r
        x1, x2 = int(x0 - r - 1), int(x0 + r + 2)
        y1, y2 = int(y0 - r - 1), int(y0 + r + 2)
        for y in range(y1, y2):
            for x in range(x1, x2):
                d = (x + 0.5 - x0) ** 2 + (y + 0.5 - y0) ** 2
                if d <= r2:
                    if edge and d > (r - 1.6) ** 2:
                        setp(x, y, edge)
                    else:
                        setp(x, y, color)

    def rect(x0, y0, w, h, color):
        for y in range(int(y0), int(y0 + h)):
            for x in range(int(x0), int(x0 + w)):
                setp(x, y, color)

    # maskable safe pad
    disc(cx, cy, 230 * s, pad, (22, 34, 16, 255))
    # rotor disc
    disc(cx, cy - 6 * s, 168 * s, (48, 48, 42, 80))
    for i in range(2):
        ang = i * math.pi / 2 + 0.35
        dx, dy = math.cos(ang), math.sin(ang)
        for t in range(int(-160 * s), int(160 * s)):
            x = cx + dx * t
            y = cy - 6 * s + dy * t
            col = tip if abs(t) > 140 * s else rotor
            for k in range(-2, 3):
                setp(int(x + dy * k), int(y - dx * k), col)
    # fuselage
    rect(cx - 22 * s, cy - 70 * s, 44 * s, 168 * s, body)
    rect(cx - 16 * s, cy - 86 * s, 32 * s, 28 * s, body_d)
    disc(cx, cy - 62 * s, 18 * s, cock)
    # tail boom
    rect(cx - 8 * s, cy + 90 * s, 16 * s, 70 * s, steel)
    rect(cx - 28 * s, cy + 148 * s, 56 * s, 12 * s, steel)
    # stub wings / pylons
    rect(cx - 78 * s, cy + 8 * s, 156 * s, 14 * s, body_d)
    rect(cx - 86 * s, cy + 4 * s, 18 * s, 22 * s, steel)
    rect(cx + 68 * s, cy + 4 * s, 18 * s, 22 * s, steel)
    return px


def scale(src, out):
    sh = len(src)
    sw = len(src[0])
    dst = []
    for y in range(out):
        row = []
        sy0 = y * sh / out
        sy1 = (y + 1) * sh / out
        for x in range(out):
            sx0 = x * sw / out
            sx1 = (x + 1) * sw / out
            acc = [0, 0, 0, 0]
            n = 0
            for sy in range(int(sy0), min(sh, int(sy1) + 1)):
                for sx in range(int(sx0), min(sw, int(sx1) + 1)):
                    c = src[sy][sx]
                    for i in range(4):
                        acc[i] += c[i]
                    n += 1
            n = max(1, n)
            row.append(tuple(acc[i] // n for i in range(4)))
        dst.append(row)
    return dst


def main():
    ROOT.mkdir(exist_ok=True)
    src = paint(512)
    (ROOT / 'icon-512.png').write_bytes(png_rgba(512, 512, src))
    (ROOT / 'icon-192.png').write_bytes(png_rgba(192, 192, scale(src, 192)))
    (ROOT / 'apple-touch-icon.png').write_bytes(png_rgba(180, 180, scale(src, 180)))
    print('wrote', ROOT)


if __name__ == '__main__':
    main()
