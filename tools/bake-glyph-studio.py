"""
The studio's light, baked in Cycles: what a real softbox does to the stair
and to the floor it stands on, which the real-time rig cannot do.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        -P tools/bake-glyph-studio.py

The real-time render lights every face of the stair in one flat value. That
is right AT REST — the logo is the stair under the one perfect light, and the
SVG is flat — and it is exactly what reads as "digital" the moment the camera
moves: a real face under a softbox is never one value. It darkens into every
inside corner, it falls off away from the light, and the object sits on the
floor through a shadow that is dense and sharp where they touch and opens up
as it leaves. Those are the three things this bakes, with a real area light
at a real distance, into two maps:

  glyph-alxmtnc-3d-v3.studio.png — the stair, in the lightmap atlas that
    tools/sharpen-glyph.py writes as TEXCOORD_1, two channels over RANGE:

    R, the DIFFUSE: what the studio gives each point over what the real-time
      rig gives a face turned that way, normalised so the best-lit riser is
      1. Multiplied into the real-time diffuse, it hands the shading over to
      the studio. And the studio is not the rig: the rig's key sits half-way
      between the risers and the side faces, so the two land on the same
      cobalt — the logo, at rest, wants exactly that. A photographer's key
      comes from one side, and the faces part: risers in the light, the side
      a step down, the back in shade. That is the shape coming back.

    G, the REFLECTIONS: occlusion only — the studio's light per face
      orientation over the best-lit texel facing that way. A side face in
      shade still mirrors the room as well as a riser does; only a corner
      takes some of the mirror away.

    B is unused (zero).

    The EDGES go in the json instead, as segments: a real edge, however
    sharp, is a bevel of a tenth of a millimetre, and it catches the light in
    a thread. That thread is narrower than a texel of any atlas worth
    shipping, so the shader measures its distance to these few segments
    exactly, per pixel, and lights it with the room the bevel would see.
    Inside corners and the edges the stair stands on are left out: they are
    not edges anyone sees catch light.

  The key's shadow is NOT in either map: the real-time shadow map casts it,
  on the floor and on the AAXLO mark alike. The maps carry the rest.

  glyph-alxmtnc-3d-v3.floor.png — the floor under the stair: what it receives
    with the stair standing on it over what it receives without. The AAXLO
    mark stands on it too (tools/aaxlo-mark.obj, written by
    tools/export-aaxlo-mark.mjs from the page itself): its contact with the
    floor is in the map, and the word reads the map back to darken its own
    foot (scenes/AaxloMark.js). 1 far away,
    darkest at the contact. Rect in the stair's own coordinates in the .json.
    Baked with the stair in its own cobalt, so the matte floor also carries
    the faint blue the stair throws onto it: R the occlusion, G and B the
    tint (red-green share over 1, blue share over 2).

The scene is in the .glb's coordinates (three's: Y up). Blender's importer
turns them into its own (x, -z, y), and so does every light placed here.

Intensities are in three's units, where a light's intensity is the
irradiance it gives a face turned to it. The real-time rig (Scene.js
#addLights): hemisphere 1.9 (white sky, near-black ground), key 2.3 from
(18, 40, 20), fill 0.4 from (-16, 14, 30). In Cycles an area light of power
P gives about P / (pi D^2) at distance D, a uniform sky of radiance L gives
pi L.
"""

import json
import math
import struct
import zlib
from pathlib import Path

import bpy
import mathutils
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "public" / "models"
NAME = "glyph-alxmtnc-3d-v3"
MARK = ROOT / "tools" / "aaxlo-mark.obj"
# The word's albedo for the floor bake: a black lacquer, and the coral O is
# too small to tint the floor anyone would see.
MARK_ALBEDO = 0.02

ATLAS = 1024
# tools/sharpen-glyph.py's gutter between islands: each island may bleed
# half of it, so neighbours never overwrite each other.
GUTTER = 8
SAMPLES = 4096
# What is left of the path tracer's grain is filtered off inside each island,
# never across one: a Gaussian this narrow stays inside the half-gutter the
# island bled into (see GUTTER).
GRAIN_SIGMA = 1.2
# M is stored over this range so that the floor's bounce (a corner that sees
# the white floor gets MORE than the open face) is not clipped at 1.
RANGE = 1.5
# The edge distance field reaches this far, in model units; past it, B is 1.
# The stair's own albedo for the floor bake, linear: #0013FF at the strength of
# a lacquered paint, not of a light.
COBALT = (0.0, 0.0065 * 0.6, 0.6)

# The softbox. Distance and size are what make it a softbox and not a sun:
# a face 4 units wide 14 units from a 6-unit box falls off by a few per cent
# across its width, and a shadow 3 units long opens from a knife edge at the
# contact to a wide penumbra at its tip.
#
# Placed for the photograph, not copied from the rig: the key swung round
# toward the risers (21 degrees off +X instead of 48), so a side face gets a
# quarter of its light where a riser gets three fifths; the fill a broad, weak
# card on the other side, so the shade side never goes to black.
KEY = {"dir": (26, 32, 10), "irradiance": 2.3, "distance": 14, "size": 6}
FILL = {"dir": (-8, 10, 26), "irradiance": 0.3, "distance": 14, "size": 12}
SKY = 1.9
GROUND = 0x14 / 255

# The real-time rig, which the R channel is measured against.
RIG_KEY = ((18, 40, 20), 2.3)
RIG_FILL = ((-16, 14, 30), 0.4)


def rig_irradiance(n):
    """What three's lights give an unoccluded face of normal n (three axes)."""
    n = np.asarray(n, float)
    e = 0.0
    for d, i in (RIG_KEY, RIG_FILL):
        d = np.asarray(d, float) / np.linalg.norm(d)
        e += i * max(0.0, float(n @ d))
    w = 0.5 + 0.5 * n[1]
    return e + SKY * (GROUND + (1 - GROUND) * w)

# The floor map's rect, three's (x, z), around the stair's 4 x 2.5 footprint.
# Wide enough on every side for the occlusion to have died back to 1 before
# the edge, which the bake asserts.
FLOOR_MIN = (-9.0, -11.0)
FLOOR_MAX = (8.0, 6.0)
FLOOR_RES = 1024
PAPER = 0.955  # #FAFAF8, linear

# THE CONTACT CORE (Alexandre, 2026-11-03): the bake's occlusion is right in
# its spread but soft at the very foot — a 90-degree corner only loses half
# its sky, and the grain filter rounds what peak there is. The shaders add a
# short, dense layer on top, exp(-d / reach), from the exact distance to the
# nearest foot: on the floor, this map (glyph-alxmtnc-3d-v3.contact.png, the
# floor rect, distance over CONTACT_RANGE); on the stair, the foot segments in
# the json. Past CONTACT_RANGE the layer is gone, so 8 bits over it are a
# step of 2 thousandths of a unit.
CONTACT_RANGE = 0.5
# Run with CONTACT_ONLY=1 to rewrite only those two, in seconds, without the
# Cycles bakes.
CONTACT_ONLY = __import__("os").environ.get("CONTACT_ONLY") == "1"


# Set BAKE_DEBUG to a directory to keep the raw bakes as .npy.
DEBUG = __import__("os").environ.get("BAKE_DEBUG")


def to_blender(v):
    x, y, z = v
    return (x, -z, y)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    return scene


def diffuse_material(name, albedo):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (albedo, albedo, albedo, 1)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    return mat


def bake_target(mat, image):
    nodes = mat.node_tree.nodes
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    for n in nodes:
        n.select = False
    node.select = True
    nodes.active = node



def world():
    w = bpy.data.worlds.new("Studio")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = -0.05
    ramp.inputs["From Max"].default_value = 0.05
    # The hemisphere light: white over the horizon, near-black under it,
    # radiance such that an open upward face receives SKY.
    ramp.inputs["To Min"].default_value = GROUND * SKY / math.pi
    ramp.inputs["To Max"].default_value = SKY / math.pi
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Value"])
    nt.links.new(ramp.outputs["Result"], bg.inputs["Strength"])
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bpy.context.scene.world = w


def float_image(name, w, h):
    return bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)


def pixels(image):
    a = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(a)
    return a.reshape(image.size[1], image.size[0], 4)


def bake(obj, kind, margin=GUTTER // 2, **kw):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    s = bpy.context.scene.render.bake
    s.margin = margin
    s.margin_type = "EXTEND"
    bpy.ops.object.bake(type=kind, **kw)


def smooth(values, mask, sigma=GRAIN_SIGMA):
    """Normalised Gaussian: only texels inside `mask` contribute."""
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    num, den = values * mask, mask.astype(np.float64)
    for axis in (0, 1):
        num = sum(w * np.roll(num, o, axis) for o, w in zip(range(-r, r + 1), k))
        den = sum(w * np.roll(den, o, axis) for o, w in zip(range(-r, r + 1), k))
    return np.where(mask, num / np.maximum(den, 1e-9), values)


def fill_holes(values, hole):
    """Grows the values around a hole into it, a ring of texels at a time."""
    values, hole = values.copy(), hole.copy()
    while hole.any():
        known = ~hole
        num = np.zeros_like(values)
        den = np.zeros_like(values)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                num += np.roll(np.roll(values * known, dy, 0), dx, 1)
                den += np.roll(np.roll(known.astype(float), dy, 0), dx, 1)
        ring = hole & (den > 0)
        values[ring] = num[ring] / den[ring]
        hole &= ~ring
    return values


def write_png(path, *channels):
    """8-bit PNG, grey or RGB, rows top-down, from bottom-up float arrays."""
    planes = [np.clip(np.round(c[::-1] * 255), 0, 255).astype(np.uint8) for c in channels]
    if len(planes) == 2:
        planes.append(np.zeros_like(planes[0]))
    rows = np.stack(planes, axis=-1) if len(planes) > 1 else planes[0]
    raw = b"".join(b"\0" + r.tobytes() for r in rows)
    h, w = rows.shape[:2]
    colour = 2 if len(planes) > 1 else 0

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    # v = 0 is the TOP row, glTF's convention: three samples these with
    # flipY off, the same UVs the .glb carries.
    path.write_bytes(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, colour, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9))
                     + chunk(b"IEND", b""))


def feet_mask(mesh, mark, bottom):
    """The floor texels under the stair's feet and the word's, bottom-up rows."""
    u = (np.arange(FLOOR_RES) + 0.5) / FLOOR_RES
    tx = FLOOR_MIN[0] + u * (FLOOR_MAX[0] - FLOOR_MIN[0])
    # Rows run bottom-up, and the bottom row is v = 1 — three's max z.
    tz = FLOOR_MAX[1] - u * (FLOOR_MAX[1] - FLOOR_MIN[1])
    X, Z = np.meshgrid(tx, tz)
    feet = np.zeros((FLOOR_RES, FLOOR_RES), bool)
    for poly in mesh.polygons:
        if poly.normal.z > -0.9 or abs(poly.center.z - bottom) > 1e-4:
            continue
        xs = [mesh.vertices[i].co.x for i in poly.vertices]
        zs = [-mesh.vertices[i].co.y for i in poly.vertices]
        feet |= (X > min(xs)) & (X < max(xs)) & (Z > min(zs)) & (Z < max(zs))
    # The word's feet, the same way: every triangle of its underside. The
    # letters' bottoms are not all on one line in the SVG — the round ones dip
    # a hair — so "on the floor" is within a fraction of a floor texel.
    before = feet.sum()
    for poly in mark.data.polygons:
        vs = [mark.matrix_world @ mark.data.vertices[i].co for i in poly.vertices]
        if any(abs(v.z - bottom) > 0.006 for v in vs) or len(vs) != 3:
            continue
        (ax, az), (bx, bz), (cx, cz) = [(v.x, -v.y) for v in vs]
        d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(d) < 1e-12:
            continue
        l1 = ((bz - cz) * (X - cx) + (cx - bx) * (Z - cz)) / d
        l2 = ((cz - az) * (X - cx) + (ax - cx) * (Z - cz)) / d
        feet |= (l1 > 0) & (l2 > 0) & (1 - l1 - l2 > 0)
    print(f"floor: {before} texels under the stair's feet, {feet.sum() - before} "
          "under the word's, filled from around them")
    return feet


def foot_distance(feet):
    """
    Exact Euclidean distance, model units, from each floor texel to the
    nearest foot texel, out to CONTACT_RANGE: a row pass, then the columns.
    Measured between texel centres, so half a texel comes off — the foot's
    real outline runs along the edge of its outermost texels.
    """
    h, w = feet.shape
    texel = (FLOOR_MAX[0] - FLOOR_MIN[0]) / FLOOR_RES
    big = 1e9
    row = np.full(feet.shape, big)
    last = np.full(h, -big)
    for x in range(w):
        last = np.where(feet[:, x], x, last)
        row[:, x] = x - last
    last = np.full(h, big)
    for x in range(w - 1, -1, -1):
        last = np.where(feet[:, x], x, last)
        row[:, x] = np.minimum(row[:, x], last - x)
    g = np.minimum(row, big) ** 2
    out = g.copy()
    for dy in range(1, int(math.ceil(CONTACT_RANGE / texel)) + 2):
        out = np.minimum(out, np.minimum(np.roll(g, dy, 0), np.roll(g, -dy, 0)) + dy * dy)
    d = np.sqrt(out) * texel - 0.5 * texel
    return np.clip(d, 0, CONTACT_RANGE)


def foot_edges(glyph, bottom):
    """
    The stair's feet, as segments in glTF coordinates, each with the two faces
    that darken toward it (axis codes, as for the convex edges): every inside
    corner where an upright face stands on a tread, and every bottom edge of
    an upright face, which stands on the floor (its code twice: the floor is
    another mesh, and reads the map).
    """
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(glyph.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)

    def gltf(v):
        return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]

    def code(n):
        n = gltf(n)
        a = max(range(3), key=lambda k: abs(n[k]))
        return (a + 1) * (1 if n[a] > 0 else -1)

    feet = []
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle() < 0.5:
            continue
        f1, f2 = e.link_faces
        upright = [f for f in (f1, f2) if abs(f.normal.z) < 0.1]
        if len(upright) != 1:
            continue
        other = f2 if upright[0] is f1 else f1
        a, b = (gltf(v.co) for v in e.verts)
        if not e.is_convex and other.normal.z > 0.9:
            feet.append([*a, *b, code(upright[0].normal), code(other.normal)])
        elif (e.is_convex and other.normal.z < -0.9
              and abs(other.calc_center_median().z - bottom) < 1e-4):
            c = code(upright[0].normal)
            feet.append([*a, *b, c, c])
    bm.free()
    print(f"feet: {len(feet)} foot segments")
    return feet


def write_contact(glyph, mesh, mark, bottom):
    """The contact core's two inputs: the floor's distance map, the stair's feet."""
    d = foot_distance(feet_mask(mesh, mark, bottom))
    write_png(MODELS / f"{NAME}.contact.png", d / CONTACT_RANGE)
    path = MODELS / f"{NAME}.studio.json"
    meta = json.loads(path.read_text())
    meta["contact"] = {"range": CONTACT_RANGE}
    meta["feet"] = foot_edges(glyph, bottom)
    path.write_text(json.dumps(meta, indent=1) + "\n")
    print("wrote", f"{NAME}.contact.png, feet and contact in {NAME}.studio.json")


def convex_edges(glyph, bottom):
    """
    The stair's convex edges, as segments in the glyph's glTF coordinates,
    each with the two faces it joins (their outward normals, as axis codes).
    """
    import bmesh

    # The solid's real faces: the export is split per polygon and
    # subdivided, so weld it and merge every plane back into one n-gon.
    bm = bmesh.new()
    bm.from_mesh(glyph.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_limit(bm, angle_limit=0.01, verts=bm.verts, edges=bm.edges)

    def gltf(v):  # Blender (x, y, z) -> glTF (x, z, -y)
        return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]

    def code(n):  # an axis-aligned unit normal as +-1, +-2, +-3
        n = gltf(n)
        a = max(range(3), key=lambda k: abs(n[k]))
        return (a + 1) * (1 if n[a] > 0 else -1)

    edges = []
    for e in bm.edges:
        if len(e.link_faces) != 2 or not e.is_convex or e.calc_face_angle() < 0.5:
            continue
        # The edges the stair stands on: on the floor, not in the light.
        if any(f.normal.z < -0.9 and abs(f.calc_center_median().z - bottom) < 1e-4
               for f in e.link_faces):
            continue
        a, b = (gltf(v.co) for v in e.verts)
        edges.append([*a, *b, *(code(f.normal) for f in e.link_faces)])
    bm.free()
    print(f"edges: {len(edges)} convex edges")
    return edges


def main():
    scene = reset()
    world()

    bpy.ops.import_scene.gltf(filepath=str(MODELS / f"{NAME}.glb"))
    glyph = next(o for o in scene.objects if o.type == "MESH")
    mesh = glyph.data
    assert len(mesh.uv_layers) >= 2, "no TEXCOORD_1: re-run tools/sharpen-glyph.py"
    mesh.uv_layers.active_index = 1
    # Cobalt's own luminance: what the stair bounces onto itself is a dark
    # blue, not white.
    glyph.data.materials.clear()
    gmat = diffuse_material("Glyph", 0.07)
    glyph.data.materials.append(gmat)
    bottom = min((glyph.matrix_world @ v.co).z for v in mesh.vertices)

    # The floor: one big plane at the stair's foot, out to the cyclorama's
    # radius (5.2 x the 4-unit width), UV-mapped so that the floor rect is
    # exactly [0, 1] — the bake writes only that part of it.
    R = 21.0
    bpy.ops.mesh.primitive_plane_add(size=2 * R, location=(0, 0, bottom))
    floor = bpy.context.active_object
    fmat = diffuse_material("Floor", PAPER)
    floor.data.materials.append(fmat)
    uv = floor.data.uv_layers.active.data
    for loop in floor.data.loops:
        co = floor.matrix_world @ floor.data.vertices[loop.vertex_index].co
        # Blender (x, y) on the floor is three's (x, -z).
        tx, tz = co.x, -co.y
        uv[loop.index].uv = (
            (tx - FLOOR_MIN[0]) / (FLOOR_MAX[0] - FLOOR_MIN[0]),
            1 - (tz - FLOOR_MIN[1]) / (FLOOR_MAX[1] - FLOOR_MIN[1]),
        )

    for name, spec in (("Key", KEY), ("Fill", FILL)):
        d = np.array(to_blender(spec["dir"]), dtype=float)
        d /= np.linalg.norm(d)
        data = bpy.data.lights.new(name, "AREA")
        data.shape = "SQUARE"
        data.size = spec["size"]
        data.energy = spec["irradiance"] * math.pi * spec["distance"] ** 2
        # The key's SHADOW stays real-time: it falls on the AAXLO mark
        # behind the stair too, which this bake knows nothing about, and the
        # two would disagree. What the bake adds is everything the real-time
        # rig has no way to do: the sky and the fill shut out of corners and
        # contacts, and the softbox falling off across a face.
        data.use_shadow = name != "Key"
        obj = bpy.data.objects.new(name, data)
        obj.location = tuple(d * spec["distance"])
        obj.rotation_euler = mathutils.Vector(tuple(-d)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)

    # The AAXLO mark, in the same glTF space as the stair: the OBJ importer's
    # default axes (forward -Z, up Y) are the glTF importer's.
    bpy.ops.wm.obj_import(filepath=str(MARK), forward_axis="NEGATIVE_Z", up_axis="Y")
    mark = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    mark.data.materials.clear()
    mark.data.materials.append(diffuse_material("Mark", MARK_ALBEDO))
    mb = [mark.matrix_world @ v.co for v in mark.data.vertices]
    print(f"mark: {len(mark.data.polygons)} faces, foot at {min(v.z for v in mb):.4f} "
          f"(stair's {bottom:.4f})")
    assert abs(min(v.z for v in mb) - bottom) < 1e-3, "the mark does not stand on the floor"
    # Not in the stair's own light: the stair's atlas is the stair's.
    mark.hide_render = True
    if CONTACT_ONLY:
        write_contact(glyph, mesh, mark, bottom)
        return

    # 1. The stair's light, and its normals to sort the texels by.
    light = float_image("light", ATLAS, ATLAS)
    bake_target(gmat, light)
    bake(glyph, "DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
    E = pixels(light)[..., :3].mean(axis=2)
    normals = float_image("normals", ATLAS, ATLAS)
    gmat.node_tree.nodes.active.image = normals
    scene.cycles.samples = 1
    bake(glyph, "NORMAL", normal_space="OBJECT")
    scene.cycles.samples = SAMPLES
    N = pixels(normals)[..., :3] * 2 - 1
    if DEBUG:
        np.save(f"{DEBUG}/E.npy", E)
        np.save(f"{DEBUG}/N.npy", pixels(normals))
    # The bake clears what it does not write to black, which decodes to
    # (-1, -1, -1): length 1.73, not a normal. Only unit vectors are faces.
    covered = np.abs(np.linalg.norm(N, axis=2) - 1) < 0.05

    E = smooth(E, covered)
    axis = np.argmax(np.abs(N), axis=2)
    sign = np.sign(np.take_along_axis(N, axis[..., None], 2)[..., 0])
    group = axis * 2 + (sign > 0)
    diffuse = np.ones_like(E)
    occlusion = np.ones_like(E)
    report = {}
    for g in range(6):
        sel = covered & (group == g)
        if sel.sum() < 64:
            continue
        b = np.zeros(3)
        b[g // 2] = 1 if g % 2 else -1
        # Blender's axes back to three's: its z is three's y, its y three's -z.
        n = (b[0], b[2], -b[1])
        name = "xyz"[int(np.argmax(np.abs(n)))] + ("+" if max(n) > 0 else "-")
        occlusion[sel] = E[sel] / np.percentile(E[sel], 98)
        # Faces looking DOWN keep the rig's light, occlusion only. The rig
        # gives them next to nothing on purpose and hands the floor's bounce
        # out per face (the pale wedge, GlyphMaterial.js); the studio's white
        # floor would light them five times over and undo that drawing.
        diffuse[sel] = E[sel] / rig_irradiance(n) if n[1] >= 0 else np.nan
        report[name] = sel
    # The risers are the logo's cobalt: the one fixed point. Most of their
    # area lands on it, the bottom of each one falls below it.
    diffuse /= np.percentile(diffuse[report["x+"]], 90)
    diffuse = np.where(np.isnan(diffuse), occlusion, diffuse)
    for name, sel in sorted(report.items()):
        print(f"  {name}: diffuse median {np.median(diffuse[sel]):.3f} "
              f"(5th pct {np.percentile(diffuse[sel], 5):.3f}), "
              f"occlusion 5th pct {np.percentile(occlusion[sel], 5):.3f}")
    assert diffuse[covered].max() < RANGE, "raise RANGE: the diffuse clips"
    edges = convex_edges(glyph, bottom)
    write_png(MODELS / f"{NAME}.studio.png", diffuse / RANGE, occlusion / RANGE)

    # 2. The floor, with the stair and without it — the stair in its colour.
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*COBALT, 1)
    with_ = float_image("floor_with", FLOOR_RES, FLOOR_RES)
    bake_target(fmat, with_)
    mark.hide_render = False
    bake(floor, "DIFFUSE", margin=0, pass_filter={"DIRECT", "INDIRECT"})
    glyph.hide_render = True
    mark.hide_render = True
    without = float_image("floor_without", FLOOR_RES, FLOOR_RES)
    fmat.node_tree.nodes.active.image = without
    bake(floor, "DIFFUSE", margin=0, pass_filter={"DIRECT", "INDIRECT"})
    glyph.hide_render = False
    mark.hide_render = False
    everywhere = np.ones((FLOOR_RES, FLOOR_RES), bool)
    RGB = np.stack([smooth(pixels(with_)[..., c], everywhere) for c in range(3)], -1)
    A = RGB.mean(axis=2)
    B = smooth(pixels(without)[..., :3].mean(axis=2), everywhere)
    F = np.clip(A / np.maximum(B, 1e-6), 0, 1)
    # The tint: each channel's share of the light, 1 where the floor is white.
    tint = RGB / np.maximum(A, 1e-6)[..., None]
    tint_rg = np.clip((tint[..., 0] + tint[..., 1]) / 2, 0, 1)
    tint_b = np.clip(tint[..., 2] / 2, 0, 1)
    # Under the stair's feet the floor is coincident with the stair's bottom
    # and the bake there is noise. It is never seen, but bilinear filtering
    # reads one texel of it at the foot, and at a grazing angle that texel
    # stair-steps into a jagged dark line. So the feet take the value of the
    # floor around them.
    feet = feet_mask(mesh, mark, bottom)
    F = fill_holes(F, feet)
    tint_rg = fill_holes(tint_rg, feet)
    tint_b = fill_holes(tint_b, feet)
    print(f"floor: bluest blue share {2 * tint_b.max():.3f}")
    edge = np.concatenate([F[:4].ravel(), F[-4:].ravel(), F[:, :4].ravel(), F[:, -4:].ravel()])
    print(f"floor: darkest {F.min():.3f}, edge mean {edge.mean():.4f}, edge min {edge.min():.4f}")
    assert edge.min() > 0.97, "the floor rect is too small: the occlusion reaches its edge"
    write_png(MODELS / f"{NAME}.floor.png", F, tint_rg, tint_b)

    (MODELS / f"{NAME}.studio.json").write_text(json.dumps({
        "range": RANGE,
        "edges": edges,
        "floor": {"min": FLOOR_MIN, "max": FLOOR_MAX, "y": bottom},
    }, indent=1) + "\n")
    print("wrote", f"{NAME}.studio.png, {NAME}.floor.png, {NAME}.studio.json")
    write_contact(glyph, mesh, mark, bottom)


main()
