#!/usr/bin/env python3
"""
Measures the glyph's INKED box under the canonical isometric camera, and
checks it against public/glyph-alxmtnc.svg.

Why this exists
---------------
Scene.js has to size and place the logo so that "46 % of the viewport height"
means 46 % of the LOGO — the thing a visitor sees. That is not the bounding box
of the solid. On a white page the horizontal faces (the treads) are white too,
so they disappear into the paper: what reads as the logo is only the cobalt
vertical faces, exactly as in the 2D SVG, where no tread is ever inked.

The two boxes are not close. The silhouette of the solid measures 4.586 x 4.678
(ratio 0.980); the inked area measures 4.581 x 4.268 (ratio 1.073). Sizing on
the silhouette would draw the logo ~9 % short and off-centre. And the ratio is
also the proof that the camera is right: the SVG is 559 x 521, ratio 1.07294.

The numbers this prints are pasted into GLYPH_INK in src/scenes/Scene.js.
Re-run it if the .glb is ever rebuilt. Pure stdlib — no Blender, no numpy.

    python3 tools/measure-glyph-ink.py [--res 900]
"""

import argparse
import json
import math
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLB = ROOT / "public" / "models" / "glyph-alxmtnc-3d-v2.glb"
SVG = ROOT / "public" / "glyph-alxmtnc.svg"

# The canonical view: orthographic, on the (1, 1, 1) axis, default up.
# brand/3d/README.md, "Vue canonique".
EYE = (1.0, 1.0, 1.0)

COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


# ------------------------------------------------------------------- glb


def load_glb(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF", f"{path} is not a binary glTF"
    offset, chunks = 12, []
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks.append((kind, data[offset:offset + length]))
        offset += length
    return json.loads(chunks[0][1].decode("utf-8")), chunks[1][1]


def read_accessor(gltf, blob, index):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    stride = view.get("byteStride") or size * n
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return [struct.unpack_from("<" + fmt * n, blob, base + i * stride)
            for i in range(acc["count"])]


# --------------------------------------------------------------- vectors


def normalize(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def camera_basis(eye):
    """three.js lookAt(origin) with up (0,1,0), as an (right, up, back) triple."""
    back = normalize(eye)
    right = normalize(cross((0.0, 1.0, 0.0), back))
    return right, cross(back, right), back


# ----------------------------------------------------------------- paths


def parse_path(d):
    tokens = re.findall(r"[MLVHZmlvhz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    points, current, command, i = [], (0.0, 0.0), None, 0
    while i < len(tokens):
        if tokens[i] in "MLVHZmlvhz":
            command = tokens[i]
            i += 1
            if command in "Zz":
                continue
        if command in ("M", "L"):
            current = (float(tokens[i]), float(tokens[i + 1]))
            i += 2
        elif command == "V":
            current = (current[0], float(tokens[i]))
            i += 1
        elif command == "H":
            current = (float(tokens[i]), current[1])
            i += 1
        else:
            raise ValueError(f"unsupported path command {command!r}")
        points.append(current)
    return points


def raster_polygons(polys, res, flip_y):
    xs = [p[0] for poly in polys for p in poly]
    ys = [p[1] for poly in polys for p in poly]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = x1 - x0, y1 - y0
    width, height = int(round(res * w / h)), res
    grid = bytearray(width * height)

    for poly in polys:
        mapped = []
        for px, py in poly:
            u = (px - x0) / w * (width - 1)
            v = (py - y0) / h * (height - 1)
            mapped.append((u, (height - 1) - v if flip_y else v))
        n = len(mapped)
        for row in range(height):
            centre = row + 0.5
            crossings = []
            for k in range(n):
                (ax, ay), (bx, by) = mapped[k], mapped[(k + 1) % n]
                if (ay <= centre < by) or (by <= centre < ay):
                    crossings.append(ax + (centre - ay) * (bx - ax) / (by - ay))
            crossings.sort()
            for k in range(0, len(crossings) - 1, 2):
                a = max(0, int(math.ceil(crossings[k] - 0.5)))
                b = min(width - 1, int(math.floor(crossings[k + 1] - 0.5)))
                for col in range(a, b + 1):
                    grid[row * width + col] = 1
    return grid, width, height


# --------------------------------------------------------------- render


def render_ink(positions, normals, tris, eye, res):
    """
    Z-buffered render. Returns the mask of pixels whose front-most face is a
    riser, plus the mapping back to world units.

    A tread is a face whose OBJECT-space normal runs along Y: in glTF space the
    profile lies in XY and the extrusion runs along Z, so Y is the up of the
    solid. Same 0.5 cutoff as GlyphMaterial.js, on purpose — this measures the
    picture the shader actually draws, not an idealisation of it.
    """
    right, up, back = camera_basis(eye)
    projected = [(dot(p, right), dot(p, up), dot(p, back)) for p in positions]

    us = [p[0] for p in projected]
    vs = [p[1] for p in projected]
    x0, x1, y0, y1 = min(us), max(us), min(vs), max(vs)
    w, h = x1 - x0, y1 - y0
    width, height = int(round(res * w / h)), res

    depth = [-1e30] * (width * height)
    ink = bytearray(width * height)

    for a, b, c in tris:
        tread = sum(abs(normals[i][1]) for i in (a, b, c)) / 3.0 > 0.5
        tri = []
        for i in (a, b, c):
            u, v, d = projected[i]
            tri.append(((u - x0) / w * (width - 1),
                        (height - 1) - (v - y0) / h * (height - 1), d))
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        for py in range(max(0, int(min(ay, by, cy))),
                        min(height - 1, int(max(ay, by, cy)) + 1) + 1):
            for px in range(max(0, int(min(ax, bx, cx))),
                            min(width - 1, int(max(ax, bx, cx)) + 1) + 1):
                fx, fy = px + 0.5, py + 0.5
                l1 = ((by - cy) * (fx - cx) + (cx - bx) * (fy - cy)) / den
                l2 = ((cy - ay) * (fx - cx) + (ax - cx) * (fy - cy)) / den
                l3 = 1.0 - l1 - l2
                if l1 < -1e-9 or l2 < -1e-9 or l3 < -1e-9:
                    continue
                z = l1 * az + l2 * bz + l3 * cz
                k = py * width + px
                if z > depth[k]:
                    depth[k] = z
                    ink[k] = 0 if tread else 1

    return ink, width, height, (x0, x1, y0, y1)


def bounds(mask, width, height):
    xs = [x for y in range(height) for x in range(width) if mask[y * width + x]]
    ys = [y for y in range(height) for x in range(width) if mask[y * width + x]]
    return min(xs), max(xs), min(ys), max(ys)


def crop(mask, width, height):
    x0, x1, y0, y1 = bounds(mask, width, height)
    w, h = x1 - x0 + 1, y1 - y0 + 1
    out = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            out[y * w + x] = mask[(y + y0) * width + (x + x0)]
    return out, w, h


def iou(a, aw, ah, b, bw, bh, res):
    """Both masks are resampled onto one grid of height `res`, cropped to ink."""
    height = res
    wa, wb = int(round(res * aw / ah)), int(round(res * bw / bh))
    width = max(wa, wb)
    inter = union = 0
    for y in range(height):
        ay, by = int(y * ah / height), int(y * bh / height)
        for x in range(width):
            ax, bx = int(x * aw / wa), int(x * bw / wb)
            pa = a[ay * aw + ax] if ax < aw and x < wa else 0
            pb = b[by * bw + bx] if bx < bw and x < wb else 0
            if pa and pb:
                inter += 1
            if pa or pb:
                union += 1
    return inter / union * 100


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--res", type=int, default=900,
                        help="raster height in px (default 900)")
    args = parser.parse_args()

    gltf, blob = load_glb(GLB)
    prim = gltf["meshes"][0]["primitives"][0]
    positions = read_accessor(gltf, blob, prim["attributes"]["POSITION"])
    normals = read_accessor(gltf, blob, prim["attributes"]["NORMAL"])
    flat = [t[0] for t in read_accessor(gltf, blob, prim["indices"])]
    tris = [(flat[i], flat[i + 1], flat[i + 2]) for i in range(0, len(flat), 3)]

    ink, width, height, (x0, x1, y0, y1) = render_ink(
        positions, normals, tris, EYE, args.res)

    # Pixel bounds back into world units.
    w, h = x1 - x0, y1 - y0
    px0, px1, py0, py1 = bounds(ink, width, height)
    u0 = x0 + (px0 + 0.0) / width * w
    u1 = x0 + (px1 + 1.0) / width * w
    v1 = y1 - (py0 + 0.0) / height * h
    v0 = y1 - (py1 + 1.0) / height * h

    ink_w, ink_h = u1 - u0, v1 - v0
    print(f"glb          {GLB.relative_to(ROOT)}")
    print(f"camera       orthographic, eye {EYE}, target origin, up (0, 1, 0)")
    print(f"triangles    {len(tris)}   vertices {len(positions)}")
    print()
    print(f"silhouette   w {w:.5f}  h {h:.5f}  ratio {w / h:.5f}")
    print(f"INK          w {ink_w:.5f}  h {ink_h:.5f}  ratio {ink_w / ink_h:.5f}")
    print(f"ink centre   x {(u0 + u1) / 2:+.5f}  y {(v0 + v1) / 2:+.5f}"
          "   (camera space, mesh at scale 1)")
    print()

    svg = SVG.read_text()
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
    # paths[0] is the 0.3-opacity triangle: the visible part of the notch's
    # inner wall, which is inked cobalt too. paths[1] is the body.
    polys = [parse_path(d) for d in paths[:2]]
    svg_grid, sw, sh = raster_polygons(polys, args.res, flip_y=False)

    svg_ink, svg_w, svg_h = crop(svg_grid, sw, sh)
    mesh_ink, mesh_w, mesh_h = crop(ink, width, height)

    svg_ratio = svg_w / svg_h
    mesh_ratio = mesh_w / mesh_h
    print(f"SVG ink      {svg_w} x {svg_h} px   ratio {svg_ratio:.5f}")
    print(f"mesh ink     {mesh_w} x {mesh_h} px   ratio {mesh_ratio:.5f}")
    print(f"ratio delta  {(mesh_ratio - svg_ratio) / svg_ratio * 100:+.3f} %")
    print(f"pixel IoU    {iou(svg_ink, svg_w, svg_h, mesh_ink, mesh_w, mesh_h, args.res):.3f} %")
    print()
    print("paste into src/scenes/Scene.js:")
    print("const GLYPH_INK = {")
    print(f"\twidth: {ink_w:.5f},")
    print(f"\theight: {ink_h:.5f},")
    print(f"\tcenterX: {(u0 + u1) / 2:.5f},")
    print(f"\tcenterY: {(v0 + v1) / 2:.5f},")
    print("};")


if __name__ == "__main__":
    main()
