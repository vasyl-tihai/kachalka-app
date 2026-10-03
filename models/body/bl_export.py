# Експорт фігури Quaternius для КАЧАЛКИ: A-поза, геометрія + регіони вершин + орієнтири кісток.
# blender -b --factory-startup -P bl_export.py -- <in.gltf> <out.bin> <out.json> <body_mesh_name>
import bpy, sys, json, struct, math, mathutils

args = sys.argv[sys.argv.index('--') + 1:]
src, out_bin, out_json, body_name = args[:4]
ARM_DOWN = float(args[4]) if len(args) > 4 else 52.0  # на скільки градусів опустити руки з T-пози

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects[body_name]

# --- A-поза: плече вниз навколо осі «вперед-назад» ---
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
def rot_about(pb, deg):
    head = arm.matrix_world @ pb.head
    R = (mathutils.Matrix.Translation(head) @ mathutils.Matrix.Rotation(math.radians(deg), 4, 'Y')
         @ mathutils.Matrix.Translation(-head))
    pb.matrix = arm.matrix_world.inverted() @ R @ arm.matrix_world @ pb.matrix
    bpy.context.view_layer.update()

for side, sgn in (('l', 1), ('r', -1)):
    rot_about(arm.pose.bones['upperarm_' + side], ARM_DOWN * sgn)
    rot_about(arm.pose.bones['lowerarm_' + side], 6 * sgn)
bpy.ops.object.mode_set(mode='OBJECT')

# орієнтири в позі (світові), переведені в Y-up (x, z, -y): спереду — +Z
def P(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]
marks = {}
for pb in arm.pose.bones:
    marks[pb.name] = {'h': P(arm.matrix_world @ pb.head), 't': P(arm.matrix_world @ pb.tail)}

# --- регіони за вагами кісток (до застосування пози) ---
groups = {g.index: g.name for g in body.vertex_groups}
def region_of(name):
    if name is None:
        return 'torso'
    n = name
    if n == 'Head':
        return 'head'
    for side in ('l', 'r'):
        if n.endswith('_' + side) and not n.startswith('clavicle'):
            if n.startswith(('thigh', 'calf', 'foot', 'ball')):
                return 'leg' + side.upper()
            return 'arm' + side.upper()
    return 'torso'

me0 = body.data
nv = len(me0.vertices)
codes = {'torso': 0, 'head': 1, 'armL': 2, 'armR': 3, 'legL': 4, 'legR': 5}
reg = bytearray(nv)
armw = bytearray(nv)
legw = bytearray(nv)
headw = bytearray(nv)
for v in me0.vertices:
    acc = {}
    for g in v.groups:
        r = region_of(groups.get(g.group))
        acc[r] = acc.get(r, 0) + g.weight
    tot = sum(acc.values()) or 1
    best = max(acc, key=acc.get) if acc else 'torso'
    reg[v.index] = codes[best]
    armw[v.index] = min(255, round(255 * (acc.get('armL', 0) + acc.get('armR', 0)) / tot))
    legw[v.index] = min(255, round(255 * (acc.get('legL', 0) + acc.get('legR', 0)) / tot))
    headw[v.index] = min(255, round(255 * acc.get('Head'.lower() if False else 'head', 0) / tot))

# --- застосувати позу до геометрії (порядок вершин не змінюється) ---
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
me = ev.to_mesh()
assert len(me.vertices) == nv
me.calc_loop_triangles()
pos = []
for v in me.vertices:
    w = body.matrix_world @ v.co
    pos += [w.x, w.z, -w.y]
tris = []
for t in me.loop_triangles:
    a, b, c = t.vertices
    tris += [a, b, c]  # після заміни осей обхід лишається правильним (поворот, не дзеркало)
ev.to_mesh_clear()

with open(out_bin, 'wb') as f:
    f.write(struct.pack('<%df' % len(pos), *pos))
    f.write(bytes(reg)); f.write(bytes(armw)); f.write(bytes(legw)); f.write(bytes(headw))
    pad = (4 - (nv * 4) % 4) % 4
    f.write(b'\0' * pad)
    fmt = 'H' if nv < 65536 else 'I'
    f.write(struct.pack('<%d%s' % (len(tris), fmt), *tris))

ys = [pos[i + 1] for i in range(0, len(pos), 3)]
json.dump({'vertices': nv, 'triangles': len(tris) // 3, 'index': fmt, 'height': round(max(ys) - min(ys), 4),
           'bones': marks}, open(out_json, 'w'), indent=0)
print('EXPORTED', nv, len(tris) // 3, round(max(ys), 3))
