# Shared helpers for the part-building scripts (run inside Blender).
# Coordinates match js/showcase.js: parts are built around the Z axis, exported without
# axis conversion, and materials are matched by name on the website side.
import bpy, bmesh, math, os
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAT = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MAT.clear()
    return bpy.context.scene


def material(name, color, metallic, rough, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if coat and "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    MAT[name] = m
    return m


def polar(r, a):
    """Point at radius r, angle a (radians, from +X, counter-clockwise)."""
    return (r * math.cos(a), r * math.sin(a))


def new_object(name, bm, mat=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat:
        me.materials.append(MAT[mat])
    return ob


def prism(bm, pts, z0, z1):
    verts = [bm.verts.new((x, y, z0)) for x, y in pts]
    face = bm.faces.new(verts)
    top = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, z1 - z0), verts=[v for v in top["geom"] if isinstance(v, bmesh.types.BMVert)])


def cyl(bm, r, z0, z1, x=0.0, y=0.0, seg=48, r2=None):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2,
                          depth=z1 - z0, matrix=Matrix.Translation((x, y, (z0 + z1) / 2)))


def box(bm, sx, sy, sz, x, y, z, rot_z=0.0):
    m = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Diagonal((sx, sy, sz, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def revolve(bm, profile, steps=96):
    """Closed profile [(radius, z), ...] revolved around Z into a solid."""
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[(i + 1) % len(verts)])) for i in range(len(verts))]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)


def cut(ob, cutter):
    cutter.hide_render = True
    mod = ob.modifiers.new(cutter.name, "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "EXACT"


def bevel(ob, width, segments=1, angle=35):
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)


def finalize(ob, sharp=28):
    """Apply modifiers, then shade smooth with hard edges above `sharp` degrees."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.set_sharp_from_angle(angle=math.radians(sharp))
    return ob


def export(parts, filename):
    out = os.path.join(ROOT, "assets", "models", filename)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_yup=False)
    tris = 0
    for ob in parts:
        ob.data.calc_loop_triangles()
        tris += len(ob.data.loop_triangles)
    print("EXPORTED", out, os.path.getsize(out), "bytes,", tris, "triangles")


def preview(path, target, views, lens=50):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = 1100, 620
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.3, 0.31, 0.35, 1)
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    scene.collection.objects.link(sun)
    target = Vector(target)
    for i, pos in enumerate(views):
        pos = Vector(pos)
        cam = bpy.data.objects.new("cam%d" % i, bpy.data.cameras.new("cam%d" % i))
        cam.data.lens = lens
        cam.location = pos
        cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(cam)
        scene.camera = cam
        scene.render.filepath = path.replace(".png", "_%d.png" % i)
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)
