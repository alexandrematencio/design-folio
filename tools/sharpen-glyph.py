#!/usr/bin/env python3
"""
Takes the bevel off the glyph: glyph-alxmtnc-3d-v2.glb -> -v3.glb.

The v2 solid was exported from Blender with a 0.012 bevel in two segments on
every edge (normals at 22.5 and 45 degrees). Small as it is, under a softbox
those two facets catch a graded highlight along every edge, and the stair
reads as a rounded, moulded object instead of a cut one. The mark is drawn
with knife edges, so the 3D gets them too.

Every true corner of the stair sits on a 0.25 grid (x in integers, y on the
half-units, z at +-1.25), and every bevel vertex sits within 0.012 of one. So
the bevel is removed by snapping each vertex to that grid: the bevel faces
collapse to zero area and are dropped, the flat faces grow back to their full
size with their normals untouched. Vertices nothing uses any more are dropped
and the index buffer is rebuilt. Nothing is re-triangulated.

    python3 tools/sharpen-glyph.py

Then re-bake the light, which asserts the vertex count:

    python3 tools/bake-glyph-light.py

It also writes a second UV set, TEXCOORD_1: a lightmap atlas, one island per
connected plane of the solid, no overlap, for tools/bake-glyph-studio.py. It
only adds an attribute; the vertex order the light bake is keyed on is the
same as without it.

Pure stdlib.
"""

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "models" / "glyph-alxmtnc-3d-v2.glb"
DST = ROOT / "public" / "models" / "glyph-alxmtnc-3d-v3.glb"
GRID = 0.25
BEVEL = 0.02  # anything further than this from the grid is not a bevel
# Midpoint subdivision of every flat face. Not for the shape — the faces stay
# planar and the edges stay knives — but for the light bake, which is PER
# VERTEX: a 4 x 2.5 face carried by two triangles interpolates its sky
# visibility along one diagonal and prints that diagonal into the shading.
LEVELS = 2
# The lightmap atlas: its size in texels and the gutter between islands, which
# the bake fills by dilation so that bilinear filtering never reads a
# neighbour's light across a seam.
ATLAS = 1024
GUTTER = 8


def load(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF"
    offset, chunks = 12, []
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks.append(data[offset:offset + length])
        offset += length
    return json.loads(chunks[0].decode("utf-8")), chunks[1]


def read(gltf, blob, index, fmt, n):
    acc = gltf["accessors"][index]
    view = gltf["bufferViews"][acc["bufferView"]]
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    size = struct.calcsize("<" + fmt)
    return [struct.unpack_from("<" + fmt * n, blob, base + i * size * n)
            for i in range(acc["count"])]


def snap(x):
    s = round(x / GRID) * GRID
    assert abs(s - x) <= BEVEL, f"{x} is not within a bevel of the grid"
    return s


def area2(a, b, c):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    cx = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    return sum(k * k for k in cx) ** 0.5


def plane_axes(n):
    """The two in-plane axes of an axis-aligned face, as coordinate indices."""
    a = max(range(3), key=lambda k: abs(n[k]))
    return a, {0: (2, 1), 1: (0, 2), 2: (0, 1)}[a]


def atlas(order, pos, nor, tris):
    """
    Lightmap UVs: every connected plane is one island, flattened along its
    own axis at a single texel density, shelf-packed into ATLAS x ATLAS.
    Coplanar polygons that touch become ONE island, so a face that Blender
    exported as several polygons is baked in one piece and has no seam.
    """
    parent = {i: i for i in order}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def plane(i):
        a, _ = plane_axes(nor[i])
        return (a, round(nor[i][a]), round(pos[i][a] * 4))

    for t in tris:
        for i in t[1:]:
            parent[find(i)] = find(t[0])
    seen = {}
    for i in order:
        k = (plane(i), pos[i])
        if k in seen:
            parent[find(i)] = find(seen[k])
        else:
            seen[k] = i

    islands = {}
    for i in order:
        islands.setdefault(find(i), []).append(i)
    boxes = []
    for root, members in islands.items():
        _, (u, v) = plane_axes(nor[root])
        us = [pos[i][u] for i in members]
        vs = [pos[i][v] for i in members]
        boxes.append((root, min(us), min(vs), max(us) - min(us), max(vs) - min(vs), u, v))
    boxes.sort(key=lambda b: (-b[4], -b[3]))

    def pack(scale):
        x = y = shelf = GUTTER
        placed = {}
        for root, u0, v0, w, h, *_ in boxes:
            W, H = w * scale, h * scale
            if x + W + GUTTER > ATLAS:
                x, y, shelf = GUTTER, shelf, shelf
            if y + H + GUTTER > ATLAS:
                return None
            placed[root] = (x, y)
            x += W + GUTTER
            shelf = max(shelf, y + H + GUTTER)
        return placed

    lo, hi = 1.0, ATLAS
    for _ in range(40):
        mid_ = (lo + hi) / 2
        lo, hi = (mid_, hi) if pack(mid_) else (lo, mid_)
    scale = lo
    placed = pack(scale)
    uv1 = {}
    for root, u0, v0, w, h, u, v in boxes:
        ox, oy = placed[root]
        for i in islands[root]:
            uv1[i] = ((ox + (pos[i][u] - u0) * scale) / ATLAS,
                      (oy + (pos[i][v] - v0) * scale) / ATLAS)
    print(f"atlas: {len(boxes)} islands, {scale:.1f} texels per unit")
    return uv1


def main():
    gltf, blob = load(SRC)
    prim = gltf["meshes"][0]["primitives"][0]
    attrs = prim["attributes"]
    pos = [tuple(snap(c) for c in p) for p in read(gltf, blob, attrs["POSITION"], "f", 3)]
    nor = read(gltf, blob, attrs["NORMAL"], "f", 3)
    uv = read(gltf, blob, attrs["TEXCOORD_0"], "f", 2)
    idx = [i[0] for i in read(gltf, blob, prim["indices"], "H", 1)]

    tris = [idx[k:k + 3] for k in range(0, len(idx), 3)]
    kept = [t for t in tris if area2(*(pos[i] for i in t)) > 1e-9]

    # Subdivide. The source is split per polygon (that is how Blender
    # exports flat shading), so the triangles that share a vertex index form
    # one polygon of the model. New vertices are keyed on (position, polygon):
    # a polygon shares its interior vertices, and two coplanar polygons never
    # share one. That matters — the bake's well selector is per polygon, and
    # a vertex shared between the wedge and its neighbour on the same plane
    # smears the wedge across both.
    parent = list(range(len(pos)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in kept:
        parent[find(b)] = find(a)
        parent[find(c)] = find(a)
    poly = {}
    pos, nor, uv = list(pos), list(nor), list(uv)
    for i in range(len(pos)):
        poly[i] = find(i)
    key = {}

    def mid(a, b):
        p = tuple((pos[a][k] + pos[b][k]) / 2 for k in range(3))
        k = (p, poly[a])
        if k not in key:
            key[k] = len(pos)
            poly[len(pos)] = poly[a]
            pos.append(p)
            nor.append(nor[a])
            uv.append(tuple((uv[a][k] + uv[b][k]) / 2 for k in range(2)))
        return key[k]

    for _ in range(LEVELS):
        nxt = []
        for a, b, c in kept:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nxt += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
        kept = nxt

    remap, order = {}, []
    for t in kept:
        for i in t:
            if i not in remap:
                remap[i] = len(order)
                order.append(i)
    new_idx = [remap[i] for t in kept for i in t]
    assert len(order) < 65536
    uv1 = atlas(order, pos, nor, kept)

    P = b"".join(struct.pack("<3f", *pos[i]) for i in order)
    N = b"".join(struct.pack("<3f", *nor[i]) for i in order)
    T = b"".join(struct.pack("<2f", *uv[i]) for i in order)
    I = b"".join(struct.pack("<H", i) for i in new_idx)
    L = b"".join(struct.pack("<2f", *uv1[i]) for i in order)
    pad = lambda b: b + b"\0" * (-len(b) % 4)
    chunks = [pad(P), pad(N), pad(T), pad(I), pad(L)]

    views, o = [], 0
    for k, c in enumerate(chunks):
        raw = [len(P), len(N), len(T), len(I), len(L)][k]
        views.append({"buffer": 0, "byteOffset": o, "byteLength": raw,
                      "target": 34963 if k == 3 else 34962})
        o += len(c)
    body = b"".join(chunks)

    xs = [p for i in order for p in [pos[i]]]
    gltf["bufferViews"] = views
    gltf["buffers"] = [{"byteLength": len(body)}]
    acc = gltf["accessors"]
    acc[attrs["POSITION"]].update({
        "bufferView": 0, "count": len(order),
        "min": [min(p[a] for p in xs) for a in range(3)],
        "max": [max(p[a] for p in xs) for a in range(3)],
    })
    acc[attrs["NORMAL"]].update({"bufferView": 1, "count": len(order)})
    acc[attrs["TEXCOORD_0"]].update({"bufferView": 2, "count": len(order)})
    acc[prim["indices"]].update({"bufferView": 3, "count": len(new_idx)})
    if "TEXCOORD_1" not in attrs:
        attrs["TEXCOORD_1"] = len(acc)
        acc.append({"componentType": 5126, "type": "VEC2"})
    acc[attrs["TEXCOORD_1"]].update({"bufferView": 4, "count": len(order)})
    for a in acc:
        a.pop("byteOffset", None)
    gltf["meshes"][0]["name"] = gltf["nodes"][0]["name"] = "ALXMTNC_Stairs_Sharp"

    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(body))
           + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(body), 0x004E4942) + body)
    DST.write_bytes(out)
    print(f"{len(tris)} -> {len(kept)} triangles, {len(pos)} -> {len(order)} vertices")
    print(f"wrote {DST.relative_to(ROOT)} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
