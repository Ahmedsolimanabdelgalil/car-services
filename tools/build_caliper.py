# Builds the brake caliper for the site and exports assets/models/caliper.glb
# Run:  blender --background --python tools/build_caliper.py -- [preview.png]
#
# Coordinates match js/showcase.js: the disc axis is Z, the disc has radius 1.0 and
# spans z = +/-0.0725. The caliper is built centred on the +Y axis (theta = 0).
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "models", "caliper.glb")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = argv[0] if argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def P(r, deg):
    """Polar point, theta measured from +Y."""
    a = math.radians(deg)
    return (r * math.sin(a), r * math.cos(a))


def material(name, color, metallic, rough, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.08
    return m


MAT = {
    "red": material("red", (0.58, 0.012, 0.02), 0.25, 0.34, 1.0),
    "pad": material("pad", (0.035, 0.035, 0.04), 0.1, 0.85),
    "steel": material("steel", (0.45, 0.47, 0.5), 1.0, 0.38),
    "chrome": material("chrome", (0.85, 0.87, 0.9), 1.0, 0.1),
    "black": material("black", (0.015, 0.015, 0.018), 0.3, 0.45),
}


def new_object(name, bm, mat=None, sharp_angle=35):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    if mat:
        me.materials.append(MAT[mat])
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        try:
            me.set_sharp_from_angle(angle=math.radians(sharp_angle))
        except Exception:
            pass
    return ob


def prism(bm, pts, z0, z1):
    """Extrude a 2D outline (list of (x, y)) between z0 and z1."""
    verts = [bm.verts.new((x, y, z0)) for x, y in pts]
    face = bm.faces.new(verts)
    top = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=[v for v in top["geom"] if isinstance(v, bmesh.types.BMVert)])


def sector(r0, r1, a0, a1, n=48, r0f=None, r1f=None):
    """Annular sector outline; r0f / r1f optionally vary the radii with theta."""
    outer = []
    inner = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        outer.append(P(r1f(a) if r1f else r1, a))
        inner.append(P(r0f(a) if r0f else r0, a))
    return outer + inner[::-1]


def cyl(bm, r, z0, z1, x=0.0, y=0.0, seg=48, axis=None, r2=None):
    """Cylinder; default axis Z. With axis=(dx,dy,dz) it starts at (x,y,z0) and runs along the axis."""
    h = z1 - z0
    if axis is None:
        mat = Matrix.Translation((x, y, (z0 + z1) / 2))
    else:
        d = Vector(axis).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        mat = Matrix.Translation(Vector((x, y, 0)) + d * (z0 + h / 2)) @ rot
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=mat)


# ------------------------------------------------------------------ cast body
SPAN = 37.0                                        # half angle of the body
ZB = 0.27                                          # half depth of the body
ZS = 0.132                                         # half width of the disc/pad slot


def r_out(a):
    return 1.155 - 0.06 * abs(a / SPAN) ** 3


def r_in(a):
    return 0.63 + 0.07 * abs(a / SPAN) ** 2


bm = bmesh.new()
# Built from additive pieces only (two halves + bridge ends), so the disc slot and the
# pad window are simply left open; the voxel remesh below fuses the overlaps.
for z0, z1 in ((ZS, ZB), (-ZB, -ZS)):
    prism(bm, sector(0, 0, -SPAN, SPAN, 64, r_in, r_out), z0, z1)
    for s in (-1, 1):                              # rounded ends
        x, y = P(0.875, s * SPAN)
        cyl(bm, 0.2, z0, z1, x, y, 40)
for s in (-1, 1):                                  # bridge over the disc, either side of the window
    a0, a1 = sorted((s * 19.5, s * SPAN))
    prism(bm, sector(1.045, 0, a0, a1, 24, None, r_out), -ZS - 0.02, ZS + 0.02)
    x, y = P(1.06, s * (SPAN + 3))
    cyl(bm, 0.075, -ZS - 0.02, ZS + 0.02, x, y, 32)
# piston bosses on both faces (6-pot: large / small / large)
for s in (-1, 1):
    for deg, r in ((-23, 0.125), (0, 0.105), (23, 0.125)):
        x, y = P(0.83, deg)
        cyl(bm, r, s * (ZB - 0.02), s * (ZB + 0.045), x, y, 48) if s > 0 else cyl(bm, r, -(ZB + 0.045), -(ZB - 0.02), x, y, 48)
# raised rib tying the outer bosses together
prism(bm, sector(0.77, 0.89, -27, 27, 40), ZB - 0.02, ZB + 0.018)
# stiffening spine over the bridge ends
for s in (-1, 1):
    prism(bm, sector(1.06, 1.175, s * 22, s * 33, 12), -0.2, 0.2)
# mounting ears on the inboard side
for s in (-1, 1):
    x, y = P(0.6, s * 31)
    cyl(bm, 0.105, -ZB, -ZS, x, y, 40)
body = new_object("caliper_body", bm)
body.data.materials.append(MAT["red"])

# voxel remesh fuses the overlapping pieces and rounds every edge like a casting
rem = body.modifiers.new("remesh", "REMESH")
rem.mode = "VOXEL"
rem.voxel_size = 0.0085
rem.use_smooth_shade = True
smooth = body.modifiers.new("smooth", "SMOOTH")
smooth.factor = 0.6
smooth.iterations = 10
dec = body.modifiers.new("decimate", "DECIMATE")
dec.ratio = 0.085

# ------------------------------------------------------------------ machined / fitted parts
parts = [body]

# piston caps (machined faces on the bosses)
bm = bmesh.new()
for s in (-1, 1):
    for deg, r in ((-23, 0.125), (0, 0.105), (23, 0.125)):
        x, y = P(0.83, deg)
        z = s * (ZB + 0.043)
        cyl(bm, r * 0.74, min(z, z + s * 0.012), max(z, z + s * 0.012), x, y, 48)
parts.append(new_object("piston_caps", bm, "steel"))
bm = bmesh.new()
for s in (-1, 1):
    for deg, r in ((-23, 0.125), (0, 0.105), (23, 0.125)):
        x, y = P(0.83, deg)
        z = s * (ZB + 0.05)
        cyl(bm, r * 0.3, min(z, z + s * 0.012), max(z, z + s * 0.012), x, y, 6)
parts.append(new_object("piston_plugs", bm, "black"))

# pads: friction material + steel backing plate, both sides of the disc
bm = bmesh.new()
for s in (-1, 1):
    z0, z1 = sorted((s * 0.0745, s * 0.105))
    prism(bm, sector(0.665, 1.015, -26, 26, 40), z0, z1)
    for deg in (-9, 9):                            # wear slots
        pass
parts.append(new_object("pad_friction", bm, "pad"))
bm = bmesh.new()
for s in (-1, 1):
    z0, z1 = sorted((s * 0.105, s * 0.128))
    prism(bm, sector(0.655, 1.03, -27, 27, 40), z0, z1)
    for deg in (-12, 12):                          # backing plate ears that ride on the pins
        x, y = P(1.055, deg)
        cyl(bm, 0.035, z0, z1, x, y, 24)
parts.append(new_object("pad_backing", bm, "steel"))

# pad retaining pins + anti-rattle spring
bm = bmesh.new()
for deg in (-12, 12):
    x, y = P(1.075, deg)
    cyl(bm, 0.016, -0.2, 0.2, x, y, 20)
parts.append(new_object("pad_pins", bm, "chrome"))
bm = bmesh.new()
prism(bm, sector(1.094, 1.102, -15, 15, 24), -0.075, 0.075)
prism(bm, sector(1.094, 1.102, -3, 3, 6), -0.125, 0.125)
parts.append(new_object("pad_spring", bm, "steel"))

# bleed nipple (top end) and banjo bolt (other end), both pointing radially outwards
bm = bmesh.new()
x, y = P(1.1, 29)
d = (math.sin(math.radians(29)), math.cos(math.radians(29)), 0)
cyl(bm, 0.034, 0.0, 0.05, x, y, 6, axis=d)
cyl(bm, 0.017, 0.05, 0.1, x, y, 16, axis=d)
x, y = P(1.1, -29)
d2 = (math.sin(math.radians(-29)), math.cos(math.radians(-29)), 0)
cyl(bm, 0.05, 0.0, 0.02, x, y, 24, axis=d2)
cyl(bm, 0.036, 0.02, 0.06, x, y, 6, axis=d2)
parts.append(new_object("fittings", bm, "chrome"))
bm = bmesh.new()
x, y = P(1.1, 29)
cyl(bm, 0.024, 0.085, 0.135, x, y, 16, axis=d, r2=0.02)      # rubber dust cap
parts.append(new_object("bleed_cap", bm, "black"))

# mounting bolts
bm = bmesh.new()
for s in (-1, 1):
    x, y = P(0.6, s * 31)
    cyl(bm, 0.075, -ZB - 0.012, -ZB + 0.002, x, y, 32)       # washer
    cyl(bm, 0.055, -ZB - 0.055, -ZB - 0.012, x, y, 6)        # hex head
parts.append(new_object("mount_bolts", bm, "steel"))

# ------------------------------------------------------------------ export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=False)

dg = bpy.context.evaluated_depsgraph_get()
tris = sum(len(ob.evaluated_get(dg).data.loop_triangles) or (ob.evaluated_get(dg).data.calc_loop_triangles() or len(ob.evaluated_get(dg).data.loop_triangles)) for ob in parts)
print("EXPORTED", OUT, os.path.getsize(OUT), "bytes,", tris, "triangles")

# ------------------------------------------------------------------ preview render (optional)
if PREVIEW:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.device = "CPU"
    try:
        scene.cycles.use_denoising = False
    except Exception:
        pass
    scene.render.resolution_x, scene.render.resolution_y = 1200, 600
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.36, 0.4, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    target = Vector((0, 0.9, 0))
    views = [Vector((1.6, 1.9, 3.6)), Vector((-1.6, 3.6, -2.4))]      # outboard 3/4, top/inboard
    for i, pos in enumerate(views):
        cam = bpy.data.objects.new("cam%d" % i, bpy.data.cameras.new("cam%d" % i))
        cam.data.lens = 50
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(cam)
        scene.camera = cam
        scene.render.filepath = PREVIEW.replace(".png", "_%d.png" % i)
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)
