# 东海龙王 · 游动动画（资产轨）
# 用法：Blender --background dragon_king_v1.blend --python animate_swim.py -- <输出目录> [test]
# 原理（与游戏里程序化脊柱同一套）：头沿路线前进，身体每一节都走到「头曾经走过的位置」（跟随式），
#   路线本身带水平摆动和上下起伏，所以起伏会自然地从头传到尾。
#   - 水平：横向波长 9 m、0.44 Hz，振幅颈部 0.15 m → 尾部 0.6 m（技术美术会上数值）
#   - 上下：竖向波长 18 m、0.22 Hz，振幅 ±2.0 m（波峰到波谷 4 m，老板 11-06 要求在一人高基础上翻倍）
#   - 游速 4 m/s；龙身轴线基准高度 5.5 m，波谷时龙身下沿仍 ≈ 2.75 m（会上定的「环带只游不出招，下沿 ≥ 2.5 m」）
import bpy, math, sys, os, subprocess, time
from mathutils import Vector, Quaternion

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else '/tmp/dragon'
TEST = len(args) > 1 and args[1] == 'test'
os.makedirs(OUT, exist_ok=True)

sc = bpy.context.scene
rig = bpy.data.objects['DragonKingRig']; obj = bpy.data.objects['DragonKing']
arm = rig.data; pb = rig.pose.bones
SEG, N, FPS = 0.4, 40, 24
V_SWIM, LH, LV, AH, AV, BASE_Z = 4.0, 9.0, 18.0, 0.30, 2.0, 5.5   # 11-06 老板：上下浮动幅度翻倍（±1 → ±2 m），基准抬高 1 m 保住 2.5 m 受击线
PERIOD = LV / V_SWIM                       # 4.5 s，正好包含 2 个水平周期 → 可无缝循环
sc.render.fps = FPS
Y = Vector((0, 1, 0))
RH = arm.bones['head'].matrix_local.to_quaternion()

def reset():
    for b in pb:
        b.rotation_mode = 'QUATERNION'; b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0)
reset()

def apply(J, fwd, t):
    pb['spine_00'].location = J[0]
    wprev = Quaternion(); w0 = None
    for i in range(N):
        d = (J[i + 1] - J[i]).normalized()
        wi = (wprev @ Y).rotation_difference(d) @ wprev
        pb['spine_%02d' % i].rotation_quaternion = wprev.inverted() @ wi
        if i == 0: w0 = wi
        wprev = wi
    h = w0 @ RH
    pb['head'].rotation_quaternion = h.inverted() @ (h @ Y).rotation_difference(fwd.normalized()) @ h
    f2 = 2.0 / PERIOD                       # 次级摆动频率取周期整数倍，保证循环
    for tag in 'LR':
        for k in range(6):
            ph = 2 * math.pi * f2 * t - k * 0.7
            pb['whisker_%s_%02d' % (tag, k + 1)].rotation_quaternion = \
                Quaternion((1, 0, 0), 0.14 * math.sin(ph)) @ Quaternion((0, 0, 1), 0.10 * math.cos(ph))
    for k in range(6):
        pb['mane_%02d' % (k + 1)].rotation_quaternion = Quaternion((1, 0, 0), 0.10 * math.sin(2 * math.pi * f2 * t - k * 0.5))

def inplace(ah, av):
    def fn(t):
        J = []
        for j in range(N + 1):
            s = j * SEG; amp = ah * (0.5 + 1.5 * s / 16.0)
            J.append(Vector((amp * math.sin(2 * math.pi * (s - V_SWIM * t) / LH), s,
                             av * math.sin(2 * math.pi * (s - V_SWIM * t) / LV))))
        dx = ah * 0.5 * 2 * math.pi / LH * math.cos(2 * math.pi * (-V_SWIM * t) / LH)
        dz = av * 2 * math.pi / LV * math.cos(2 * math.pi * (-V_SWIM * t) / LV)
        return J, Vector((-dx, -1.0, -dz * 0.6))          # 头的俯仰减半，看起来更稳
    return fn

R0 = 23.0; LC = 2 * math.pi * R0                           # 龙在 6 m 环带中线绕场（水墙内径 52 m）
def arena(t):
    def P(s):
        th = s / R0
        r = R0 + 0.35 * math.sin(2 * math.pi * s / (LC / 16))
        return Vector((r * math.cos(th), r * math.sin(th), BASE_Z + AV * math.sin(2 * math.pi * s / (LC / 8))))
    sh = V_SWIM * t
    J = [P(sh - j * SEG) for j in range(N + 1)]
    f = P(sh + 0.3) - P(sh); f.z *= 0.6
    return J, f

def bake(name, fn, seconds):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    frames = int(round(seconds * FPS))
    for fr in range(frames + 1):
        t = fr / FPS; J, f = fn(t); apply(J, f, t)
        for b in pb: b.keyframe_insert('rotation_quaternion', frame=fr + 1)
        pb['spine_00'].keyframe_insert('location', frame=fr + 1)
    act.use_frame_range = True; act.frame_start = 1; act.frame_end = frames + 1
    return act, frames

# ---------------- 1) 原地循环动作 → 导出 glb ----------------
acts = {}
for name, ah, av in (('Swim_Horizontal', AH, 0.0), ('Swim_Vertical', 0.0, AV), ('Swim', AH, AV)):
    acts[name] = bake(name, inplace(ah, av), PERIOD)
    print('DK_BAKE', name, acts[name][1], 'frames')
if not TEST:
    rig.animation_data.action = None; reset()
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    glb = os.path.join(OUT, 'dragon_king_v1_swim.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_skins=True,
                              export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True)
    print('DK_GLB', glb, os.path.getsize(glb))

# ---------------- 2) 预览视频 ----------------
try: sc.eevee.taa_render_samples = 16
except Exception: pass
cam = bpy.data.objects['Cam']; camd = cam.data
bg = sc.world.node_tree.nodes['Background']
def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)
def mat(name, hexc, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    bs = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bs is None:
        bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
        outn = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bs.outputs['BSDF'], outn.inputs['Surface'])
    bs.inputs['Base Color'].default_value = L(hexc); bs.inputs['Roughness'].default_value = 0.85
    if emit: bs.inputs['Emission Color'].default_value = L(hexc); bs.inputs['Emission Strength'].default_value = emit
    return m
def box(name, loc, size, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object
    o.name = name; o.scale = size; o.data.materials.append(m); return o
def text(name, body, loc, size, m, rot=(math.radians(90), 0, math.radians(90))):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = body; cu.size = size; cu.align_y = 'CENTER'
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o); o.location = loc; o.rotation_euler = rot
    o.data.materials.append(m); return o
def look_at(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()

side_objs, arena_objs = [], []
for o in bpy.data.objects:
    if o.name in ('Floor', 'NezhaRef', 'WheelRef') or o.name.startswith('Tick'): side_objs.append(o)
dark = mat('RulerDark', '#2A3036'); hitm = mat('HitLine', '#8A5A2B')
for z in range(0, 13):
    side_objs.append(box('HR%d' % z, (2.0, -5.6, z), (0.05, 0.5 if z % 5 == 0 else 0.3, 0.04), dark))
    side_objs.append(text('HT%d' % z, '%d m' % z, (2.0, -6.6, z), 0.42, dark))
side_objs.append(box('HRpole', (2.0, -5.6, 6.0), (0.04, 0.04, 12.0), dark))
side_objs.append(box('HitLine', (2.0, 7.0, 2.5), (0.03, 25.0, 0.035), hitm))
side_objs.append(text('HitTxt', '2.5 m', (2.0, 17.6, 2.85), 0.4, hitm))
side_objs.append(text('NzTxt', 'Nezha 1.65 m', (2.6, -4.0, 3.3), 0.36, dark))

disc = mat('Vortex', '#2C4A5C'); band = mat('Band', '#1E4560'); rim = mat('Rim', '#56606A')
bpy.ops.mesh.primitive_cylinder_add(radius=20, depth=0.1, location=(0, 0, -0.05), vertices=96)
o = bpy.context.active_object; o.name = 'VortexDisc'; o.data.materials.append(disc); arena_objs.append(o)
bpy.ops.mesh.primitive_cylinder_add(radius=26, depth=0.08, location=(0, 0, -0.12), vertices=96)
o = bpy.context.active_object; o.name = 'RingBand'; o.data.materials.append(band); arena_objs.append(o)
bpy.ops.mesh.primitive_torus_add(major_radius=26, minor_radius=0.15, location=(0, 0, 0.0), major_segments=96)
o = bpy.context.active_object; o.name = 'WallRim'; o.data.materials.append(rim); arena_objs.append(o)
nzm = mat('NzRed2', '#B8261C'); whm = mat('Wheel2', '#FFA531', 1.0)
arena_objs.append(box('NzCenter', (0, 0, 1.15 + 0.825), (0.45, 0.3, 1.65), nzm))
bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=0.06, location=(0, 0, 1.15), vertices=32)
o = bpy.context.active_object; o.name = 'WheelC'; o.data.materials.append(whm); arena_objs.append(o)

def show(objs, on):
    for o in objs: o.hide_render = not on

def render_clip(tag, action, frames, w, h):
    rig.animation_data.action = action
    sc.frame_start, sc.frame_end = 1, frames
    sc.render.resolution_x, sc.render.resolution_y = w, h
    fdir = os.path.join(OUT, 'frames_' + tag); os.makedirs(fdir, exist_ok=True)
    if TEST: sc.frame_start = sc.frame_end = 1 + frames // 3
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(fdir, 'f_')
    t0 = time.time(); bpy.ops.render.render(animation=True)
    print('DK_CLIP', tag, 'frames', sc.frame_end - sc.frame_start + 1, 'sec %.1f' % (time.time() - t0))
    if not TEST:
        mp4 = os.path.join(OUT, 'swim_%s.mp4' % tag)
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i',
                        os.path.join(fdir, 'f_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], check=True)
        print('DK_MP4', mp4)

# a) 侧视 + 高度标尺：看上下起伏幅度（原地循环，播两遍）
show(side_objs, True); show(arena_objs, False)
bg.inputs[0].default_value = L('#DCE2E7'); bg.inputs[1].default_value = 0.9
rig.location = (0, 0, BASE_Z)
camd.type = 'ORTHO'; camd.ortho_scale = 29.0
cam.location = (30, 6.2, 5.6); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
render_clip('side_height', acts['Swim'][0], acts['Swim'][1] * 2, 1280, 720)

# b) 3/4 近景：同时看水平摆动和上下起伏
show(side_objs, False)
bg.inputs[0].default_value = L('#0D1E33'); bg.inputs[1].default_value = 1.0
camd.type = 'PERSP'; camd.lens = 30
cam.location = (-17.0, -10.0, 12.0); look_at(cam, (0.5, 6.5, BASE_Z - 0.5))
render_clip('closeup', acts['Swim'][0], acts['Swim'][1] * 2, 1280, 720)

# c) 绕场：在 52 m 漩涡场里沿环带游一段（中间红柱 = 哪吒）
show(arena_objs, True)
rig.location = (0, 0, 0)
arena_act, arena_frames = bake('Swim_ArenaLap_preview', arena, 10.0)
arena_act.use_fake_user = False
cam.location = (0, -40, 21); camd.lens = 28; look_at(cam, (0, 4, 1.5))
render_clip('arena', arena_act, arena_frames, 1280, 720)
print('DK_DONE')
