# Builds the alloy wheel + tyre (tyres stage) -> assets/models/wheel.glb
# Run:  blender --background --python tools/build_wheel.py -- [preview.png]   then   node tools/pack_glb.js
# Wheel axis is Z, outer face towards +Z, tyre radius ~1.0. The brake behind the spokes is added on the website.
import bpy, bmesh, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partlib as pl

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pl.reset()
pl.material("tyre", (0.012, 0.012, 0.013), 0.0, 0.85)
pl.material("wheel_face", (0.78, 0.8, 0.83), 1.0, 0.22)
pl.material("wheel_barrel", (0.6, 0.62, 0.65), 1.0, 0.3)
pl.material("wheel_cap", (0.58, 0.012, 0.02), 0.3, 0.3, 1.0)
pl.material("wheel_nut", (0.85, 0.87, 0.9), 1.0, 0.12)
pl.material("wheel_black", (0.015, 0.015, 0.018), 0.2, 0.5)

HALF = 0.3            # half width of the tread zone
DEPTH = 0.03          # tread depth


def r_base(z):        # groove-bottom radius across the tread (crowned)
    return 0.957 - 0.072 * (abs(z) / HALF) ** 3


def tread_h(z):       # tread height fades out round the shoulder
    return DEPTH * max(0.0, min(1.0, (HALF + 0.012 - abs(z)) / 0.07))


SIDE = [(0.84, 0.332), (0.79, 0.342), (0.74, 0.336), (0.695, 0.314), (0.668, 0.292), (0.652, 0.268)]   # sidewall, +Z side


def side_z(r):        # z of the outer sidewall at radius r (for placing the lettering)
    pts = [(r_base(HALF), HALF)] + SIDE
    for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
        if r1 <= r <= r0:
            return z0 + (z1 - z0) * (r0 - r) / (r0 - r1)
    return pts[-1][1]


# ------------------------------------------------------------------ tyre carcass
profile = [(r_base(z), z) for z in [-HALF + 2 * HALF * i / 16 for i in range(17)]]
profile += SIDE + [(0.652, -0.268)] + [(r, -z) for r, z in SIDE[::-1][1:]]
bm = bmesh.new()
pl.revolve(bm, profile, 128)
carcass = pl.new_object("rot_tyre", bm, "tyre")
pl.finalize(carcass, 50)

# ------------------------------------------------------------------ tread blocks
PITCH = 56
bm = bmesh.new()


def block(a0, a1, z0, z1, skew, zs=1, ts=2):
    """One tread block between angles a0..a1 and z0..z1; `skew` slants it (radians per unit of z)."""
    zmid = (z0 + z1) / 2
    grid_top, grid_bot = [], []
    for i in range(ts + 1):
        row_t, row_b = [], []
        for j in range(zs + 1):
            z = z0 + (z1 - z0) * j / zs
            a = a0 + (a1 - a0) * i / ts + skew * (z - zmid)
            rt, rb = r_base(z) + tread_h(z), r_base(z) - 0.004
            row_t.append(bm.verts.new((rt * math.cos(a), rt * math.sin(a), z)))
            row_b.append(bm.verts.new((rb * math.cos(a), rb * math.sin(a), z)))
        grid_top.append(row_t)
        grid_bot.append(row_b)
    for i in range(ts):
        for j in range(zs):
            bm.faces.new((grid_top[i][j], grid_top[i + 1][j], grid_top[i + 1][j + 1], grid_top[i][j + 1]))
        for j in (0, zs):                                  # side walls along the circumference
            bm.faces.new((grid_top[i][j], grid_top[i + 1][j], grid_bot[i + 1][j], grid_bot[i][j]))
    for j in range(zs):                                    # leading / trailing walls
        for i in (0, ts):
            bm.faces.new((grid_top[i][j], grid_top[i][j + 1], grid_bot[i][j + 1], grid_bot[i][j]))


step = math.tau / PITCH
for k in range(PITCH):
    a = k * step
    block(a, a + step * 0.93, -0.042, 0.042, 0.0)                                   # centre rib, fine sipes
    for s in (-1, 1):
        block(a + step * 0.3, a + step * 1.12, s * 0.078, s * 0.166, s * 0.75)      # intermediate ribs, V pattern
        block(a + step * 0.62, a + step * 1.42, s * 0.2, s * 0.312, s * 0.35, zs=5)  # shoulder blocks wrap the edge
tread = pl.new_object("rot_tread", bm, "tyre")
pl.finalize(tread, 35)

# ------------------------------------------------------------------ sidewall lettering (size marking, no brand)
letters = []
try:
    for body, a0 in (("225/45 R18 95W", math.pi / 2), ("RADIAL  TUBELESS", -math.pi / 2)):
        cu = bpy.data.curves.new("txt", "FONT")
        cu.body, cu.size, cu.extrude, cu.align_x, cu.resolution_u = body, 0.062, 0.003, "CENTER", 2
        tmp = bpy.data.objects.new("txt", cu)
        bpy.context.scene.collection.objects.link(tmp)
        me = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(tmp)
        for v in me.vertices:
            r = 0.745 + v.co.y
            a = a0 - v.co.x / 0.775
            v.co = Vector((r * math.cos(a), r * math.sin(a), side_z(r) + 0.003 + v.co.z))
        ob = bpy.data.objects.new("rot_letters", me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(pl.MAT["tyre"])
        letters.append(ob)
except Exception as e:                                     # lettering is optional
    print("LETTERING SKIPPED:", e)

# ------------------------------------------------------------------ rim barrel
bm = bmesh.new()
pl.revolve(bm, [(0.69, 0.275), (0.69, 0.30), (0.665, 0.312), (0.635, 0.30), (0.62, 0.27), (0.6, 0.2), (0.585, 0.05),
                (0.585, -0.1), (0.6, -0.2), (0.62, -0.27), (0.635, -0.30), (0.665, -0.312), (0.69, -0.30), (0.69, -0.275),
                (0.66, -0.27), (0.645, -0.25), (0.645, 0.25), (0.66, 0.27)], 128)
barrel = pl.new_object("rot_barrel", bm, "wheel_barrel")
pl.bevel(barrel, 0.004, 2, 30)
pl.finalize(barrel, 40)

# ------------------------------------------------------------------ spoke face: five Y-spokes + hub, fused like a casting
bm = bmesh.new()
OCT = [(1, 0.5), (0.5, 1), (-0.5, 1), (-1, 0.5), (-1, -0.5), (-0.5, -1), (0.5, -1), (1, -0.5)]
for k in range(5):
    for s in (-1, 1):
        rings = []
        for i in range(15):
            t = i / 14
            r = 0.14 + (0.635 - 0.14) * t
            a = k / 5 * math.tau + s * math.radians(2.5 + 13.5 * t ** 1.2)
            zc = 0.085 + 0.165 * t ** 1.5                  # concave: the hub sits deeper than the rim edge
            w, th = 0.072 - 0.024 * t, 0.075 - 0.03 * t
            er, et = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
            rings.append([bm.verts.new(er * r + et * (cx * w / 2) + Vector((0, 0, zc + cy * th / 2))) for cx, cy in OCT])
        for i in range(14):
            for j in range(8):
                bm.faces.new((rings[i][j], rings[i][(j + 1) % 8], rings[i + 1][(j + 1) % 8], rings[i + 1][j]))
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
pl.revolve(bm, [(0.0, 0.04), (0.2, 0.04), (0.225, 0.08), (0.22, 0.125), (0.17, 0.142), (0.0, 0.142)], 72)   # hub
pl.revolve(bm, [(0.6, 0.235), (0.64, 0.235), (0.64, 0.295), (0.6, 0.275)], 96)                              # ring tying the spoke ends
face = pl.new_object("rot_face", bm, "wheel_face")
rem = face.modifiers.new("remesh", "REMESH")
rem.mode, rem.voxel_size, rem.use_smooth_shade = "VOXEL", 0.0075, True
sm = face.modifiers.new("smooth", "SMOOTH")
sm.factor, sm.iterations = 0.5, 6
pl.finalize(face, 180)

bm = bmesh.new()                                           # machined features cut into the casting
for k in range(5):
    x, y = pl.polar(0.15, (k + 0.5) / 5 * math.tau)
    pl.cyl(bm, 0.036, 0.075, 0.3, x, y, seg=20)            # lug-nut pockets
pl.cyl(bm, 0.095, 0.125, 0.3, seg=40)                      # centre-cap seat
pl.cut(face, pl.new_object("cut_face", bm))
dec = face.modifiers.new("decimate", "DECIMATE")
dec.ratio = 0.12
pl.finalize(face, 45)

# ------------------------------------------------------------------ fitted parts
bm = bmesh.new()
for k in range(5):
    x, y = pl.polar(0.15, (k + 0.5) / 5 * math.tau)
    pl.cyl(bm, 0.027, 0.07, 0.118, x, y, seg=6)
    pl.cyl(bm, 0.018, 0.118, 0.128, x, y, seg=12, r2=0.01)
nuts = pl.new_object("rot_nuts", bm, "wheel_nut")
pl.finalize(nuts)

bm = bmesh.new()
pl.revolve(bm, [(0.0, 0.12), (0.092, 0.12), (0.092, 0.138), (0.075, 0.147), (0.0, 0.15)], 48)
cap = pl.new_object("rot_cap", bm, "wheel_cap")
pl.finalize(cap, 30)

bm = bmesh.new()                                           # valve stem, in a gap between spokes
x, y = pl.polar(0.612, math.radians(36))
pl.cyl(bm, 0.014, 0.2, 0.3, x, y, seg=12)
pl.cyl(bm, 0.018, 0.3, 0.33, x, y, seg=12, r2=0.014)
valve = pl.new_object("rot_valve", bm, "wheel_black")
pl.finalize(valve)

parts = [carcass, tread, barrel, face, nuts, cap, valve] + letters
pl.export(parts, "wheel.glb")
if argv:
    pl.preview(argv[0], (0, 0, 0.05), [(1.6, -1.2, 3.2), (0.25, -1.75, 1.15)])
