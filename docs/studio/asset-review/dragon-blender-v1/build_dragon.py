# 《白神话：哪吒》东海龙王 · Blender 生成脚本 v1（资产轨）
# 用法：Blender --background --factory-startup --python build_dragon.py -- <输出目录>
# 依据：design/meetings/2026-11-05-dragon-redesign.md（定稿尺寸）、design/art-direction-board.md v2（色值）、
#       design/assets-specs/dragon-head-spec.md（接口与骨骼约定）、references/dragon-king/dk-01（造型参考，不描摹）
# 坐标：Blender Z 向上；龙头朝 -Y（导出 glTF 后为 +Z 朝前、Y 向上）；原点 = 颈部接口截面中心。
import bpy, bmesh, math, sys, os
from mathutils import Vector, Quaternion, Matrix

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/dragon'
os.makedirs(OUT, exist_ok=True)

# ---------------- 颜色（方向板 v2） ----------------
def L(h, a=1.0):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (a,)
def mix(a, b, t):
    t = max(0.0, min(1.0, t)); return tuple(a[i] * (1 - t) + b[i] * t for i in range(4))
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k, a[3])
def sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)

BELLY, SIDE, BACK = L('#7FA295'), L('#587A6D'), L('#25342E')
BRONZE, OLDGOLD, WHITE = L('#3E4A3C'), L('#A88B4E'), L('#E6E3DA')
MOON = L('#CFE7E4'); DARK = L('#141B18')

# ---------------- 网格累加器 ----------------
V, C, W, F, FM, FS = [], [], [], [], [], []
def av(p, col, w):
    V.append(tuple(p)); C.append(col); W.append(w); return len(V) - 1
def af(idx, mat=0, smooth=True):
    F.append(idx); FM.append(mat); FS.append(smooth)

def tube(pts, radii, sides, col_fn, w_fn, mat=0, smooth=True, cap0=False, cap1=True, up=Vector((0, 0, 1)), tip=0.0):
    pts = [Vector(p) for p in pts]; n = len(pts)
    tans = []
    for i in range(n):
        t = (pts[1] - pts[0]) if i == 0 else (pts[-1] - pts[-2]) if i == n - 1 else (pts[i + 1] - pts[i - 1])
        tans.append(t.normalized())
    s = tans[0].cross(up)
    if s.length < 1e-4: s = tans[0].cross(Vector((1, 0, 0)))
    s.normalize(); u = s.cross(tans[0]).normalized()
    acc = [0.0]
    for i in range(1, n): acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
    total = acc[-1] or 1.0
    rings = []
    for i in range(n):
        if i > 0:
            q = tans[i - 1].rotation_difference(tans[i]); s = q @ s; u = q @ u
        r = radii[i]; rx, rz = (r if isinstance(r, tuple) else (r, r))
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            p = pts[i] + s * math.cos(a) * rx + u * math.sin(a) * rz
            ring.append(av(p, col_fn(acc[i] / total, math.sin(a), p), w_fn(acc[i] / total, p)))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(sides):
            a, b = rings[i][k], rings[i][(k + 1) % sides]
            c, d = rings[i + 1][(k + 1) % sides], rings[i + 1][k]
            af([a, d, c, b], mat, smooth)
    if cap1:
        ce = av(pts[-1] + tans[-1] * tip, col_fn(1.0, 0.0, pts[-1]), w_fn(1.0, pts[-1]))
        for k in range(sides): af([rings[-1][(k + 1) % sides], rings[-1][k], ce], mat, smooth)
    if cap0:
        cs = av(pts[0], col_fn(0.0, 0.0, pts[0]), w_fn(0.0, pts[0]))
        for k in range(sides): af([rings[0][k], rings[0][(k + 1) % sides], cs], mat, smooth)
    return total

def sphere(center, r, col, w, mat=0, sides=12, rings=8, scale=(1, 1, 1)):
    c = Vector(center); pts, rad = [], []
    for i in range(rings + 1):
        x = -r + 2 * r * i / rings
        rr = math.sqrt(max(r * r - x * x, 0.0)) or 1e-4
        pts.append(c + Vector((0, x * scale[1], 0))); rad.append((rr * scale[0], rr * scale[2]))
    tube(pts, rad, sides, lambda t, up, p: col, lambda t, p: w, mat, True, False, False)

def cone(base, direction, length, r0, col_fn, w, sides=6, mat=0, bend=Vector((0, 0, 0)), segs=4, flat=1.0):
    base = Vector(base); d = Vector(direction).normalized()
    pts = [base + d * length * (i / segs) + bend * (i / segs) ** 2 for i in range(segs + 1)]
    rad = [(max(r0 * (1 - i / segs) ** 0.9, 0.004), max(r0 * flat * (1 - i / segs) ** 0.9, 0.004)) for i in range(segs + 1)]
    tube(pts, rad, sides, col_fn, (lambda t, p: w) if isinstance(w, dict) else w, mat, True, True, True, tip=0.02)

# ---------------- 尺寸（定稿） ----------------
SEG, NSEG = 0.4, 40            # 龙身 16 m = 40 节 × 0.4 m；头 2 m；合计全长 18 m
BODY_LEN = SEG * NSEG
def body_r(y):
    if y < 3.0: r = 0.62 + 0.13 * sstep(0.0, 3.0, y)          # 颈部 1.24 m → 胸部 1.5 m
    elif y < 5.0: r = 0.75                                     # 胸径 1.5 m
    else:
        s = (y - 5.0) / (BODY_LEN - 5.0); r = 0.09 + 0.66 * (1 - s) ** 1.15
    return r
def spine_w(y):
    f = y / SEG - 0.5
    if f <= 0: return {'spine_00': 1.0}
    if f >= NSEG - 1: return {'spine_%02d' % (NSEG - 1): 1.0}
    i = int(math.floor(f)); a = f - i
    return {'spine_%02d' % i: 1 - a, 'spine_%02d' % (i + 1): a}
HEAD = {'head': 1.0}; JAW = {'jaw': 1.0}

# ---------------- 龙身 ----------------
def body_col(t, up, p):
    y = p[1]; tl = y / BODY_LEN
    if up < 0: c = mix(SIDE, BELLY, sstep(0.05, 0.75, -up))
    else: c = mix(SIDE, BACK, sstep(0.0, 0.7, up))
    c = mul(c, 1.0 - 0.30 * tl * (1.0 if up > -0.3 else 0.4))   # 由头到尾逐渐变暗
    if up >= -0.45:                                              # 侧背鳞片：错位棋盘明暗
        ring = int(round(y / 0.1)); ang = math.atan2(p[2], p[0]); k = int(round(ang / (2 * math.pi / 24)))
        if (ring + k) % 2 == 0: c = mul(c, 0.84)
    if up < -0.45 and int(y / 0.2) % 2 == 1: c = mul(c, 0.86)   # 横向腹甲
    if up < -0.45 and int(y / 0.2) % 2 == 0 and abs((y % 0.2) - 0.1) > 0.085: c = mix(c, BRONZE, 0.5)
    return c
ys = [i * 0.1 for i in range(int(BODY_LEN / 0.1) + 1)]
tube([(0, y, 0) for y in ys], [(body_r(y), body_r(y) * 0.93) for y in ys], 24,
     body_col, lambda t, p: spine_w(p[1]), cap0=True, cap1=True, tip=0.0)

# 背鳍：向后勾的波浪形刺，0.5 m → 0.15 m，颈到尾
def fin(y, h):
    z0 = body_r(y) * 0.93 - 0.04
    blade = [(-0.22, 0.00), (-0.14, 0.40), (0.02, 0.80), (0.38, 1.05), (0.20, 0.72), (0.16, 0.40), (0.22, 0.00)]
    th = 0.035 + 0.03 * h
    ids = []
    for side in (-1, 1):
        for (dy, dz) in blade:
            ty = dz
            col = mix(BRONZE, SIDE, sstep(0.3, 1.0, ty))
            ids.append(av((side * th * (1 - 0.8 * ty), y + dy * (0.6 + h), z0 + dz * h), col, spine_w(y + dy)))
    n = len(blade)
    L_, R_ = ids[:n], ids[n:]
    # 前后两面（简单扇形三角化）+ 边缘
    for i in range(1, n - 1):
        af([L_[0], L_[i], L_[i + 1]], 0, False); af([R_[0], R_[i + 1], R_[i]], 0, False)
    for i in range(n):
        j = (i + 1) % n; af([L_[i], R_[i], R_[j], L_[j]], 0, False)
y = 0.5
while y < BODY_LEN - 1.6:
    h = 0.5 + (0.15 - 0.5) * (y / (BODY_LEN - 1.6)); fin(y, h); y += 0.42

# 尾穗：末端 2 m，向后散开的飘带状鳍
for k, (ang, ln) in enumerate([(90, 1.7), (60, 1.5), (120, 1.5), (30, 1.3), (150, 1.3), (0, 1.0), (180, 1.0), (-40, 0.8), (220, 0.8)]):
    a = math.radians(ang); y0 = BODY_LEN - 1.0 + 0.07 * k
    base = Vector((math.cos(a) * body_r(y0) * 0.8, y0, math.sin(a) * body_r(y0) * 0.8))
    d = Vector((math.cos(a) * 0.55, 1.0, math.sin(a) * 0.55))
    cone(base, d, ln, 0.22, lambda t, up, p: mix(SIDE, WHITE, sstep(0.35, 1.0, t)),
         lambda t, p: spine_w(min(p[1], BODY_LEN)), sides=5, flat=0.35,
         bend=Vector((math.cos(a) * 0.2, 0.2, math.sin(a) * 0.2 - 0.25)), segs=6)

# 退化小爪两对（≤ 0.3 m，贴腹）
for yc in (2.4, 8.4):
    for sx in (-1, 1):
        r = body_r(yc)
        root = Vector((sx * r * 0.62, yc, -r * 0.62))
        leg_end = root + Vector((sx * 0.08, 0.06, -0.12))
        tube([root, leg_end], [0.09, 0.07], 8, lambda t, up, p: BRONZE, lambda t, p: spine_w(yc), cap1=False)
        for toe in (-1, 0, 1):
            cone(leg_end, (sx * 0.4 + toe * 0.25, -0.5 + abs(toe) * 0.2, -0.8), 0.14, 0.03,
                 lambda t, up, p: mix(BRONZE, SIDE, t * 0.6), spine_w(yc), sides=5)

# ---------------- 龙头（2 m，朝 -Y） ----------------
def head_col(t, up, p):
    c = mix(SIDE, BELLY, sstep(0.0, 0.8, -up)) if up < 0 else mix(SIDE, BACK, sstep(0.3, 1.0, up) * 0.6)
    return c
skull = [(0.25, 0.66, 0.60, 0.00), (0.0, 0.68, 0.62, 0.03), (-0.35, 0.66, 0.60, 0.07), (-0.70, 0.56, 0.46, 0.08),
         (-1.00, 0.44, 0.33, 0.03), (-1.35, 0.38, 0.26, -0.01), (-1.70, 0.35, 0.24, 0.01), (-1.90, 0.29, 0.20, 0.02),
         (-2.00, 0.16, 0.12, 0.01)]
tube([(0, y, zc) for (y, rx, rz, zc) in skull], [(rx, rz) for (y, rx, rz, zc) in skull], 20, head_col,
     lambda t, p: HEAD, cap1=True, tip=0.02)
# 下颌
jaw = [(-0.35, 0.40, 0.16, -0.36), (-0.8, 0.36, 0.13, -0.33), (-1.3, 0.30, 0.10, -0.30), (-1.75, 0.24, 0.08, -0.27),
       (-1.95, 0.14, 0.06, -0.26)]
tube([(0, y, zc) for (y, rx, rz, zc) in jaw], [(rx, rz) for (y, rx, rz, zc) in jaw], 14,
     lambda t, up, p: mix(SIDE, BELLY, sstep(-0.2, 0.6, -up)), lambda t, p: JAW, cap0=True, cap1=True)
# 眉骨
for sx in (-1, 1):
    tube([(sx * 0.36, -1.10, 0.24), (sx * 0.44, -0.86, 0.36), (sx * 0.44, -0.55, 0.46), (sx * 0.48, -0.15, 0.62)],
         [0.06, 0.10, 0.09, 0.02], 8, lambda t, up, p: mix(mix(SIDE, BACK, 0.4), WHITE, sstep(0.6, 1.0, t)), lambda t, p: HEAD, cap0=True, tip=0.05)
    for j in range(3):                                            # 脸颊鳍（向后的扇形鳍片）
        cone((sx * 0.50, -0.55 + 0.18 * j, -0.10 - 0.08 * j), (sx * 0.55, 1.0, -0.15 + 0.2 * j), 0.65 - 0.12 * j, 0.14,
             lambda t, up, p: mix(SIDE, WHITE, sstep(0.4, 1.0, t)), HEAD, sides=5, flat=0.3, segs=4)
    # 眼（月白青，自发光材质）+ 眼睑
    sphere((sx * 0.40, -0.90, 0.20), 0.085, L('#1F2A27'), HEAD, mat=1, sides=10, rings=6)
    sphere((sx * 0.405, -0.90, 0.255), 0.095, SIDE, {'eyelid_%s' % ('L' if sx > 0 else 'R'): 1.0},
           sides=10, rings=6, scale=(1.05, 1.0, 0.55))
    # 鼻孔
    sphere((sx * 0.13, -1.93, 0.17), 0.045, DARK, HEAD, sides=8, rings=4)
    # 獠牙（上下各一对）+ 小牙
    cone((sx * 0.25, -1.72, -0.20), (sx * 0.1, -0.15, -1), 0.24, 0.045, lambda t, up, p: WHITE, HEAD, sides=6)
    cone((sx * 0.20, -1.62, -0.28), (sx * 0.05, -0.1, 1), 0.17, 0.035, lambda t, up, p: WHITE, JAW, sides=6)
    for k in range(4):
        cone((sx * (0.30 - 0.02 * k), -1.45 + 0.22 * k, -0.20), (0, 0, -1), 0.08, 0.022, lambda t, up, p: WHITE, HEAD, sides=5)

# 鹿角：1.2 m，青铜到旧金，三叉
def antler_col(t, up, p): return mix(BRONZE, OLDGOLD, sstep(0.45, 1.0, t))
for sx in (-1, 1):
    b = Vector((sx * 0.30, -0.42, 0.50))
    main = [b, b + Vector((sx * 0.08, 0.10, 0.30)), b + Vector((sx * 0.20, 0.28, 0.62)), b + Vector((sx * 0.30, 0.52, 0.88)),
            b + Vector((sx * 0.34, 0.80, 1.02))]
    ln = tube(main, [0.075, 0.065, 0.05, 0.035, 0.012], 8, antler_col, lambda t, p: HEAD, tip=0.03)
    cone(main[1] + Vector((0, 0.02, 0.05)), (sx * 0.15, -0.55, 0.85), 0.42, 0.04, lambda t, up, p: antler_col(0.5 + t * 0.5, up, p), HEAD, sides=6)
    cone(main[2] + Vector((0, 0.02, 0.04)), (sx * 0.35, -0.25, 0.9), 0.34, 0.032, lambda t, up, p: antler_col(0.6 + t * 0.4, up, p), HEAD, sides=6)
    cone(main[3], (sx * 0.1, -0.2, 1.0), 0.24, 0.024, lambda t, up, p: antler_col(0.7 + t * 0.3, up, p), HEAD, sides=6)

# 白须：两条主须各约 3 m，自然下垂，每条 6 节骨
WHISKER_PTS = {}
for sx, tag in ((1, 'L'), (-1, 'R')):
    pts = []
    for i in range(31):
        s = i / 30
        pts.append(Vector((sx * (0.36 + 0.75 * s ** 0.6 + 0.18 * math.sin(math.pi * s * 3)), -1.62 + 1.75 * s, -0.04 - 1.45 * s ** 1.3 + 0.28 * math.sin(math.pi * s * 2.2))))
    WHISKER_PTS[tag] = pts
    def ww(t, p, tag=tag):
        f = min(t * 6, 5.999); i = int(f); a = f - i
        d = {'whisker_%s_%02d' % (tag, i + 1): 1 - a}
        if i + 2 <= 6: d['whisker_%s_%02d' % (tag, i + 2)] = a
        else: d = {'whisker_%s_06' % tag: 1.0}
        return d
    tube(pts, [0.05 * (1 - 0.85 * (i / 30) ** 0.8) for i in range(31)], 6, lambda t, up, p: mix(WHITE, mul(WHITE, 0.92), t), ww, tip=0.02)
# 颔下短须
for k in range(5):
    x = (k - 2) * 0.07
    cone((x, -1.15 + abs(k - 2) * 0.12, -0.42), (x, 0.35, -1), 0.55 - abs(k - 2) * 0.08, 0.05,
         lambda t, up, p: WHITE, JAW, sides=5, bend=Vector((0, 0.15, 0)))

# 鬃毛：后脑一圈火苗状鬃簇，向后炸开 0.8 m，6 根鬃骨
MANE = []
NM = 16
for layer in (0, 1):
    for k in range(NM):
        ang = math.radians(-120 + 240 * k / (NM - 1)) + layer * math.radians(7)
        out = Vector((math.sin(ang), 0, math.cos(ang)))
        dirv = Vector((out.x * 0.55, 1.0, out.z * 0.45 + 0.35))
        base = Vector((out.x * (0.58 - 0.05 * layer), -0.30 + 0.32 * layer, 0.06 + out.z * (0.52 - 0.04 * layer)))
        bone = 'mane_%02d' % (k * 6 // NM + 1)
        MANE.append((base, dirv, bone))
        ln = (0.8 if layer == 0 else 0.62) * (0.85 + 0.15 * math.cos(ang))
        cone(base, dirv, ln, 0.17, lambda t, up, p: mix(mix(SIDE, BACK, 0.3), WHITE, sstep(0.3, 1.0, t)),
             {bone: 1.0}, sides=5, flat=0.35, bend=Vector((out.x * 0.12, 0.05, 0.22)), segs=5)

# ---------------- 生成网格对象 ----------------
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
me = bpy.data.meshes.new('DragonKing')
me.from_pydata(V, [], F); me.update()
me.polygons.foreach_set('use_smooth', FS)
me.polygons.foreach_set('material_index', FM)
attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
for i, c in enumerate(C): attr.data[i].color = c
obj = bpy.data.objects.new('DragonKing', me); bpy.context.scene.collection.objects.link(obj)

def make_mat(name, emissive=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.55; bs.inputs['Metallic'].default_value = 0.15
    if emissive:
        bs.inputs['Emission Color'].default_value = emissive; bs.inputs['Emission Strength'].default_value = 0.3
    return m
me.materials.append(make_mat('DK_Body'))
me.materials.append(make_mat('DK_Eye_Glow', emissive=MOON))   # 发光强度 0.3 = 一阶段三成；二阶段改 0.45

# ---------------- 骨骼 ----------------
arm = bpy.data.armatures.new('DragonKingRig'); rig = bpy.data.objects.new('DragonKingRig', arm)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = arm.edit_bones
prev = None
for i in range(NSEG):
    b = eb.new('spine_%02d' % i); b.head = (0, i * SEG, 0); b.tail = (0, (i + 1) * SEG, 0); b.roll = 0
    if prev: b.parent = prev; b.use_connect = True
    prev = b
hb = eb.new('head'); hb.head = (0, 0, 0); hb.tail = (0, -2.0, 0); hb.parent = eb['spine_00']
jb = eb.new('jaw'); jb.head = (0, -0.35, -0.30); jb.tail = (0, -1.9, -0.28); jb.parent = hb
for sx, tag in ((1, 'L'), (-1, 'R')):
    e = eb.new('eyelid_' + tag); e.head = (sx * 0.40, -0.90, 0.20); e.tail = (sx * 0.40, -0.90, 0.34); e.parent = hb
    pts = WHISKER_PTS[tag]; p = hb
    for k in range(6):
        w = eb.new('whisker_%s_%02d' % (tag, k + 1)); w.head = pts[k * 5]; w.tail = pts[min(k * 5 + 5, 30)]
        w.parent = p; w.use_connect = k > 0; p = w
for k in range(6):
    base, dirv, _ = MANE[min(k * NM // 6, NM - 1)]
    m = eb.new('mane_%02d' % (k + 1)); m.head = base; m.tail = base + dirv.normalized() * 0.8; m.parent = hb
bpy.ops.object.mode_set(mode='OBJECT')

for name in [b.name for b in arm.bones]: obj.vertex_groups.new(name=name)
for vi, wd in enumerate(W):
    for g, w in wd.items():
        if w > 1e-4: obj.vertex_groups[g].add([vi], w, 'REPLACE')
obj.parent = rig
mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

tri = sum(len(f) - 2 for f in F)
print('DK_STATS verts=%d tris=%d bones=%d' % (len(V), tri, len(arm.bones)))

# ---------------- 先保存 .blend 并导出 glb（直身静置姿态） ----------------
bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = os.path.join(OUT, 'dragon_king_v1.glb')
try:
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True,
                              export_skins=True, export_animations=False)
except TypeError:
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True)
print('DK_GLB', glb, os.path.getsize(glb))

# ---------------- 渲染场景 ----------------
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
    try: sc.render.engine = eng; break
    except TypeError: pass
try: sc.view_settings.view_transform = 'Standard'
except Exception: pass
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
sc.render.film_transparent = False
world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']

def light(name, kind, loc, rot, energy, size=None, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if size and kind == 'AREA': ld.size = size
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.location = loc; lo.rotation_euler = rot
    return lo
light('Key', 'SUN', (0, 0, 20), (math.radians(40), math.radians(-20), math.radians(-30)), 3.2)
light('Rim', 'SUN', (0, 0, 20), (math.radians(-60), math.radians(10), math.radians(160)), 2.0, color=(0.75, 0.9, 1.0))

cam_d = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
def look_at(o, target):
    d = Vector(target) - o.location; o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def mat_flat(name, hexc, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = L(hexc); bs.inputs['Roughness'].default_value = 0.8
    if emit: bs.inputs['Emission Color'].default_value = L(hexc); bs.inputs['Emission Strength'].default_value = emit
    return m
def add_box(name, loc, size, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object; o.name = name
    o.scale = size; o.data.materials.append(m); return o
def add_cyl(name, loc, r, d, m):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, location=loc, vertices=32); o = bpy.context.active_object
    o.name = name; o.data.materials.append(m); return o

def frame(direction, lens=35, pad=1.12, target_bias=(0, 0, 0)):
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg)
    pts = [ev.matrix_world @ v.co for v in ev.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2 + Vector(target_bias); r = (hi - lo).length / 2
    cam_d.type = 'PERSP'; cam_d.lens = lens
    fov = 2 * math.atan(18 / lens) * 0.5625 * 1.6
    dist = r * pad / math.tan(fov / 2)
    cam.location = c + Vector(direction).normalized() * dist; look_at(cam, c)
def render(path):
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); print('DK_RENDER', path)

pb = rig.pose.bones
def reset_pose():
    for b in pb: b.rotation_mode = 'XYZ'; b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0)

def swim_pose(open_jaw=0.0):
    reset_pose()
    for i in range(NSEG):
        b = pb['spine_%02d' % i]; s = i / NSEG
        yaw = 0.24 * math.sin(2 * math.pi * s * 1.25 + 0.5)
        pitch = (-0.05 if i < 8 else 0.0) + (0.025 if 8 <= i < 22 else 0.0) + 0.03 * math.sin(2 * math.pi * s * 1.2)
        b.rotation_euler = (pitch, 0, yaw)
    pb['head'].rotation_euler = (math.radians(-12), 0, math.radians(8))
    pb['jaw'].rotation_euler = (open_jaw, 0, 0)
    for tag in 'LR':
        for k in range(6):
            pb['whisker_%s_%02d' % (tag, k + 1)].rotation_euler = (0.30 * math.sin(k * 1.3 + 0.4), 0, 0.25 * math.cos(k * 1.1))
    for k in range(6): pb['mane_%02d' % (k + 1)].rotation_euler = (0.12 * math.sin(k), 0, 0)

# 1) 主视图：游动姿态（浅色背景）
bg.inputs[0].default_value = L('#DCE2E7'); bg.inputs[1].default_value = 0.9
swim_pose(open_jaw=0.0)
rig.location = (0, 0, 3.0)
frame((-0.9, -0.55, 0.85), lens=35, pad=0.95)
render(os.path.join(OUT, 'render_01_swim_light.png'))

# 2) 头部特写：张口
swim_pose(open_jaw=math.radians(24))
hm = rig.matrix_world @ pb['head'].matrix
hc = hm @ Vector((0, 1.0, -0.1))
cam_d.type = 'PERSP'; cam_d.lens = 50
cam_d.lens = 42; cam.location = hc + Vector((-5.6, -6.0, 2.2)); look_at(cam, hc + Vector((0, 0.3, 0.35)))
render(os.path.join(OUT, 'render_02_head_closeup.png'))

# 3) 同一姿态放进深海配色看可读性
bg.inputs[0].default_value = L('#0D1E33'); bg.inputs[1].default_value = 1.0
swim_pose(open_jaw=0.0)
frame((-0.9, -0.55, 0.85), lens=35, pad=0.95)
render(os.path.join(OUT, 'render_03_swim_deepsea.png'))

# 4) 直身静置侧视 + 尺寸参照（哪吒 1.65 m 红柱，风火轮离地 1.15 m；涡面 z=0；龙身下沿离涡面 2 m）
bg.inputs[0].default_value = L('#DCE2E7'); bg.inputs[1].default_value = 0.9
reset_pose(); rig.location = (0, 0, 2.75)
floor = add_box('Floor', (0, 8, -0.05), (6, 26, 0.1), mat_flat('Floor', '#9AA6AE'))
nz = add_box('NezhaRef', (2.5, -4.0, 1.15 + 0.825), (0.45, 0.3, 1.65), mat_flat('NezhaRed', '#B8261C'))
wheel = add_cyl('WheelRef', (2.5, -4.0, 1.15), 0.42, 0.06, mat_flat('Wheel', '#FFA531', 1.0))
ticks = mat_flat('Tick', '#2A3036')
for m in range(0, 19):
    add_box('Tick%d' % m, (3.4, -2.0 + m, 0.02), (0.06 if m % 5 else 0.12, 0.06, 0.04 if m % 5 else 0.08), ticks)
cam_d.type = 'ORTHO'; cam_d.ortho_scale = 23.0
cam.location = (30, 6.0, 3.0); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
render(os.path.join(OUT, 'render_04_side_scale.png'))
for o in (floor, nz, wheel): o.hide_render = True
for o in bpy.data.objects:
    if o.name.startswith('Tick'): o.hide_render = True

# 5) 俯视：看整体剪影
cam_d.type = 'PERSP'; cam_d.lens = 30
swim_pose(); rig.location = (0, 0, 0)
frame((0.0, 0.001, 1.0), lens=35, pad=0.9)
render(os.path.join(OUT, 'render_05_top_silhouette.png'))

reset_pose(); rig.location = (0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'dragon_king_v1.blend'))
print('DK_DONE')
