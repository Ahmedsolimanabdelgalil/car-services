# Builds the vented, drilled and slotted brake disc -> assets/models/disc.glb
# Run:  blender --background --python tools/build_disc.py -- [preview.png]
# Disc axis is Z, outer radius 1.0, friction faces at z = +/-0.0725 (same as js/showcase.js).
import bmesh, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partlib as pl

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pl.reset()
pl.material("disc_face", (0.6, 0.62, 0.65), 1.0, 0.3)
pl.material("disc_hat", (0.08, 0.085, 0.095), 0.9, 0.45)
pl.material("disc_vane", (0.05, 0.05, 0.055), 0.8, 0.6)

RO, RI = 1.0, 0.56            # friction ring
Z0, Z1 = 0.0275, 0.0725       # one plate (mirrored for the other)
GROUPS = 18

# ---------------------------------------------------------------- friction plates
bm = bmesh.new()
pl.cyl(bm, RO, Z0, Z1, seg=120)
pl.cyl(bm, RO, -Z1, -Z0, seg=120)
plates = pl.new_object("disc_plates", bm, "disc_face")

bm = bmesh.new()
pl.cyl(bm, RI, -0.2, 0.2, seg=96)                               # centre opening
for i in range(GROUPS):                                         # cross-drilled holes
    for j in range(3):
        a = i / GROUPS * math.tau + j * 0.085
        r = RI + (RO - RI) * (0.22 + j * 0.28)
        x, y = pl.polar(r, a)
        pl.cyl(bm, 0.026, -0.2, 0.2, x, y, seg=12)
pl.cut(plates, pl.new_object("cut_holes", bm))

bm = bmesh.new()                                                # curved slots between every other hole group
for i in range(0, GROUPS, 2):
    left, right = [], []
    for k in range(9):
        t = 0.08 + (0.94 - 0.08) * k / 8
        r = RI + (RO - RI) * t
        a = (i + 0.5) / GROUPS * math.tau + (t - 0.22) * 0.085 / 0.28
        half = 0.011 / r
        left.append(pl.polar(r, a + half))
        right.append(pl.polar(r, a - half))
    outline = left + right[::-1]
    pl.prism(bm, outline, Z1 - 0.007, Z1 + 0.02)
    pl.prism(bm, outline, -Z1 - 0.02, -Z1 + 0.007)
pl.cut(plates, pl.new_object("cut_slots", bm))
pl.bevel(plates, 0.0045, 1, 40)                                 # chamfer every machined edge
pl.finalize(plates)

# ---------------------------------------------------------------- cooling vanes
bm = bmesh.new()
for i in range(40):
    a = i / 40 * math.tau
    x, y = pl.polar(0.785, a)
    pl.box(bm, 0.36, 0.016, 2 * Z0 + 0.004, x, y, 0, a + 0.42)
vanes = pl.new_object("disc_vanes", bm, "disc_vane")
pl.finalize(vanes)

# ---------------------------------------------------------------- hat (bell)
bm = bmesh.new()
pl.revolve(bm, [(0.60, 0.035), (0.60, 0.062), (0.548, 0.062), (0.508, 0.085), (0.487, 0.13), (0.479, 0.236),
                (0.456, 0.262), (0.43, 0.268), (0.17, 0.268), (0.17, 0.238), (0.42, 0.238), (0.447, 0.227),
                (0.453, 0.13), (0.472, 0.075), (0.522, 0.035)], 96)
hat = pl.new_object("disc_hat", bm, "disc_hat")
bm = bmesh.new()
for k in range(5):                                              # wheel-stud holes
    x, y = pl.polar(0.31, k / 5 * math.tau + 0.3)
    pl.cyl(bm, 0.043, 0.2, 0.3, x, y, seg=20)
for k in range(2):                                              # locating-screw holes
    x, y = pl.polar(0.31, (k * 2 + 0.5) / 5 * math.tau + 0.3)
    pl.cyl(bm, 0.018, 0.2, 0.3, x, y, seg=16)
pl.cut(hat, pl.new_object("cut_studs", bm))
pl.bevel(hat, 0.006, 1, 30)
pl.finalize(hat, 40)

parts = [plates, vanes, hat]
pl.export(parts, "disc.glb")
if argv:
    pl.preview(argv[0], (0, 0, 0.05), [(1.6, -1.6, 2.6), (0.75, -0.55, 0.75)])
