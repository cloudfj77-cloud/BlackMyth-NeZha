# 《白神话：哪吒》哪吒 · Blender 生成脚本 v2（资产轨）
# 用法：Blender --background --factory-startup --python build_nezha_v2.py -- <输出目录> [test]
#
# v2 相对 v1（老板 11-06 21:59）：
#   1. 红缨加一倍（24 缕、0.68 m），在枪头后面飘；火尖枪加长一倍（2.4 → 4.8 m，握点距枪尾 1.5 m）
#   2. 风火轮竖起来、绕横轴转动（和玩法轨 v1.4.0 关节哪吒一致）
#   3. 浮动幅度和龙一样（±2 m、4.5 s 一个周期），叠在玩法轨现有战斗动作上
#
# 骨架与玩法轨对齐：关节名、父子关系、位置 = nezha-boss/assets/nezha-rig/rig-def.ts 的 JOINTS × RIG_SCALE(0.86)，
# 每根骨骼都朝上、roll 0 → 导出 glTF 后每个关节的静止旋转为单位四元数，与 v1.4.0 关节坐标系一致：
# 游戏里 poseJoints() 算出的欧拉角（qEuler, XYZ）可以直接写到这些关节上。
# 动作数据（P_IDLE、LIGHT_KF、HEAVY_KF、ROLL_TUCK…）、时长（machine.ts 的 hit / recover 步数）、混合速率、
# 悬浮层（HOVER_PROFILES、legs()）、风火轮抵消腿弯与转动，全部照 rig.pack.ts 的写法复刻。
import bpy, bmesh, math, sys, os, subprocess
from mathutils import Vector, Matrix, Quaternion

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else '/tmp/nezha2'
TEST = len(args) > 1 and args[1] == 'test'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(OUT.rstrip('/')))

def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)
def mix(a, b, t):
    t = max(0.0, min(1.0, t)); return tuple(a[i] * (1 - t) + b[i] * t for i in range(4))
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k, 1.0)
def sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def norm_w(d):
    t = sum(d.values()) or 1.0; return {k: v / t for k, v in d.items() if v > 1e-4}

RED, GOLD, LOTUS, ORANGE = L('#B8261C'), L('#D4A03A'), L('#F2ECE0'), L('#FF7A1A')
SKIN, HAIR, DARK, LACQ, LIP = L('#E6BE98'), L('#1B1615'), L('#231A18'), L('#3A1A16'), L('#9A4A3C')
DEEPRED = L('#7E1410')

# ---------------- 网格累加器（同 v1） ----------------
class B:
    def __init__(s): s.V, s.C, s.W, s.F, s.FM = [], [], [], [], []
    def av(s, p, c, w): s.V.append(tuple(p)); s.C.append(c); s.W.append(w); return len(s.V) - 1
    def af(s, idx, m=0): s.F.append(idx); s.FM.append(m)
    def tube(s, pts, radii, sides, col, w, m=0, cap0=True, cap1=True, up=Vector((0, -1, 0)), tip=0.0):
        pts = [Vector(p) for p in pts]; n = len(pts)
        cf = col if callable(col) else (lambda t, sv, p: col)
        wf = w if callable(w) else (lambda t, p: w)
        tans = []
        for i in range(n):
            t = (pts[1] - pts[0]) if i == 0 else (pts[-1] - pts[-2]) if i == n - 1 else (pts[i + 1] - pts[i - 1])
            tans.append(t.normalized())
        sv_ = tans[0].cross(up)
        if sv_.length < 1e-4: sv_ = tans[0].cross(Vector((1, 0, 0)))
        sv_.normalize(); u = sv_.cross(tans[0]).normalized()
        acc = [0.0]
        for i in range(1, n): acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
        tot = acc[-1] or 1.0; rings = []
        for i in range(n):
            if i > 0:
                q = tans[i - 1].rotation_difference(tans[i]); sv_ = q @ sv_; u = q @ u
            r = radii[i]; rx, rz = (r if isinstance(r, tuple) else (r, r)); ring = []
            for k in range(sides):
                a = 2 * math.pi * k / sides; p = pts[i] + sv_ * math.cos(a) * rx + u * math.sin(a) * rz
                ring.append(s.av(p, cf(acc[i] / tot, math.sin(a), p), wf(acc[i] / tot, p)))
            rings.append(ring)
        for i in range(n - 1):
            for k in range(sides):
                s.af([rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % sides], rings[i][(k + 1) % sides]], m)
        if cap1:
            c = s.av(pts[-1] + tans[-1] * tip, cf(1.0, 0, pts[-1]), wf(1.0, pts[-1]))
            for k in range(sides): s.af([rings[-1][k], rings[-1][(k + 1) % sides], c], m)
        if cap0:
            c = s.av(pts[0], cf(0.0, 0, pts[0]), wf(0.0, pts[0]))
            for k in range(sides): s.af([rings[0][(k + 1) % sides], rings[0][k], c], m)
    def sphere(s, c, r, col, w, m=0, scale=(1, 1, 1), sides=12, rings=8):
        c = Vector(c); pts, rad = [], []
        for i in range(rings + 1):
            x = -r + 2 * r * i / rings; rr = max(math.sqrt(max(r * r - x * x, 0)), 1e-4)
            pts.append(c + Vector((0, 0, x * scale[2]))); rad.append((rr * scale[0], rr * scale[1]))
        s.tube(pts, rad, sides, col, w, m, False, False)
    def cone(s, base, d, ln, r0, col, w, m=0, sides=6, flat=1.0, bend=Vector((0, 0, 0)), segs=4):
        base = Vector(base); d = Vector(d).normalized()
        pts = [base + d * ln * i / segs + bend * (i / segs) ** 2 for i in range(segs + 1)]
        rad = [(max(r0 * (1 - i / segs) ** 0.8, 0.002), max(r0 * flat * (1 - i / segs) ** 0.8, 0.002)) for i in range(segs + 1)]
        s.tube(pts, rad, sides, col, w, m, True, True, tip=0.004)
    def torus(s, c, axis, R, r, col, w, m=0, seg=24, sides=6):
        c = Vector(c); ax = Vector(axis).normalized(); a1 = ax.orthogonal().normalized(); a2 = ax.cross(a1)
        cf = col if callable(col) else (lambda t, sv, p: col); grid = []
        for i in range(seg):
            th = 2 * math.pi * i / seg; d = a1 * math.cos(th) + a2 * math.sin(th); ring = []
            for j in range(sides):
                ph = 2 * math.pi * j / sides; p = c + d * (R + r * math.cos(ph)) + ax * r * math.sin(ph)
                ring.append(s.av(p, cf(i / seg, math.sin(ph), p), w))
            grid.append(ring)
        for i in range(seg):
            for j in range(sides):
                s.af([grid[i][j], grid[(i + 1) % seg][j], grid[(i + 1) % seg][(j + 1) % sides], grid[i][(j + 1) % sides]], m)
    def ribbon(s, pts, widths, wdirs, col, w, m=0, cols=4):
        n = len(pts); acc = [0.0]
        for i in range(1, n): acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
        tot = acc[-1] or 1.0; grid = []
        for i in range(n):
            row = []
            for c in range(cols + 1):
                v = c / cols - 0.5; p = pts[i] + wdirs[i] * widths[i] * v
                row.append(s.av(p, col(acc[i] / tot, v, p), w(acc[i] / tot, p)))
            grid.append(row)
        for i in range(n - 1):
            for c in range(cols): s.af([grid[i][c], grid[i][c + 1], grid[i + 1][c + 1], grid[i + 1][c]], m)

# ---------------- 玩法轨关节（rig-def.ts JOINTS，rig 单位）→ Blender 米 ----------------
RS = 0.86
JOINTS = [  # name, parent, pos (three.js：x 左, y 上, z 前)
    ('hips', None, (0, 1.22, 0)), ('torso', 'hips', (0, 0.07, 0)), ('head', 'torso', (0, 0.56, 0.01)),
    ('rS', 'torso', (-0.25, 0.39, 0)), ('rE', 'rS', (0, -0.29, 0)), ('rH', 'rE', (0, -0.27, 0)), ('staffPivot', 'rH', (0, 0, 0)),
    ('lS', 'torso', (0.25, 0.39, 0)), ('lE', 'lS', (0, -0.29, 0)), ('lH', 'lE', (0, -0.27, 0)),
    ('lHip', 'hips', (0.1, -0.05, 0)), ('lK', 'lHip', (0, -0.4, 0)), ('lMount', 'lK', (0, -0.53, 0.02)), ('lWheel', 'lMount', (0, 0, 0)),
    ('rHip', 'hips', (-0.1, -0.05, 0)), ('rK', 'rHip', (0, -0.4, 0)), ('rMount', 'rK', (0, -0.53, 0.02)), ('rWheel', 'rMount', (0, 0, 0)),
]
def t2b(v): return Vector((v[0], -v[2], v[1]))           # three.js → Blender（人物朝 -Y）
JP = {}
for n, p, pos in JOINTS:
    JP[n] = (JP[p] if p else Vector((0, 0, 0))) + t2b(pos) * RS
J = JP
for k in ('hips', 'head', 'rS', 'rE', 'rH', 'lHip', 'lK', 'lMount'):
    print('NZ_JOINT %-6s z=%.3f x=%.3f y=%.3f' % (k, J[k].z, J[k].x, J[k].y))

# ---------------- 身体（按关节位置重排比例，造型沿用 v1） ----------------
body = B()
def torso_col(t, sv, p):
    z = p.z
    if z < 1.07: return LOTUS
    if z < 1.12: return GOLD
    if z < 1.445:
        if z < 1.145 or z > 1.415: return GOLD
        c = mul(RED, 0.82) if int((z - 1.145) / 0.035) % 2 else RED
        if p.y < -0.06:
            d = math.hypot(p.x, z - 1.30)
            if d < 0.030: return GOLD
            if d < 0.054: return LOTUS
            if d < 0.062: return GOLD
        return c
    return SKIN
def torso_w(t, p):
    z = p.z; a = sstep(1.07, 1.15, z); w = {'hips': 1 - a, 'torso': a}
    if z > 1.36 and abs(p.x) > 0.10:
        k = sstep(0.10, 0.16, abs(p.x)) * 0.35 * sstep(1.36, 1.42, z)
        w = {kk: v * (1 - k) for kk, v in w.items()}; w['lS' if p.x > 0 else 'rS'] = k
    return norm_w(w)
rings = [(0.92, 0.112, 0.092, 0.005), (0.98, 0.140, 0.098, 0.0), (1.05, 0.150, 0.102, 0.0), (1.11, 0.128, 0.090, 0.0),
         (1.18, 0.134, 0.092, -0.003), (1.27, 0.146, 0.098, -0.006), (1.36, 0.150, 0.096, -0.004), (1.42, 0.144, 0.084, 0.004),
         (1.46, 0.105, 0.066, 0.01), (1.485, 0.052, 0.048, 0.01)]
zs = []
for i in range(len(rings) - 1):
    for k in range(3): zs.append(tuple(lerp(rings[i][j], rings[i + 1][j], k / 3) for j in range(4)))
zs.append(rings[-1])
body.tube([Vector((0, r[3], r[0])) for r in zs], [(r[1], r[2]) for r in zs], 20, torso_col, torso_w)
body.tube([Vector((0, 0.012, 1.465)), Vector((0, 0.008, 1.50)), Vector((0, 0.004, 1.53))], [0.045, 0.042, 0.041], 12, SKIN,
          lambda t, p: norm_w({'head': t, 'torso': 1 - t}), cap0=False, cap1=False)
HZ = 0.045
head = [(1.415, 0.030, 0.028, -0.045), (1.44, 0.052, 0.055, -0.030), (1.47, 0.066, 0.075, -0.012), (1.51, 0.076, 0.088, -0.002),
        (1.555, 0.083, 0.098, 0.006), (1.60, 0.081, 0.096, 0.012), (1.63, 0.068, 0.082, 0.014), (1.65, 0.040, 0.050, 0.014)]
def head_col(t, sv, p):
    z = p.z - HZ
    if p.y > -0.035 or (z > 1.595 and p.y > -0.075) or z > 1.618 or (abs(p.x) > 0.07 and z > 1.53 and p.y > -0.06): return HAIR
    return SKIN
def HP(x, y, z): return Vector((x, y, z + HZ))
body.tube([HP(0, h[3], h[0]) for h in head], [(h[1], h[2]) for h in head], 18, head_col, {'head': 1.0})
HW = {'head': 1.0}
for sx in (1, -1):
    body.sphere(HP(sx * 0.033, -0.082, 1.546), 0.013, DARK, HW, scale=(1.5, 0.55, 0.8), sides=8, rings=4)
    body.tube([HP(sx * 0.016, -0.088, 1.566), HP(sx * 0.036, -0.087, 1.571), HP(sx * 0.056, -0.080, 1.578)], [0.006, 0.007, 0.004], 6, HAIR, HW)
    body.sphere(HP(sx * 0.083, 0.0, 1.535), 0.022, SKIN, HW, scale=(0.45, 0.9, 1.2), sides=8, rings=4)
    body.sphere(HP(sx * 0.068, 0.012, 1.645), 0.074, HAIR, HW, sides=14, rings=10)
    body.torus(HP(sx * 0.060, 0.012, 1.598), (sx * 0.35, 0, 1), 0.050, 0.009, GOLD, HW, sides=6)
    fc = HP(sx * 0.118, -0.035, 1.672)
    for k in range(6):
        a = 2 * math.pi * k / 6
        body.cone(fc, Vector((math.cos(a) * 0.55 * sx, -0.75, math.sin(a) * 0.9 + 0.1)), 0.04, 0.014,
                  lambda t, sv, p: mix(RED, LOTUS, t * 1.2), HW, sides=5, flat=0.4)
    body.sphere(fc, 0.011, GOLD, HW, sides=8, rings=4)
body.sphere(HP(0, -0.092, 1.592), 0.009, RED, HW, scale=(0.6, 0.4, 1.5), sides=8, rings=4)
body.cone(HP(0, -0.088, 1.538), (0, -1, -0.5), 0.018, 0.012, SKIN, HW, sides=6)
body.tube([HP(-0.017, -0.081, 1.489), HP(0, -0.084, 1.488), HP(0.017, -0.081, 1.489)], [0.0035] * 3, 6, LIP, HW)

# 手臂：静置垂直下垂（与 v1.4.0 关节一致）
for t, sx in (('l', 1), ('r', -1)):
    S_, E_, H_ = J[t + 'S'], J[t + 'E'], J[t + 'H']
    def aw(tt, p, t=t):
        z = p.z; e = sstep(E_.z - 0.035, E_.z + 0.035, z)
        top = 0.3 * sstep(S_.z - 0.06, S_.z + 0.02, z)
        return norm_w({t + 'E': 1 - e, t + 'S': e * (1 - top), 'torso': e * top})
    pts = [Vector((S_.x, 0, S_.z + 0.01 - (S_.z + 0.01 - H_.z - 0.02) * k / 8)) for k in range(9)]
    body.tube(pts, [0.047, 0.045, 0.042, 0.039, 0.037, 0.039, 0.036, 0.032, 0.029], 12, SKIN, aw, cap0=False, up=Vector((0, -1, 0)))
    def bracer(tt, sv, p):
        if tt < 0.08 or tt > 0.92: return GOLD
        if 0.42 < tt < 0.58: return LOTUS if sv > -0.2 else GOLD
        return RED
    body.tube([Vector((E_.x, 0, lerp(E_.z, H_.z, 0.38 + 0.6 * k / 5))) for k in range(6)], [0.047, 0.046, 0.044, 0.042, 0.040, 0.038],
              12, bracer, {t + 'E': 1.0}, up=Vector((0, -1, 0)))
    if t == 'r':
        body.torus(Vector((E_.x, 0, lerp(E_.z, H_.z, 0.18))), (0, 0, 1), 0.060, 0.012, GOLD, {'rE': 1.0}, m=1, seg=28, sides=8)
    body.sphere(Vector((H_.x, -0.005, H_.z - 0.025)), 0.048, SKIN, {t + 'H': 1.0}, scale=(0.75, 1.0, 1.15), sides=12, rings=8)
    body.sphere(S_ + Vector((sx * 0.01, 0, 0.012)), 0.078, lambda tt, sv, p: GOLD if (p.z - S_.z) < -0.025 else RED,
                norm_w({t + 'S': 0.65, 'torso': 0.35}), scale=(1.15, 1.0, 0.72), sides=14, rings=8)

# 腿：大腿（lHip）、小腿 + 赤足（lK，v1.4.0 没有踝关节，脚随小腿）
for t, sx in (('l', 1), ('r', -1)):
    Hp, K_ = J[t + 'Hip'], J[t + 'K']
    ank = Vector((K_.x, 0.0, 0.36))
    def lw(tt, p, t=t, K_=K_):
        k = sstep(K_.z - 0.04, K_.z + 0.04, p.z); hp = 0.35 * sstep(Hp.z - 0.06, Hp.z + 0.03, p.z)
        return norm_w({t + 'K': 1 - k, t + 'Hip': k * (1 - hp), 'hips': k * hp})
    pts = [lerp(Hp + Vector((0, 0, 0.02)), K_, k / 4) for k in range(4)] + [lerp(K_, ank, k / 4) for k in range(5)]
    body.tube(pts, [0.072, 0.068, 0.062, 0.057, 0.052, 0.055, 0.049, 0.040, 0.033], 12, SKIN, lw, cap0=False)
    def shorts(tt, sv, p):
        if tt > 0.9: return RED
        if 0.84 < tt < 0.88: return GOLD
        return LOTUS
    body.tube([lerp(Vector((sx * 0.078, 0, 1.05)), lerp(Hp, K_, 0.75), k / 5) for k in range(6)], [0.090, 0.090, 0.087, 0.084, 0.080, 0.077],
              14, shorts, lambda tt, p, t=t: norm_w({t + 'Hip': 0.55 + 0.45 * tt, 'hips': 0.45 * (1 - tt)}), cap0=False, cap1=False)
    he, to = Vector((K_.x, 0.05, 0.325)), Vector((K_.x + sx * 0.01, -0.13, 0.30))
    body.tube([he, lerp(he, to, 0.45), lerp(he, to, 0.8), to], [(0.036, 0.030), (0.044, 0.028), (0.045, 0.020), (0.028, 0.013)],
              10, SKIN, {t + 'K': 1.0}, up=Vector((0, 0, 1)))

# 莲瓣甲裙 + 铃铛流苏
for k in range(8):
    a = 2 * math.pi * (k + 0.5) / 8
    top = Vector((0.148 * math.cos(a), 0.104 * math.sin(a), 1.10)); bot = Vector((0.20 * math.cos(a), 0.148 * math.sin(a), 0.84))
    out = Vector((math.cos(a), math.sin(a) * 0.7, 0)).normalized()
    pts = [lerp(top, bot, i / 8) + out * 0.025 * math.sin(math.pi * i / 8) for i in range(9)]
    tang = Vector((-math.sin(a), math.cos(a) * 0.7, 0)).normalized()
    wd = [0.125 * math.sin(math.pi * min(1.0, 0.25 + 0.75 * i / 8)) ** 0.7 + 0.002 for i in range(9)]
    side = 'lHip' if math.cos(a) > 0 else 'rHip'; kk = 0.35 if abs(math.cos(a)) > 0.35 else 0.0
    body.ribbon(pts, wd, [tang] * 9, lambda tt, v, p: GOLD if abs(v) > 0.38 else mix(RED, LOTUS, sstep(0.55, 1.0, tt) * 0.55),
                lambda tt, p, side=side, kk=kk: norm_w({'hips': 1 - kk * tt, side: kk * tt}), cols=4)
for sx in (1, -1):
    bp = Vector((sx * 0.125, -0.075, 1.09))
    body.sphere(bp, 0.018, GOLD, {'hips': 1.0}, sides=8, rings=5)
    for j in (-1, 0, 1):
        body.cone(bp + Vector((j * 0.008, 0, -0.015)), (j * 0.15, -0.05, -1), 0.10, 0.008, RED, {'hips': 1.0}, sides=5)

# 混天绫：肩背一圈 + 两股长尾（各 2.2 m，12 节骨，父骨 torso）
def band_pt(th):
    ph = math.radians(115) * th
    return Vector((0.29 * math.sin(ph), 0.17 * math.cos(ph), 1.24 + 0.11 * abs(math.sin(ph)) ** 1.5))
def sash_col(tt, v, p, tail=False):
    if abs(v) > 0.42: return GOLD
    if tail and tt > 0.66:
        fr = (tt * 9) % 1.0
        if fr < 0.55 - abs(v) * 1.0: return mix(GOLD, ORANGE, (tt - 0.66) * 2)
        if tt > 0.93: return ORANGE
    return RED
bp_ = [band_pt(-1 + 2 * i / 30) for i in range(31)]
bw_ = []
for i in range(31):
    tg = (bp_[min(i + 1, 30)] - bp_[max(i - 1, 0)]).normalized(); zz = Vector((0, 0, 1)); bw_.append((zz - tg * zz.dot(tg)).normalized())
body.ribbon(bp_, [0.13] * 31, bw_, lambda tt, v, p: sash_col(tt, v, p), lambda tt, p: {'torso': 1.0}, m=2, cols=4)
SASH_PTS = {}
SASH_N = 12
for t, sx in (('L', 1), ('R', -1)):
    p0 = band_pt(sx * 95 / 115)
    raw = [Vector((sx * (0.25 * u + 0.06 * math.sin(3 * math.pi * u)), 1.0 * u, 0.35 * u + 0.15 * math.sin(2.6 * math.pi * u)))
           for u in [i / 44 for i in range(45)]]
    ln = sum((raw[i] - raw[i - 1]).length for i in range(1, 45)); kf = 2.2 / ln
    pts = [p0 + r * kf for r in raw]
    # 均匀重采样成 12 段（骨链与绳模拟用同一组点）
    acc = [0.0]
    for i in range(1, 45): acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
    nodes = []
    for k in range(SASH_N + 1):
        s = acc[-1] * k / SASH_N; i = max(1, min(44, next((j for j in range(1, 45) if acc[j] >= s), 44)))
        a = (s - acc[i - 1]) / max(1e-6, acc[i] - acc[i - 1]); nodes.append(pts[i - 1].lerp(pts[i], a))
    SASH_PTS[t] = nodes
    wd, wdirs, rp = [], [], []
    for i in range(45):
        u = i / 44; rp.append(pts[i])
        wd.append(0.18 * (1 - 0.35 * u) * min(1.0, (1 - u) / 0.12) + 0.003)
        tg = (pts[min(i + 1, 44)] - pts[max(i - 1, 0)]).normalized(); zz = Vector((0, 0, 1))
        wdirs.append(Quaternion(tg, sx * math.radians(70) * u) @ (zz - tg * zz.dot(tg)).normalized())
    def tw(u, p, t=t):
        f = min(u * SASH_N, SASH_N - 0.001); i = int(f); a = f - i
        d = {'sash_%s_%02d' % (t, i + 1): 1 - a}
        if i + 2 <= SASH_N: d['sash_%s_%02d' % (t, i + 2)] = a
        return norm_w(d)
    body.ribbon(rp, wd, wdirs, lambda tt, v, p: sash_col(tt, v, p, True), tw, m=2, cols=6)

# ---------------- 火尖枪（加长一倍：4.8 m，握点距枪尾 1.5 m） + 红缨（加一倍） ----------------
SPEAR_L, GRIP = 4.8, 1.5
spear = B(); G = J['rH'] + Vector((0, -0.005, -0.025))
zb = G.z - GRIP; zt = zb + SPEAR_L
def SP(z, dx=0.0, dy=0.0): return Vector((G.x + dx, G.y + dy, z))
NW = {}
sz = [zb + 0.10 + (zt - 0.70 - zb - 0.10) * i / 30 for i in range(31)]
spear.tube([SP(z) for z in sz], [0.024] * 31, 10, lambda t, sv, p: GOLD if ((p.z - zb) % 0.6) < 0.035 else LACQ, NW)
spear.cone(SP(zb + 0.11), (0, 0, -1), 0.13, 0.03, GOLD, NW, sides=8)
spear.tube([SP(zt - 0.72), SP(zt - 0.64)], [0.042, 0.036], 10, GOLD, NW)
spear.tube([SP(zt - 0.64), SP(zt - 0.58)], [0.030, 0.026], 8, GOLD, NW, m=1)
bz = [zt - 0.60 + 0.60 * i / 24 for i in range(25)]
bwid = [0.17 * (1 - i / 24) ** 0.85 * (1 + 0.30 * math.sin(3 * math.pi * i / 24 + 0.3)) + 0.003 for i in range(25)]
spear.ribbon([SP(z) for z in bz], bwid, [Vector((1, 0, 0))] * 25, lambda t, v, p: mix(GOLD, ORANGE, t * 0.8 + abs(v) * 0.4),
             lambda t, p: NW, m=1, cols=4)
spear.tube([SP(z) for z in bz[:22]], [0.018 * (1 - i / 24) + 0.003 for i in range(22)], 6, GOLD, NW, m=1)
for sx in (1, -1):
    spear.cone(SP(zt - 0.54, sx * 0.06), (sx * 0.55, 0, -1), 0.17, 0.022, lambda t, sv, p: mix(GOLD, ORANGE, t), NW, m=1,
               sides=5, flat=0.5, bend=Vector((sx * 0.05, 0, 0.02)))
# 红缨：24 缕、长 0.68 m（v1 是 12 缕、0.17 m；枪加长一倍 ×2，再按老板要求 ×2），蒙皮到 4 节缨骨，游戏里同样可做弹簧
TASSEL_N, TASSEL_LEN = 4, 0.68
TA = SP(zt - 0.70)
TASSEL_PTS = [TA + Vector((0, 0, -TASSEL_LEN * k / TASSEL_N)) for k in range(TASSEL_N + 1)]
def tas_w(u, p):
    f = min(u * TASSEL_N, TASSEL_N - 0.001); i = int(f); a = f - i
    d = {'tassel_%02d' % (i + 1): 1 - a}
    if i + 2 <= TASSEL_N: d['tassel_%02d' % (i + 2)] = a
    return norm_w(d)
for k in range(24):
    a = 2 * math.pi * k / 24 + (0.13 if k % 2 else 0); rr = 0.03 + 0.012 * (k % 3)
    ln = TASSEL_LEN * (0.82 + 0.18 * ((k * 7) % 5) / 4)
    out = Vector((math.cos(a), math.sin(a), 0))
    pts = [TA + out * (rr + 0.07 * (i / 6) ** 1.3) + Vector((0, 0, -ln * i / 6)) for i in range(7)]
    body.tube(pts, [0.016 * (1 - 0.8 * i / 6) + 0.003 for i in range(7)], 5,
              lambda tt, sv, p: mix(DEEPRED, RED, sstep(0.0, 0.5, tt)), lambda tt, p: tas_w((TA.z - p.z) / TASSEL_LEN, p), cap0=True)
body.tube([TA + Vector((0, 0, 0.03)), TA + Vector((0, 0, -0.05))], [0.05, 0.045], 12, GOLD, {'tassel_01': 1.0})

# ---------------- 风火轮：竖起来，绕横轴（X）转 ----------------
wheels = {}
for t in ('l', 'r'):
    wb = B(); c = J[t + 'Mount']; AX = Vector((1, 0, 0))
    wb.torus(c, AX, 0.150, 0.026, lambda tt, sv, p: mix(GOLD, ORANGE, 0.25 + 0.3 * sv), {}, seg=40, sides=8)
    wb.torus(c, AX, 0.100, 0.016, RED, {}, seg=32, sides=6)
    wb.tube([c + Vector((-0.012, 0, 0)), c + Vector((0.012, 0, 0))], [0.098, 0.098], 24, RED, {}, up=Vector((0, 0, 1)))
    wb.sphere(c, 0.034, GOLD, {}, sides=10, rings=6, scale=(0.8, 1, 1))
    for k in range(6):
        a = 2 * math.pi * k / 6; d = Vector((0, math.cos(a), math.sin(a)))
        wb.tube([c + d * 0.03, c + d * 0.145], [0.008, 0.008], 5, GOLD, {}, cap0=False, cap1=False, up=Vector((1, 0, 0)))
    for k in range(12):                                     # 火焰：沿轮缘向后卷，看得出转向
        a = 2 * math.pi * k / 12; rd = Vector((0, math.cos(a), math.sin(a))); tg = Vector((0, -math.sin(a), math.cos(a)))
        wb.cone(c + rd * 0.165, rd * 0.55 - tg * 0.85, 0.12, 0.030, lambda tt, sv, p: mix(GOLD, ORANGE, tt), {},
                sides=5, flat=0.45, bend=rd * 0.025, segs=4)
    wheels[t] = wb

# ---------------- 对象、材质 ----------------
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
def make_mat(name, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    bs = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bs is None:
        bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.6
    if emit: bs.inputs['Emission Color'].default_value = emit; bs.inputs['Emission Strength'].default_value = strength
    m.use_backface_culling = False
    return m
MAT = {'body': make_mat('NZ_Body'), 'ring': make_mat('NZ_UniverseRing_Glow', GOLD, 0.15), 'sash': make_mat('NZ_Sash_Glow', L('#E04A1E'), 0.22),
       'spear': make_mat('NZ_Spear'), 'tip': make_mat('NZ_SpearTip_Glow', ORANGE, 0.18), 'wheel': make_mat('NZ_Wheel_Glow', ORANGE, 0.12)}
def build(name, b, mats):
    me = bpy.data.meshes.new(name); me.from_pydata(b.V, [], b.F); me.update()
    me.polygons.foreach_set('material_index', b.FM); me.polygons.foreach_set('use_smooth', [True] * len(b.F))
    at = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(b.C): at.data[i].color = c
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); return o
obj = build('Nezha', body, [MAT['body'], MAT['ring'], MAT['sash']])
sp = build('FireTippedSpear', spear, [MAT['spear'], MAT['tip']])
wh = {t: build('WindFireWheel_' + t.upper(), wheels[t], [MAT['wheel']]) for t in wheels}

# ---------------- 骨骼：玩法轨关节（全部朝上、roll 0）+ root + 红绫 2×12 + 红缨 4 ----------------
arm = bpy.data.armatures.new('NezhaRig'); rig = bpy.data.objects.new('NezhaRig', arm)
bpy.context.scene.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT'); eb = arm.edit_bones
def up_bone(n, h, parent):
    b = eb.new(n); b.head = h; b.tail = Vector(h) + Vector((0, 0, 0.08)); b.roll = 0
    if parent: b.parent = eb[parent]
up_bone('root', Vector((0, 0, 0)), None)
for n, p, _ in JOINTS: up_bone(n, J[n], p or 'root')
for t in ('L', 'R'):
    pts = SASH_PTS[t]; prev = 'torso'
    for k in range(SASH_N):
        b = eb.new('sash_%s_%02d' % (t, k + 1)); b.head = pts[k]; b.tail = pts[k + 1]; b.parent = eb[prev]; b.use_connect = k > 0
        prev = b.name
prev = 'staffPivot'
for k in range(TASSEL_N):
    b = eb.new('tassel_%02d' % (k + 1)); b.head = TASSEL_PTS[k]; b.tail = TASSEL_PTS[k + 1]; b.parent = eb[prev]; b.use_connect = k > 0
    prev = b.name
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.bones: obj.vertex_groups.new(name=b.name)
for vi, wd in enumerate(body.W):
    for g, w in wd.items(): obj.vertex_groups[g].add([vi], w, 'REPLACE')
obj.parent = rig; obj.modifiers.new('Armature', 'ARMATURE').object = rig
def bone_parent(o, bname):
    mw = o.matrix_world.copy(); o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = bname
    bpy.context.view_layer.update(); o.matrix_world = mw
bone_parent(sp, 'staffPivot'); bone_parent(wh['l'], 'lWheel'); bone_parent(wh['r'], 'rWheel')
bpy.context.view_layer.update()
tris = lambda b: sum(len(f) - 2 for f in b.F)
print('NZ_STATS body=%d spear=%d wheels=%d total=%d bones=%d' % (tris(body), tris(spear), tris(wheels['l']) * 2,
      tris(body) + tris(spear) + tris(wheels['l']) * 2, len(arm.bones)))

# ================= 动作：照 rig-def.ts / rig.pack.ts 复刻 =================
KEYS = ['hipY', 'hipX', 'hipZ', 'tX', 'tY', 'tZ', 'hX', 'hY', 'rsX', 'rsY', 'rsZ', 'reX', 'wX', 'wY', 'wZ', 'lsX', 'lsY', 'lsZ', 'leX', 'lhX', 'rhX', 'lkX', 'rkX', 'lhZ', 'rhZ']
def zero(): return {k: 0.0 for k in KEYS}
def make(p): d = zero(); d.update(p); return d
P_IDLE = make(dict(hipY=-0.04, tX=0.12, rsX=-0.45, rsZ=-0.15, reX=-0.9, wX=1.65, wZ=0.45, lsX=-0.55, lsZ=-0.25, leX=-1.0, lhX=-0.15, rhX=0.2, lkX=0.25, rkX=0.3))
def relax(o): d = dict(P_IDLE); d.update(o); return d
L1a = dict(tY=-0.9, tX=0.1, rsX=-0.35, rsZ=-1.25, reX=-0.3, wX=1.57, wZ=0, lsX=-0.4, lsZ=0.7, leX=-0.4, hipY=-0.08, lhX=-0.45, lkX=0.5, rhX=0.35, rkX=0.25)
L1b = dict(tY=1.05, tX=0.2, rsX=-0.2, rsZ=-1.2, reX=-0.2, wX=1.57, wZ=0, lsX=-0.2, lsZ=0.9, leX=-0.4, hipY=-0.14, lhX=-0.6, lkX=0.6, rhX=0.4, rkX=0.3)
L2a = dict(tY=1.0, tX=0.1, rsX=-1.3, rsZ=0.55, reX=-0.3, wX=1.4, wZ=0, lsX=-0.3, lsZ=0.2, leX=-0.6, hipY=-0.08, lhX=0.3, lkX=0.25, rhX=-0.45, rkX=0.5)
L2b = dict(tY=-1.05, tX=0.2, rsX=-0.3, rsZ=-1.3, reX=-0.2, wX=1.57, wZ=0, lsX=-0.3, lsZ=0.5, leX=-0.5, hipY=-0.14, lhX=0.35, lkX=0.3, rhX=-0.6, rkX=0.6)
L3a = dict(tX=-0.25, hX=-0.2, rsX=-2.85, rsZ=-0.15, reX=-0.5, wX=2.05, wZ=0, lsX=-2.6, lsZ=-0.2, leX=-0.6, hipY=-0.02, lhX=-0.2, lkX=0.2, rhX=0.2, rkX=0.2)
L3b = dict(tX=0.5, hX=0.15, rsX=-0.95, rsZ=-0.1, reX=-0.2, wX=3.3, wZ=0, lsX=-1.1, lsZ=-0.3, leX=-0.4, hipY=-0.28, lhX=-0.7, lkX=0.8, rhX=0.45, rkX=0.5)
HC = dict(tX=-0.2, hX=-0.1, rsX=-2.9, rsZ=-0.15, reX=-0.4, wX=2.3, wZ=0, lsX=-2.7, lsZ=-0.2, leX=-0.5, hipY=-0.18, lhX=-0.6, lkX=0.75, rhX=0.45, rkX=0.55)
HR = dict(tX=0.6, hX=0.2, rsX=-0.85, rsZ=-0.1, reX=-0.15, wX=3.4, wZ=0, lsX=-1.0, lsZ=-0.3, leX=-0.3, hipY=-0.38, lhX=-0.85, lkX=1.0, rhX=0.5, rkX=0.6)
ROLL_TUCK = make(dict(hipY=-0.3, tX=1.05, tY=0, hX=0.6, rsX=-1.3, rsZ=-0.1, reX=-1.7, wX=0.5, wZ=0, lsX=-1.3, lsZ=-0.2, leX=-1.7, lhX=-1.9, lkX=2.5, rhX=-1.9, rkX=2.5))
JUMP_UP = make(dict(hipY=-0.04, tX=0.28, hX=-0.1, rsX=0.5, rsZ=-0.35, reX=-0.6, wX=-1.9, wZ=0.2, lsX=-1.5, lsZ=0.5, leX=-0.7, lhX=-1.25, lkX=1.7, rhX=-0.15, rkX=0.7))
JUMP_DOWN = make(dict(hipY=-0.02, tX=0.12, hX=0.05, rsX=0.1, rsZ=-0.45, reX=-0.5, wX=-1.6, wZ=0.2, lsX=-0.6, lsZ=0.7, leX=-0.5, lhX=-0.55, lkX=0.6, rhX=0.15, rkX=0.35))
P_HURT = relax(dict(tX=-0.45, hX=-0.4, hipY=-0.1, rsX=0.2, lsX=0.4, lhX=-0.3, lkX=0.5))
P_DRINK = relax(dict(lsX=-2.35, lsZ=-0.55, leX=-1.7, hX=-0.45, tX=-0.05))
P_CAST = relax(dict(lsX=-1.55, lsZ=-0.05, leX=-0.15, tY=-0.35, hY=0.2))
P_DEAD = relax(dict(tX=-0.2, hX=-0.3, rsX=-2.5, rsZ=-0.6, lsX=-2.5, lsZ=0.6, lhX=-0.2, rhX=0.1, lkX=0.3, hipY=0))
def kd(base, o): d = dict(base); d.update(o); return d
LIGHT_KF = [
    [(0, L1a), (0.28, kd(L1a, dict(tY=-1.1))), (0.56, L1b), (1, relax(dict(tY=0.3, rsZ=-0.4)))],
    [(0, L2a), (0.28, kd(L2a, dict(tY=1.15))), (0.56, L2b), (1, relax(dict(tY=-0.3)))],
    [(0, L3a), (0.3, kd(L3a, dict(rsX=-3.05, tX=-0.3))), (0.5, L3b), (0.75, L3b), (1, relax(dict(tX=0.3)))],
]
L4a = dict(tY=-0.4, tX=0.2, rsX=-0.1, rsZ=-1.45, reX=0, wX=math.pi, wZ=0, lsX=-0.2, lsZ=1.2, leX=-0.2, hipY=-0.16, lhX=-0.4, lkX=0.5, rhX=0.3, rkX=0.4)
LIGHT4_KF = [(0, L4a), (0.22, kd(L4a, dict(tY=-0.6))), (0.65, kd(L4a, dict(tY=0.2))), (1, relax({}))]
HEAVY_KF = [(0, HC), (0.18, kd(HC, dict(rsX=-3.15, tX=-0.35))), (0.36, HR), (0.7, HR), (1, relax(dict(tX=0.3)))]
AIRATK_KF = [(0, HC), (0.45, HC), (0.7, L3b), (1, L3b)]
def spinOf(u):
    k = min(1, max(0, (u - 0.22) / 0.43)); e = 2 * k * k if k < 0.5 else 1 - (-2 * k + 2) ** 2 / 2
    return 2 * math.pi * e
def glidePose(speed):
    lean = min(1, max(0, speed / 9.5))
    return relax(dict(tX=0.06, tY=0.12, hipY=0, rsX=0.35 + lean * 0.5, rsZ=-0.25, reX=-0.5, wX=-1.9 - lean * 0.4, wZ=0.25, lsX=-0.5 - lean * 0.5, lsZ=0.35 + lean * 0.3, leX=-0.6))
def ease(t): return 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2
def keyframes(base, frames, t):
    out = dict(base); i = 0
    while i < len(frames) - 1 and t > frames[i + 1][0]: i += 1
    t0, a = frames[i]; t1, b = frames[min(i + 1, len(frames) - 1)]
    u = ease(min(1, max(0, (t - t0) / (t1 - t0)))) if t1 > t0 else 1
    for k in KEYS:
        if k not in a and k not in b: continue
        va = a.get(k, base[k]); vb = b.get(k, base[k]); out[k] = va + (vb - va) * u
    return out
HOVER = dict(idle=(0.58, 0.065, 0.5, 0.35), move=(0.48, 0.045, 0.9, 0.5), sprint=(0.4, 0.025, 1.4, 0.85), attack=(0.42, 0.015, 1.2, 0.55),
             heavy=(0.3, 0.01, 1.0, 0.9), charge=(0.85, 0.03, 2.2, 1.0), roll=(0.55, 0, 0, 1.0), jump=(0.3, 0, 0, 0.7), airatk=(0.2, 0, 0, 1.0),
             cast=(0.95, 0.05, 1.6, 0.6), drink=(0.62, 0.05, 0.7, 0.4), hurt=(0.38, 0, 0, 0.6), dead=(0.12, 0, 0, 0.2))
def rollAngleDeg(f):
    if f <= 0: return 0
    if f <= 18:
        t = f / 18; return 360 * (0.55 * t + 0.45 * (1 - (1 - t) ** 2))
    t = min(1, (f - 18) / 9); return 360 + 8 * math.sin(math.pi * t) * (1 - t)
def rollHop(f): return 0.0 if f <= 0 or f >= 18 else 0.38 * math.sin(math.pi * f / 18)
LIGHT_STEPS = [7 + 14, 7 + 16, 11 + 22, 18 + 30]
HEAVY_STEPS = 9 + 24

def qE(x, y, z):                                         # three.js qEuler（XYZ 内旋）→ 骨骼局部（与 three 轴一致）
    return Quaternion((1, 0, 0), x) @ Quaternion((0, 1, 0), y) @ Quaternion((0, 0, 1), z)
SWELL_AMP, SWELL_PERIOD = 2.0, 4.5                       # 和龙一样：±2 m、4.5 s
pb = rig.pose.bones
for b in pb: b.rotation_mode = 'QUATERNION'
REST = {b.name: b.matrix_local.copy() for b in arm.bones}
def w2l(v): return Vector((v.x, v.z, -v.y))               # 朝上骨骼：世界向量 → 骨骼局部

class Sim:
    def __init__(s):
        s.pose = dict(P_IDLE); s.t = 0.0; s.dy = 0.0; s.tuck = 0.35; s.spin = 0.0; s.ropes = None
    def init_ropes(s):
        s.ropes = {}
        for t in ('L', 'R'):
            P = [p.copy() for p in SASH_PTS[t]]; s.ropes['sash_' + t] = (P, [p.copy() for p in P], 2.2 / SASH_N)
        P = [p.copy() for p in TASSEL_PTS]; s.ropes['tassel'] = (P, [p.copy() for p in P], TASSEL_LEN / TASSEL_N)

def step(S, seg, f, dt, swell_on, air):
    """seg: 动作名；f: 动作内步数；air: (高度, 竖直速度)。返回 root 位移与旋转（世界）。"""
    kind = seg; hs = 'idle'; rate = 16; tgt = None
    if kind == 'idle': tgt = kd(P_IDLE, dict(tX=P_IDLE['tX'] + math.sin(S.t * 2) * 0.02))
    elif kind == 'glide': tgt = glidePose(5.0); hs = 'move'
    elif kind.startswith('light'):
        st = int(kind[-1]); n = LIGHT_STEPS[st - 1]
        tgt = keyframes(P_IDLE, LIGHT4_KF if st == 4 else LIGHT_KF[st - 1], min(1, f / n)); rate = 30; hs = 'attack'
    elif kind == 'charge':
        tgt = kd(P_IDLE, HC); tgt['tX'] = HC['tX'] + math.sin(S.t * 40) * 0.01 * min(1, f / 72) * 3; hs = 'charge'
    elif kind == 'heavy': tgt = keyframes(P_IDLE, HEAVY_KF, min(1, f / HEAVY_STEPS)); rate = 30; hs = 'heavy'
    elif kind == 'roll': tgt = ROLL_TUCK if f < 27 - 6 else P_IDLE; rate = 24; hs = 'roll'
    elif kind == 'hurt': tgt = P_HURT; rate = 20; hs = 'hurt'
    elif kind == 'lotus': tgt = P_DRINK; hs = 'drink'
    elif kind == 'sash': tgt = P_CAST; hs = 'cast'
    elif kind == 'jump': tgt = JUMP_UP if air[1] > 0 else JUMP_DOWN; rate = 14; hs = 'jump'
    elif kind == 'airatk': tgt = keyframes(P_IDLE, AIRATK_KF, min(1, f / 24)); rate = 24; hs = 'airatk'
    elif kind == 'dead': tgt = P_DEAD; rate = 8; hs = 'dead'
    k = 1 - math.exp(-dt * rate)
    for key in KEYS: S.pose[key] += (tgt[key] - S.pose[key]) * k
    hov, bob, fq, legs = HOVER[hs]
    bobv = bob * (math.sin(S.t * fq * 2 * math.pi) * 0.7 + math.sin(S.t * fq * 2 * math.pi * 1.618 + 1.3) * 0.3)
    S.dy += ((hov - HOVER['idle'][0] + bobv) * RS - S.dy) * (1 - math.exp(-dt * 6))
    S.tuck += (legs - S.tuck) * (1 - math.exp(-dt * 6))
    p = S.pose
    rot = {'hips': (p['hipX'], 0, p['hipZ']), 'torso': (p['tX'], p['tY'], p['tZ']), 'head': (p['hX'], p['hY'], 0),
           'rS': (p['rsX'], p['rsY'], p['rsZ']), 'rE': (p['reX'], 0, 0), 'staffPivot': (p['wX'], p['wY'], p['wZ']),
           'lS': (p['lsX'], p['lsY'], p['lsZ']), 'lE': (p['leX'], 0, 0)}
    sw, sw2 = math.sin(S.t * 1.3) * 0.06, math.sin(S.t * 1.3 + 1.1) * 0.06; tk = S.tuck
    lhx = -0.28 - tk * 0.55 + tk * 0.25 + sw; rhx = 0.12 - tk * 0.2 + tk * 0.25 * 0.85 + sw2
    lkx = 0.55 + tk * 0.9; rkx = 0.35 + tk * 0.5
    rot.update({'lHip': (lhx, 0, 0.06), 'rHip': (rhx, 0, -0.06), 'lK': (lkx, 0, 0), 'rK': (rkx, 0, 0),
                'lMount': (-(lhx + lkx + p['hipX']), 0, 0), 'rMount': (-(rhx + rkx + p['hipX']), 0, 0)})
    S.spin += (3 + (5.0 * 7 if kind == 'glide' else 0)) * dt
    rot['lWheel'] = (S.spin * 1.03, 0, 0); rot['rWheel'] = (S.spin, 0, 0)
    for n, e in rot.items(): pb[n].rotation_quaternion = qE(*e)
    pb['hips'].location = (0, p['hipY'] * (1.22 / 0.98) * RS, 0)
    # root：大幅浮动（和龙一样）+ 悬浮层 + 跳跃高度 + 翻滚 / 回旋 / 倒地的整体转动
    swell = SWELL_AMP * math.sin(2 * math.pi * S.t / SWELL_PERIOD) if swell_on else 0.0
    off = Vector((0, 0, swell + S.dy + air[0])); R = Quaternion()
    if kind == 'light4': R = Quaternion((0, 0, 1), spinOf(min(1, f / LIGHT_STEPS[3])))
    elif kind == 'roll':
        R = Quaternion((1, 0, 0), -math.radians(rollAngleDeg(f)))          # 向前翻（人物朝 -Y）
        piv = Vector((0, 0, 0.85)); off += piv - R @ piv + Vector((0, 0, rollHop(f)))
    elif kind == 'dead':
        e = 1 - (1 - min(1, f / 20)) ** 3; R = Quaternion((1, 0, 0), math.radians(78) * e)   # 向后倒
        piv = Vector((0, 0, 0.1)); off += piv - R @ piv + Vector((0, 0, -0.45 * e))
    pb['root'].location = w2l(off)
    pb['root'].rotation_quaternion = Quaternion((R.w, R.x, R.z, -R.y))    # 世界 → 骨骼局部（X, Z, -Y）
    return off

def ropes_step(S, dt):
    bpy.context.view_layer.update()
    Mt = rig.pose.bones['torso'].matrix @ REST['torso'].inverted()
    Ms = rig.pose.bones['staffPivot'].matrix @ REST['staffPivot'].inverted()
    tq = Mt.to_quaternion(); sq = Ms.to_quaternion()
    back, up = tq @ Vector((0, 1, 0)), Vector((0, 0, 1)); axis = sq @ Vector((0, 0, 1))
    for name, (P, Pp, segL) in S.ropes.items():
        if name.startswith('sash'):
            P[0] = Mt @ SASH_PTS[name[-1]][0]; side = tq @ Vector((1, 0, 0)) * (1 if name[-1] == 'L' else -1)
            drag = 0.90
        else:
            P[0] = Ms @ TASSEL_PTS[0]; drag = 0.86
        n = len(P)
        for i in range(1, n):
            u = i / (n - 1)
            if name.startswith('sash'):
                acc = back * 3.2 + up * 2.6 + side * (1.2 + 1.6 * math.sin(2 * math.pi * (0.9 * S.t - u * 1.4)))
            else:
                acc = -axis * 7.0 + Vector((0, 0, -1.5)) + (tq @ Vector((1, 0, 0))) * 1.0 * math.sin(2 * math.pi * (1.3 * S.t - u))
            v = (P[i] - Pp[i]) * drag; Pp[i] = P[i].copy(); P[i] = P[i] + v + acc * dt * dt
        for _ in range(6):
            for i in range(1, n):
                d = P[i] - P[i - 1]; l = d.length or 1e-6; corr = d * (1 - segL / l)
                if i == 1: P[i] = P[i] - corr
                else: P[i - 1] = P[i - 1] + corr * 0.5; P[i] = P[i] - corr * 0.5
    # 绳 → 骨链（最小扭转）
    for name, (P, _, _) in S.ropes.items():
        chain = ['sash_%s_%02d' % (name[-1], k + 1) for k in range(SASH_N)] if name.startswith('sash') else ['tassel_%02d' % (k + 1) for k in range(TASSEL_N)]
        par = 'torso' if name.startswith('sash') else 'staffPivot'
        WP = (rig.pose.bones[par].matrix).to_quaternion(); RP = REST[par].to_quaternion()
        for i, bn in enumerate(chain):
            Ri = REST[bn].to_quaternion(); base = WP @ RP.inverted() @ Ri
            d = (P[i + 1] - P[i]).normalized()
            Wi = (base @ Vector((0, 1, 0))).rotation_difference(d) @ base
            pb[bn].rotation_quaternion = base.inverted() @ Wi
            WP, RP = Wi, Ri

def bake(name, segments, swell_on=False, fps=30, cam_follow=None, preroll=1.0):
    """segments: [(动作, 步数)]，60 Hz 模拟、按 fps 打关键帧。返回 (action, 帧数, 每帧 root 偏移)。"""
    S = Sim(); S.init_ropes(); dt = 1 / 60
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    pre = int(preroll * 60)
    for f in range(pre):                                   # 预热：先在待机里稳定下来，不记录
        step(S, 'idle', f, dt, swell_on, (0, 0)); ropes_step(S, dt); S.t += dt
    frame = 1; total = 0; offs = []; air = [0.0, 0.0]
    every = 60 // fps
    for seg, n in segments:
        if seg == 'jump': air = [0.0, 9.8 * 0.6]
        for f in range(n):
            if seg in ('jump', 'airatk'):
                if seg == 'airatk' and f < 12: air[1] = 0.0
                else:
                    air[1] -= (24 * 0.6 if seg == 'jump' else 60) * dt
                air[0] = max(0.0, air[0] + air[1] * dt)
            elif air[0] > 0: air[0] = max(0.0, air[0] - 6 * dt)
            off = step(S, seg, f, dt, swell_on, tuple(air)); ropes_step(S, dt)
            if total % every == 0:
                for b in pb: b.keyframe_insert('rotation_quaternion', frame=frame)
                pb['root'].keyframe_insert('location', frame=frame); pb['hips'].keyframe_insert('location', frame=frame)
                offs.append(off.copy()); frame += 1
            total += 1; S.t += dt
    act.use_frame_range = True; act.frame_start = 1; act.frame_end = frame - 1
    print('NZ_BAKE %-14s %3d frames %.2fs' % (name, frame - 1, total / 60))
    return act, frame - 1, offs

# ---------- 导出用动作（原地、不含大浮动；游戏里大浮动由 FLIGHT 层叠加） ----------
CLIPS = [('Idle', [('idle', 270)]), ('Glide', [('glide', 120)]),
         ('Light1', [('light1', 21), ('idle', 12)]), ('Light2', [('light2', 23), ('idle', 12)]),
         ('Light3', [('light3', 33), ('idle', 12)]), ('Light4_Spin', [('light4', 48), ('idle', 12)]),
         ('Charge', [('charge', 72)]), ('Heavy', [('heavy', 33), ('idle', 12)]), ('Roll', [('roll', 27), ('idle', 9)]),
         ('Hurt', [('hurt', 24), ('idle', 12)]), ('Lotus', [('lotus', 60), ('idle', 12)]), ('SashBind', [('sash', 22), ('idle', 12)]),
         ('Jump', [('jump', 50)]), ('PlungeAttack', [('airatk', 24), ('idle', 12)]), ('Dead', [('dead', 90)])]
fps = 30; bpy.context.scene.render.fps = fps
if not TEST:
    for nm, segs in CLIPS: bake(nm, segs)
    rig.animation_data.action = None
    for b in pb: b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (obj, sp, rig, wh['l'], wh['r']): o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    glb = os.path.join(OUT, 'nezha_v2.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_skins=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True)
    print('NZ_GLB', glb, os.path.getsize(glb))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'nezha_v2.blend'))

# ================= 渲染 =================
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
    try: sc.render.engine = eng; break
    except TypeError: pass
try: sc.view_settings.view_transform = 'Standard'
except Exception: pass
try: sc.eevee.taa_render_samples = 16
except Exception: pass
world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True; bgn = world.node_tree.nodes['Background']
def light(name, rot, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'SUN'); ld.energy = energy; ld.color = color
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.rotation_euler = rot
light('Key', (math.radians(45), math.radians(-15), math.radians(-35)), 3.0)
light('Rim', (math.radians(-55), math.radians(10), math.radians(160)), 2.2, (0.75, 0.9, 1.0))
light('Fill', (math.radians(70), 0, math.radians(120)), 0.8)
camd = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', camd); sc.collection.objects.link(cam); sc.camera = cam
def look_at(o, tg): o.rotation_euler = (Vector(tg) - o.location).to_track_quat('-Z', 'Y').to_euler()
def flat_mat(name, hexc, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    bs = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bs is None:
        bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    bs.inputs['Base Color'].default_value = L(hexc); bs.inputs['Roughness'].default_value = 0.85
    if emit: bs.inputs['Emission Color'].default_value = L(hexc); bs.inputs['Emission Strength'].default_value = emit
    return m
def still(path, w, h):
    sc.render.resolution_x, sc.render.resolution_y = w, h; sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); print('NZ_RENDER', path)
def video(tag, f0, f1, w, h):
    sc.frame_start, sc.frame_end = f0, (f0 + 2 if TEST else f1)
    sc.render.resolution_x, sc.render.resolution_y = w, h; sc.render.image_settings.file_format = 'PNG'
    fdir = os.path.join(OUT, 'frames_' + tag); os.makedirs(fdir, exist_ok=True)
    sc.render.filepath = os.path.join(fdir, 'f_'); bpy.ops.render.render(animation=True)
    if not TEST:
        mp4 = os.path.join(OUT, tag + '.mp4')
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-start_number', str(f0), '-i',
                        os.path.join(fdir, 'f_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], check=True)
        subprocess.run(['rm', '-rf', fdir]); print('NZ_MP4', mp4)

# 1) 静置三视图：竖立风火轮、4.8 m 长枪、红缨
bgn.inputs[0].default_value = L('#DCE2E7'); bgn.inputs[1].default_value = 0.9
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.01)); fl = bpy.context.active_object; fl.scale = (6, 6, 0.02)
fl.data.materials.append(flat_mat('Floor', '#9AA6AE'))
rig.animation_data_create(); rig.animation_data.action = None
for b in pb: b.rotation_quaternion = (1, 0, 0, 0); b.location = (0, 0, 0)
camd.type = 'ORTHO'; camd.ortho_scale = 5.6
views = [('front', (0, -12, 1.9), (math.radians(90), 0, 0)), ('side', (12, 0, 1.9), (math.radians(90), 0, math.radians(90))),
         ('back', (0, 12, 1.9), (math.radians(90), 0, math.radians(180)))]
for nm, loc, r in views:
    cam.location = loc; cam.rotation_euler = r; still(os.path.join(OUT, '_t_%s.png' % nm), 900, 1100)
subprocess.run(['/opt/homebrew/bin/ffmpeg', '-y', '-loglevel', 'error'] + sum([['-i', os.path.join(OUT, '_t_%s.png' % v[0])] for v in views], [])
               + ['-filter_complex', 'hstack=inputs=3', os.path.join(OUT, 'render_02_turnaround.png')], check=True)
for v in views: os.remove(os.path.join(OUT, '_t_%s.png' % v[0]))
fl.hide_render = True

# 2) 战斗动作合集（带 ±2 m 大浮动），镜头跟随 Nezha，只跟一半浮动（同游戏镜头）
REEL = [('idle', 120), ('light1', 21), ('light2', 23), ('light3', 33), ('light4', 48), ('idle', 60), ('charge', 72), ('heavy', 33),
        ('idle', 60), ('roll', 27), ('idle', 45), ('hurt', 24), ('idle', 45), ('sash', 22), ('idle', 30), ('lotus', 60), ('idle', 45),
        ('glide', 90), ('jump', 26), ('airatk', 24), ('idle', 60), ('dead', 90)]
reel, nfr, offs = bake('Reel_preview', REEL, swell_on=True)
reel.use_fake_user = False
BASE = 3.4                                              # 空战基准高度（玩法轨 FLIGHT.height = 3.4 m）
rig.location = (0, 0, BASE)
bpy.ops.mesh.primitive_cylinder_add(radius=30, depth=0.1, location=(0, 0, -0.05), vertices=96)
vx = bpy.context.active_object; vx.data.materials.append(flat_mat('Vortex', '#2C4A5C'))
bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=0.01, location=(0, 0, 0.01), vertices=48)
cl = bpy.context.active_object; cl.data.materials.append(flat_mat('ContactLight', '#FFA531', 0.7))
bgn.inputs[0].default_value = L('#0D1E33'); bgn.inputs[1].default_value = 1.0
camd.type = 'PERSP'; camd.lens = 22
cam.animation_data_create(); ca = bpy.data.actions.new('CamFollow'); cam.animation_data.action = ca
for i, o in enumerate(offs):
    tz = BASE + 1.0 + 0.5 * o.z
    cam.location = (2.9, -3.9, tz + 0.7); look_at(cam, (0.0, 0.5, tz + 0.15))
    cam.keyframe_insert('location', frame=i + 1); cam.keyframe_insert('rotation_euler', frame=i + 1)
video('combat_reel', 1, nfr, 1280, 720)
for fr, nm in ((int(2.9 * fps), 'render_01_hero_light3.png'), (int(7.2 * fps), 'render_03_hero_heavy.png')):
    sc.frame_set(fr); still(os.path.join(OUT, nm), 1600, 1000)
cam.animation_data.action = None

# 3) 和龙同框：两者同样 ±2 m 浮动（侧视 + 高度标尺）
DK = os.path.join(HERE, 'dragon-blender-v1', 'dragon_king_v1_swim.glb')
if os.path.exists(DK):
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=DK)
    new = [bpy.data.objects[n] for n in set(bpy.data.objects.keys()) - before]
    drig = next(o for o in new if o.type == 'ARMATURE')
    swim = next((a for a in bpy.data.actions if a.name.startswith('Swim') and 'Horizontal' not in a.name and 'Vertical' not in a.name), None)
    drig.animation_data_create(); drig.animation_data.action = swim
    drig.location = (-1.0, 3.0, 5.5)
    for o in new:
        if o.type == 'MESH': o.hide_render = False
    idle_swell, nfr2, _ = bake('Float_preview', [('idle', 270), ('glide', 135)], swell_on=True)
    idle_swell.use_fake_user = False
    rig.location = (0, -3.2, BASE)
    dark = flat_mat('Ruler', '#C8D2DA')
    for z in range(0, 11):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(2.0, -6.4, z)); o = bpy.context.active_object
        o.scale = (0.05, 0.5 if z % 5 == 0 else 0.3, 0.04); o.data.materials.append(dark)
        cu = bpy.data.curves.new('T%d' % z, 'FONT'); cu.body = '%d m' % z; cu.size = 0.42; cu.align_y = 'CENTER'
        to = bpy.data.objects.new('T%d' % z, cu); sc.collection.objects.link(to); to.location = (2.0, -7.3, z)
        to.rotation_euler = (math.radians(90), 0, math.radians(90)); to.data.materials.append(dark)
    vx.hide_render = False; cl.hide_render = True
    camd.type = 'ORTHO'; camd.ortho_scale = 23.0
    cam.location = (40, 3.8, 4.6); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
    sc.frame_start = 1
    video('float_with_dragon', 1, nfr2, 1280, 720)
print('NZ_DONE')
