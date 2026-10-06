# Builds the A/C compressor (A/C & cooling stage) -> assets/models/compressor.glb
# Run:  blender --background --python tools/build_compressor.py -- [preview.png]
# Shaft axis is Z with the clutch/pulley at +Z, ports on top (+Y). Objects named "rot_*" spin on the website.
import bmesh, math, os, sys
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partlib as pl

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pl.reset()
pl.material("ac_body", (0.62, 0.64, 0.67), 1.0, 0.5)
pl.material("ac_pulley", (0.07, 0.075, 0.085), 1.0, 0.35)
pl.material("ac_plate", (0.55, 0.57, 0.6), 1.0, 0.35)
pl.material("ac_steel", (0.5, 0.52, 0.55), 1.0, 0.3)
pl.material("ac_fitting", (0.8, 0.82, 0.85), 1.0, 0.2)
pl.material("ac_cap_hot", (0.58, 0.012, 0.02), 0.0, 0.4)
pl.material("ac_cap_cold", (0.02, 0.2, 0.6), 0.0, 0.4)
pl.material("ac_black", (0.015, 0.015, 0.018), 0.2, 0.5)
pl.material("ac_brass", (0.75, 0.55, 0.2), 1.0, 0.3)

ROT_Y = Matrix.Rotation(-math.pi / 2, 4, "X")      # turns a Z-axis primitive to point along +Y
ROT_X = Matrix.Rotation(math.pi / 2, 4, "Y")       # ... along +X


def cyl_m(bm, r, h, matrix, seg=32, r2=None):
    """Cylinder of height h centred on the origin of `matrix`, along its Z axis."""
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=matrix)


def tube_x(bm, r_out, r_in, length, x, y, z, seg=40):
    """Hollow lug with its bore along X (built as a ring so no boolean is needed)."""
    m = Matrix.Translation((x, y, z)) @ ROT_X
    rings = []
    for zz in (-length / 2, length / 2):
        for r in (r_out, r_in):
            rings.append([bm.verts.new(m @ Vector((r * math.cos(i / seg * math.tau), r * math.sin(i / seg * math.tau), zz))) for i in range(seg)])
    o0, i0, o1, i1 = rings
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((o0[i], o0[j], o1[j], o1[i]))      # outer wall
        bm.faces.new((i0[j], i0[i], i1[i], i1[j]))      # bore
        bm.faces.new((o0[j], o0[i], i0[i], i0[j]))      # end caps
        bm.faces.new((o1[i], o1[j], i1[j], i1[i]))


# ------------------------------------------------------------------ cast aluminium body
bm = bmesh.new()
pl.revolve(bm, [(0.0, -0.9), (0.3, -0.9), (0.42, -0.86), (0.5, -0.78), (0.535, -0.74), (0.535, -0.66), (0.5, -0.64),
                (0.5, 0.2), (0.535, 0.22), (0.535, 0.3), (0.5, 0.32), (0.5, 0.42), (0.44, 0.5), (0.0, 0.5)], 96)
for k in range(10):                                  # longitudinal cooling ribs
    a = k / 10 * math.tau + 0.31
    if 0.9 < a % math.tau < 2.25:
        continue                                     # leave the top clear for the port block
    x, y = pl.polar(0.505, a)
    pl.box(bm, 0.06, 0.034, 0.74, x, y, -0.22, a)
pl.box(bm, 0.44, 0.2, 0.36, 0.0, 0.5, -0.4)           # port block (manifold)
pl.box(bm, 0.3, 0.1, 0.24, 0.0, 0.6, -0.4)
for xs in (-0.11, 0.11):                              # port bosses
    cyl_m(bm, 0.095, 0.12, Matrix.Translation((xs, 0.67, -0.4)) @ ROT_Y, 32)
for y, z in ((0.6, 0.26), (-0.6, 0.26), (-0.6, -0.55), (0.6, -0.72)):   # mounting ears
    tube_x(bm, 0.1, 0.046, 0.46, 0.0, y, z)
    pl.box(bm, 0.36, 0.16, 0.13, 0.0, y * 0.86, z)
for k in range(5):                                    # bosses for the through-bolts on the rear head
    x, y = pl.polar(0.36, k / 5 * math.tau + 0.6)
    pl.cyl(bm, 0.07, -0.9, -0.84, x, y, seg=24)
pl.box(bm, 0.2, 0.14, 0.16, 0.34, 0.36, 0.36, 0.8)    # pad for the clutch-coil connector
body = pl.new_object("body", bm, "ac_body")
rem = body.modifiers.new("remesh", "REMESH")          # fuses the overlaps and rounds edges like a casting
rem.mode = "VOXEL"
rem.voxel_size = 0.0095
rem.use_smooth_shade = True
sm = body.modifiers.new("smooth", "SMOOTH")
sm.factor = 0.6
sm.iterations = 8
dec = body.modifiers.new("decimate", "DECIMATE")
dec.ratio = 0.09
pl.finalize(body, 180)

# ------------------------------------------------------------------ fitted parts on the body
bm = bmesh.new()
for xs in (-0.11, 0.11):
    cyl_m(bm, 0.07, 0.06, Matrix.Translation((xs, 0.755, -0.4)) @ ROT_Y, 6)        # hex of the port fitting
    cyl_m(bm, 0.055, 0.05, Matrix.Translation((xs, 0.8, -0.4)) @ ROT_Y, 32)
fittings = pl.new_object("fittings", bm, "ac_fitting")
pl.finalize(fittings)

caps = []
for xs, mat in ((-0.11, "ac_cap_hot"), (0.11, "ac_cap_cold")):
    bm = bmesh.new()
    cyl_m(bm, 0.062, 0.07, Matrix.Translation((xs, 0.855, -0.4)) @ ROT_Y, 32, r2=0.056)
    caps.append(pl.finalize(pl.new_object("cap_" + mat, bm, mat), 40))

bm = bmesh.new()
for k in range(5):                                    # through-bolt heads + washers
    x, y = pl.polar(0.36, k / 5 * math.tau + 0.6)
    pl.cyl(bm, 0.06, -0.908, -0.9, x, y, seg=24)
    pl.cyl(bm, 0.042, -0.95, -0.908, x, y, seg=6)
bolts = pl.new_object("bolts", bm, "ac_steel")
pl.finalize(bolts)

bm = bmesh.new()                                      # pressure-relief valve on the rear head
pl.cyl(bm, 0.055, -0.96, -0.9, seg=6)
pl.cyl(bm, 0.03, -1.0, -0.96, seg=20)
valve = pl.new_object("valve", bm, "ac_brass")
pl.finalize(valve)

bm = bmesh.new()                                      # clutch coil + its connector
pl.revolve(bm, [(0.3, 0.495), (0.47, 0.495), (0.47, 0.55), (0.3, 0.55)], 72)
x, y = pl.polar(0.47, 0.8)
pl.box(bm, 0.16, 0.1, 0.11, 0.335, 0.345, 0.47, 0.8)
pl.box(bm, 0.1, 0.07, 0.08, 0.41, 0.42, 0.47, 0.8)
coil = pl.new_object("coil", bm, "ac_black")
pl.bevel(coil, 0.006, 2, 30)
pl.finalize(coil, 40)

# ------------------------------------------------------------------ pulley + clutch (rotating)
profile = [(0.47, 0.56), (0.63, 0.56), (0.63, 0.578)]
PITCH, N = 0.031, 6                                   # poly-V belt grooves
for k in range(N):
    z = 0.578 + k * PITCH
    profile += [(0.618, z), (0.592, z + PITCH / 2), (0.618, z + PITCH)]
z_end = 0.578 + N * PITCH
profile += [(0.63, z_end), (0.63, z_end + 0.018), (0.585, z_end + 0.018), (0.57, z_end + 0.004), (0.47, z_end + 0.004)]
bm = bmesh.new()
pl.revolve(bm, profile, 96)
pulley = pl.new_object("rot_pulley", bm, "ac_pulley")
pl.finalize(pulley, 25)

ZP = z_end + 0.012                                    # back face of the clutch plate
bm = bmesh.new()
pl.revolve(bm, [(0.12, ZP), (0.555, ZP), (0.555, ZP + 0.035), (0.12, ZP + 0.035)], 96)
plate = pl.new_object("rot_plate", bm, "ac_plate")
bm = bmesh.new()
for k in range(3):                                    # kidney slots
    a0 = k / 3 * math.tau + 0.25
    pts = [pl.polar(0.41, a0 + 1.45 * i / 20) for i in range(21)] + [pl.polar(0.345, a0 + 1.45 * i / 20) for i in range(20, -1, -1)]
    pl.prism(bm, pts, ZP - 0.05, ZP + 0.1)
pl.cut(plate, pl.new_object("cut_slots", bm))
pl.bevel(plate, 0.005, 1, 40)
pl.finalize(plate)

bm = bmesh.new()                                      # hub: triangular spring plate, rivets, shaft nut
hub_pts = []
for k in range(3):
    a = k / 3 * math.tau + 0.25 + 1.45 / 2 + math.tau / 6
    for da in (-0.2, 0.0, 0.2):
        hub_pts.append(pl.polar(0.36 if da == 0 else 0.33, a + da))
    hub_pts.append(pl.polar(0.15, a + math.tau / 6))
pl.prism(bm, hub_pts, ZP + 0.035, ZP + 0.05)
for k in range(3):
    a = k / 3 * math.tau + 0.25 + 1.45 / 2 + math.tau / 6
    x, y = pl.polar(0.31, a)
    pl.cyl(bm, 0.03, ZP + 0.05, ZP + 0.064, x, y, seg=20, r2=0.02)
pl.cyl(bm, 0.12, ZP + 0.05, ZP + 0.066, seg=40)
pl.cyl(bm, 0.07, ZP + 0.066, ZP + 0.11, seg=6)
pl.cyl(bm, 0.035, ZP + 0.11, ZP + 0.13, seg=20)
hub = pl.new_object("rot_hub", bm, "ac_steel")
pl.finalize(hub)

parts = [body, fittings, bolts, valve, coil, pulley, plate, hub] + caps
pl.export(parts, "compressor.glb")
if argv:
    pl.preview(argv[0], (0, 0.05, -0.05), [(2.6, 1.5, 3.0), (-2.4, 1.6, -3.0)])
