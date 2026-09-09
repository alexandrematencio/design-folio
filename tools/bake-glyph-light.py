#!/usr/bin/env python3
"""
Bakes, per face of the solid, HOW MUCH OF THE WHITE ROOM THAT FACE CAN SEE.

Why this exists
---------------
glyph-alxmtnc.svg is drawn in three values, not two. There is the cobalt, there
is the white — and there is a third, a pale desaturated blue, drawn as
`#2E3191` at 30 % opacity, filling one wedge at the bottom of the stair. On
white paper that composites to rgb(192, 193, 222).

That wedge is not decoration and it is not a fourth brand colour. It is the one
face of the solid that cannot see the room. Measured here, on the .glb:

    face                       centre            sky    ground
    riser, top step            ( 0, +1, 0)       0.49   0.25
    riser, middle step         (+1,  0, 0)       0.49   0.25
    riser, bottom step         (+2, -1, 0)       0.49   0.51
    riser UNDER THE OVERHANG   (-1, -1, 0)       0.03   0.30   <-- the wedge

Every exposed riser sees half the sky. The one tucked under the overhang sees
three per cent of it, and its whole light budget is what bounces up off the
floor. Alexandre drew that. This tool measures it, so the shader can select
that face from the geometry instead of from a hand-written list of coordinates
that would rot the first time the model is rebuilt.

Three numbers, all cosine-weighted fractions of a hemisphere, all measured
after the solid has occluded itself:

    sky     per VERTEX. Directions that escape going UP — the cove and the
            ceiling of the cyclorama, the bright half of the room.
    ground  per VERTEX. Directions that escape going DOWN — the white floor,
            which in a cyclorama is the same white, just lower.
    well    per FACE, and flat. 1 where a face is sealed off from the room and
            open to the floor, 0 everywhere else. This is the wedge selector,
            and the threshold that decides it lives HERE, next to the numbers
            it is judging, where re-running the tool prints both. It is flat
            because the drawing is flat: the wedge in the SVG has no gradient
            in it. Sampling it per vertex instead let the bottom corners see
            past the overhang (0.25 against 0.06 at the top) and the wedge came
            out half cobalt.

Rays are cast PER VERTEX, not per face, and that is the difference between an
object and a sticker. A vertical face near the floor sees a great deal of it at
its foot and much less at its head; interpolate that across the face and every
surface picks up the soft vertical falloff that a white cyclorama actually puts
on things. Bake it per face instead and each face is one flat value, which is
precisely what made the first lit version read as coloured paper cut out and
laid down. The .glb is split for flat shading, so no vertex is shared across a
crease and no gradient ever leaks around a corner.

Each ray starts a little way in from its vertex, toward the centre of its own
face, so that a ray leaving a corner does not immediately graze the coplanar
neighbour it shares that corner with.

    python3 tools/bake-glyph-light.py [--samples 128] [--quiet]

Writes public/models/glyph-alxmtnc-3d-v2.light.json — two Uint8 arrays in
vertex order, plus the vertex count, which the loader asserts against the .glb
so a rebuilt model can never be silently paired with a stale bake.

Pure stdlib. Takes about a minute. Re-run it only if the .glb changes.
"""

import argparse
import json
import math
import random
import struct
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLB = ROOT / "public" / "models" / "glyph-alxmtnc-3d-v2.glb"
OUT = ROOT / "public" / "models" / "glyph-alxmtnc-3d-v2.light.json"

COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


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


def normalize(v):
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


# --------------------------------------------------------------- ray casting


def build_cache(triangles):
    """Möller–Trumbore, with the per-triangle terms hoisted out of the loop."""
    cache = []
    for a, b, c in triangles:
        e1 = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        e2 = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        cache.append((a, e1, e2))
    return cache


def occluded(origin, direction, cache):
    ox, oy, oz = origin
    dx, dy, dz = direction
    for a, e1, e2 in cache:
        px = dy * e2[2] - dz * e2[1]
        py = dz * e2[0] - dx * e2[2]
        pz = dx * e2[1] - dy * e2[0]
        det = e1[0] * px + e1[1] * py + e1[2] * pz
        if -1e-9 < det < 1e-9:
            continue
        inv = 1.0 / det
        tx, ty, tz = ox - a[0], oy - a[1], oz - a[2]
        u = (tx * px + ty * py + tz * pz) * inv
        if u < 0.0 or u > 1.0:
            continue
        qx = ty * e1[2] - tz * e1[1]
        qy = tz * e1[0] - tx * e1[2]
        qz = tx * e1[1] - ty * e1[0]
        v = (dx * qx + dy * qy + dz * qz) * inv
        if v < 0.0 or u + v > 1.0:
            continue
        if (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv > 1e-4:
            return True
    return False


def hemisphere(samples, seed=7):
    """Cosine-weighted, stratified on the first coordinate: same file every run."""
    rng = random.Random(seed)
    out = []
    for i in range(samples):
        u1 = (i + 0.5) / samples
        r = math.sqrt(u1)
        theta = 2.0 * math.pi * rng.random()
        out.append((r * math.cos(theta), r * math.sin(theta),
                    math.sqrt(max(0.0, 1.0 - u1))))
    return out


def smoothstep(edge0, edge1, x):
    t = (x - edge0) / (edge1 - edge0)
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return t * t * (3.0 - 2.0 * t)


# The two windows that define "cannot see the room, can see the floor", on the
# face's own sky and ground visibility. The wedge under the bottom step
# measures sky 0.04 .. 0.09 across its triangles; the nearest exposed riser
# measures 0.51. The window has to clear the top of the wedge's own spread or
# one half of the quad comes out cobalt and the other pale, with the seam
# running diagonally across it — and it still lands nowhere near 0.51.
SEALED = (0.30, 0.12)
LIT_FROM_BELOW = (0.02, 0.10)


def tangent_frame(n):
    helper = (0.0, 0.0, 1.0) if abs(n[2]) < 0.9 else (1.0, 0.0, 0.0)
    t = normalize(cross(helper, n))
    return t, cross(n, t)


# --------------------------------------------------------------------- main


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    gltf, blob = load_glb(GLB)
    prim = gltf["meshes"][0]["primitives"][0]
    positions = read_accessor(gltf, blob, prim["attributes"]["POSITION"])
    normals = read_accessor(gltf, blob, prim["attributes"]["NORMAL"])
    flat = [t[0] for t in read_accessor(gltf, blob, prim["indices"])]
    tris = [(flat[i], flat[i + 1], flat[i + 2]) for i in range(0, len(flat), 3)]

    cache = build_cache([(positions[a], positions[b], positions[c])
                         for a, b, c in tris])
    dirs = hemisphere(args.samples)

    # Where each vertex sits inside its own face, so a corner ray can start
    # slightly inboard of the crease it lives on.
    face_centre = [None] * len(positions)
    for a, b, c in tris:
        centre = tuple(sum(positions[i][k] for i in (a, b, c)) / 3.0
                       for k in range(3))
        for i in (a, b, c):
            if face_centre[i] is None:
                face_centre[i] = centre
            else:
                face_centre[i] = tuple((face_centre[i][k] + centre[k]) / 2.0
                                       for k in range(3))

    sky_bytes = [0] * len(positions)
    ground_bytes = [0] * len(positions)
    well_bytes = [0] * len(positions)
    INSET = 0.12

    def look(origin, n):
        t, bt = tangent_frame(n)
        sky = ground = 0
        for d in dirs:
            world = (t[0] * d[0] + bt[0] * d[1] + n[0] * d[2],
                     t[1] * d[0] + bt[1] * d[1] + n[1] * d[2],
                     t[2] * d[0] + bt[2] * d[1] + n[2] * d[2])
            if occluded(origin, world, cache):
                continue
            if world[1] > 0.0:
                sky += 1
            else:
                ground += 1
        return sky / args.samples, ground / args.samples

    started = time.time()
    for index, position in enumerate(positions):
        n = normalize(normals[index])
        centre = face_centre[index] or position
        origin = tuple(position[k] + (centre[k] - position[k]) * INSET
                       + n[k] * 1e-3 for k in range(3))
        sky, ground = look(origin, n)
        sky_bytes[index] = round(255 * sky)
        ground_bytes[index] = round(255 * ground)

        if not args.quiet and index % 80 == 0:
            print(f"  vertex {index:4d}/{len(positions)}", flush=True)

    # Pass two: the selector, per face, from the centroid.
    wedges = []
    for a, b, c in tris:
        n = normalize(tuple(sum(normals[i][k] for i in (a, b, c)) / 3.0
                            for k in range(3)))
        centre = tuple(sum(positions[i][k] for i in (a, b, c)) / 3.0
                       for k in range(3))
        sky, ground = look(tuple(centre[k] + n[k] * 1e-3 for k in range(3)), n)
        # Sealed off from the room AND open to the floor. Both, because the
        # faces that are merely enclosed — the interior treads, invisible from
        # every pose — see no floor either and must not be veiled.
        well = smoothstep(SEALED[0], SEALED[1], sky) * \
            smoothstep(LIT_FROM_BELOW[0], LIT_FROM_BELOW[1], ground)
        value = round(255 * well)
        for i in (a, b, c):
            well_bytes[i] = max(well_bytes[i], value)
        if well > 0.5:
            wedges.append((centre, n, sky, ground, well))

    OUT.write_text(json.dumps({
        "source": GLB.name,
        "vertexCount": len(positions),
        "samples": args.samples,
        "encoding": "uint8, 0..255 = 0..1 of the cosine-weighted hemisphere",
        "sky": sky_bytes,
        "ground": ground_bytes,
        "well": well_bytes,
    }))

    if not args.quiet:
        print(f"\nbaked {len(positions)} vertices in {time.time() - started:.0f} s")
        print(f"wrote {OUT.relative_to(ROOT)}")
        print(f"\n{len(wedges)} of {len(tris)} faces are in the well:")
        shown = set()
        for centre, n, sky, ground, well in wedges:
            key = tuple(round(v * 2) for v in centre) + tuple(round(v) for v in n)
            if key in shown:
                continue
            shown.add(key)
            visible = n[0] > 0.5 and abs(n[1]) < 0.5
            print(f"  ({centre[0]:+.1f},{centre[1]:+.1f},{centre[2]:+.1f}) "
                  f"n=({n[0]:+.2f},{n[1]:+.2f},{n[2]:+.2f})  "
                  f"sky {sky:.3f}  ground {ground:.3f}  well {well:.2f}"
                  f"{'   <-- the wedge, the one you can see' if visible else ''}")


if __name__ == "__main__":
    main()
