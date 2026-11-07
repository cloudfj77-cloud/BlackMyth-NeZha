# 《白神话：哪吒》哪吒 · Blender 生成脚本 v1（资产轨，占位级）
# 用法：Blender --background --factory-startup --python build_nezha.py -- <输出目录>
# 依据：设计文档 6.1 / 10 节、龙王设计会定稿（飞高参数、红绫）、美术方向板 v2 色值与 3.2 节、参考图 nz-01（只取方向，不描摹）
# 坐标：Blender Z 向上；人物朝 -Y（导出 glTF 后 +Z 朝前、Y 向上）；原点 = 风火轮底部中心（游戏里整个模型再抬高 1.15 m）。
import bpy, bmesh, math, sys, os, subprocess
from mathutils import Vector, Matrix, Quaternion

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/nezha'
os.makedirs(OUT, exist_ok=True)

def L(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)
def mix(a, b, t):
    t = max(0.0, min(1.0, t)); return tuple(a[i] * (1 - t) + b[i] * t for i in range(4))
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k, 1.0)
def sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t

RED, GOLD, LOTUS, ORANGE = L('#B8261C'), L('#D4A03A'), L('#F2ECE0'), L('#FF7A1A')   # 方向板 2.1 哪吒方
SKIN, HAIR, DARK, LACQ, LIP = L('#E6BE98'), L('#1B1615'), L('#231A18'), L('#3A1A16'), L('#9A4A3C')

# ---------------- 网格累加器 ----------------
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

def norm_w(d):
    t = sum(d.values()) or 1.0; return {k: v / t for k, v in d.items() if v > 1e-4}

# ---------------- 关键点（A 字静置；脚底离风火轮底 0.10 m） ----------------
S = 0.10
def P(x, y, z): return Vector((x, y, z + S))
SIDES = {'L': 1, 'R': -1}                       # 人物朝 -Y：左 = +X，右 = -X（乾坤圈、火尖枪在右手）
J = {}
for t, sx in SIDES.items():
    J['hip' + t] = P(sx * 0.085, 0, 0.89); J['knee' + t] = P(sx * 0.09, -0.012, 0.48); J['ankle' + t] = P(sx * 0.09, 0.02, 0.075)
    J['heel' + t] = P(sx * 0.09, 0.05, 0.035); J['toe' + t] = P(sx * 0.10, -0.165, 0.02)
    J['sho' + t] = P(sx * 0.175, 0.01, 1.34)
    a = Vector((sx * 0.766, 0, -0.643)); J['elb' + t] = J['sho' + t] + a * 0.29
    f = Vector((sx * 0.73, -0.12, -0.67)).normalized(); J['fdir' + t] = f
    J['wri' + t] = J['elb' + t] + f * 0.25; J['tip' + t] = J['wri' + t] + f * 0.17

body = B()
# ---- 躯干：腰胯 → 胸 → 颈根 ----
rings = [(0.78, 0.115, 0.095, 0.005), (0.84, 0.145, 0.100, 0.0), (0.92, 0.158, 0.105, 0.0), (1.00, 0.132, 0.092, 0.0),
         (1.08, 0.140, 0.095, -0.003), (1.18, 0.160, 0.105, -0.008), (1.27, 0.168, 0.100, -0.005), (1.33, 0.160, 0.088, 0.005),
         (1.37, 0.115, 0.068, 0.01), (1.40, 0.055, 0.05, 0.01)]
def torso_col(t, sv, p):
    z = p.z - S
    if z < 0.97: return LOTUS
    if z < 1.02: return GOLD                                     # 腰带
    if z < 1.355:                                                # 赤红短甲（不发光）
        if z < 1.045 or z > 1.325: return GOLD
        c = mul(RED, 0.82) if int((z - 1.045) / 0.035) % 2 else RED
        if p.y < -0.06:                                          # 胸前莲花纹
            d = math.hypot(p.x, z - 1.20)
            if d < 0.032: return GOLD
            if d < 0.058: return LOTUS
            if d < 0.066: return GOLD
        return c
    return SKIN
def torso_w(t, p):
    z = p.z - S; a = sstep(0.95, 1.05, z); b = sstep(1.13, 1.23, z)
    w = {'hips': 1 - a, 'spine': a * (1 - b), 'chest': b}
    if z > 1.27 and abs(p.x) > 0.11:
        k = sstep(0.11, 0.17, abs(p.x)) * 0.4; w = {kk: v * (1 - k) for kk, v in w.items()}
        w['shoulder_' + ('L' if p.x > 0 else 'R')] = k
    if z < 0.86 and abs(p.x) > 0.05:
        k = 0.35 * (1 - sstep(0.80, 0.86, z)); w = {kk: v * (1 - k) for kk, v in w.items()}
        w['thigh_' + ('L' if p.x > 0 else 'R')] = k
    return norm_w(w)
zs = []
for i in range(len(rings) - 1):                                  # 加密环
    for k in range(3): zs.append(tuple(lerp(rings[i][j], rings[i + 1][j], k / 3) for j in range(4)))
zs.append(rings[-1])
body.tube([P(0, r[3], r[0]) for r in zs], [(r[1], r[2]) for r in zs], 20, torso_col, torso_w)

# ---- 颈、头 ----
body.tube([P(0, 0.012, 1.37), P(0, 0.008, 1.42), P(0, 0.004, 1.46)], [0.046, 0.043, 0.042], 12, SKIN,
          lambda t, p: norm_w({'neck': 1 - 0.4 * (1 - t), 'chest': 0.4 * (1 - t)}), cap0=False, cap1=False)
head = [(1.415, 0.030, 0.028, -0.045), (1.44, 0.052, 0.055, -0.030), (1.47, 0.066, 0.075, -0.012), (1.51, 0.076, 0.088, -0.002),
        (1.555, 0.083, 0.098, 0.006), (1.60, 0.081, 0.096, 0.012), (1.63, 0.068, 0.082, 0.014), (1.65, 0.040, 0.050, 0.014)]
def head_col(t, sv, p):
    z = p.z - S
    if p.y > -0.035 or (z > 1.595 and p.y > -0.075) or z > 1.618 or (abs(p.x) > 0.07 and z > 1.53 and p.y > -0.06): return HAIR
    return SKIN
body.tube([P(0, h[3], h[0]) for h in head], [(h[1], h[2]) for h in head], 18, head_col, {'head': 1.0})
HW = {'head': 1.0}
for sx in (1, -1):
    body.sphere(P(sx * 0.033, -0.082, 1.546), 0.013, DARK, HW, scale=(1.5, 0.55, 0.8), sides=8, rings=4)          # 眼
    body.tube([P(sx * 0.016, -0.088, 1.566), P(sx * 0.036, -0.087, 1.571), P(sx * 0.056, -0.080, 1.578)], [0.006, 0.007, 0.004], 6, HAIR, HW)  # 剑眉
    body.sphere(P(sx * 0.083, 0.0, 1.535), 0.022, SKIN, HW, scale=(0.45, 0.9, 1.2), sides=8, rings=4)             # 耳
    # 双丫髻（放大，刚性，跟头骨走）+ 金箍 + 莲花饰
    bc = P(sx * 0.068, 0.012, 1.645)
    body.sphere(bc, 0.074, HAIR, HW, sides=14, rings=10)
    body.torus(P(sx * 0.060, 0.012, 1.598), (sx * 0.35, 0, 1), 0.050, 0.009, GOLD, HW, sides=6)
    fc = P(sx * 0.118, -0.035, 1.672)
    for k in range(6):
        a = 2 * math.pi * k / 6
        d = Vector((math.cos(a) * 0.55 * sx, -0.75, math.sin(a) * 0.9 + 0.1))
        body.cone(fc, d, 0.04, 0.014, lambda t, sv, p: mix(RED, LOTUS, t * 1.2), HW, sides=5, flat=0.4)
    body.sphere(fc, 0.011, GOLD, HW, sides=8, rings=4)
body.sphere(P(0, -0.092, 1.592), 0.009, RED, HW, scale=(0.6, 0.4, 1.5), sides=8, rings=4)            # 眉心红印
body.cone(P(0, -0.088, 1.538), (0, -1, -0.5), 0.018, 0.012, SKIN, HW, sides=6)                         # 鼻
body.tube([P(-0.017, -0.081, 1.489), P(0, -0.084, 1.488), P(0.017, -0.081, 1.489)], [0.0035] * 3, 6, LIP, HW)   # 嘴

# ---- 手臂（皮肤）+ 护腕 + 乾坤圈 + 手 + 护肩 ----
FE = 0.29 / 0.54
for t, sx in SIDES.items():
    sh, el, wr, f = J['sho' + t], J['elb' + t], J['wri' + t], J['fdir' + t]
    pts = [lerp(sh, el, k / 4) for k in range(4)] + [lerp(el, wr, k / 4) for k in range(5)]
    rad = [0.047, 0.045, 0.042, 0.039, 0.037, 0.039, 0.036, 0.032, 0.029]
    def aw(tt, p, t=t):
        fw = sstep(FE - 0.07, FE + 0.07, tt); sw = 0.5 * (1 - sstep(0.0, 0.14, tt))
        return norm_w({'upperarm_' + t: (1 - fw) * (1 - sw), 'forearm_' + t: fw, 'shoulder_' + t: sw})
    body.tube(pts, rad, 12, SKIN, aw, cap0=False)
    FW = {'forearm_' + t: 1.0}
    def bracer(tt, sv, p):
        if tt < 0.08 or tt > 0.92: return GOLD
        if 0.42 < tt < 0.58: return LOTUS if sv > -0.2 else GOLD
        return RED
    body.tube([lerp(el, wr, 0.38 + 0.6 * k / 5) for k in range(6)], [0.047, 0.046, 0.044, 0.042, 0.040, 0.038], 12, bracer, FW)
    if t == 'R':                                                # 乾坤圈：只戴右前臂，单独材质（发光参数随蓄力分段）
        body.torus(lerp(el, wr, 0.18), f, 0.060, 0.012, GOLD, FW, m=1, seg=28, sides=8)
    HWt = {'hand_' + t: 1.0}
    body.tube([wr, wr + f * 0.05, wr + f * 0.09], [(0.030, 0.015), (0.034, 0.015), (0.033, 0.014)], 8, SKIN, HWt, cap0=False, cap1=False)
    body.tube([wr + f * 0.09, wr + f * 0.13, wr + f * 0.17], [(0.032, 0.013), (0.027, 0.011), (0.016, 0.008)], 8, SKIN, HWt, cap0=False)
    body.cone(wr + f * 0.035 + Vector((0, -0.02, 0)), f + Vector((0, -0.9, 0.2)), 0.06, 0.012, SKIN, HWt, sides=6)
    body.sphere(sh + Vector((sx * 0.012, 0, 0.012)), 0.078, lambda tt, sv, p: GOLD if (p.z - sh.z) < -0.025 else RED,
                norm_w({'upperarm_' + t: 0.6, 'shoulder_' + t: 0.4}), scale=(1.15, 1.0, 0.72), sides=14, rings=8)

# ---- 腿（皮肤）+ 短裤 + 赤足（脚踝不戴环，避免和乾坤圈混淆） ----
for t, sx in SIDES.items():
    hp, kn, an = J['hip' + t], J['knee' + t], J['ankle' + t]
    pts = [lerp(hp, kn, k / 4) for k in range(4)] + [lerp(kn, an, k / 4) for k in range(5)]
    rad = [0.074, 0.070, 0.064, 0.058, 0.052, 0.056, 0.050, 0.040, 0.033]
    def lw(tt, p, t=t):
        k = sstep(0.43, 0.57, tt); h = 0.4 * (1 - sstep(0.0, 0.12, tt))
        return norm_w({'thigh_' + t: (1 - k) * (1 - h), 'shin_' + t: k, 'hips': h})
    body.tube(pts, rad, 12, SKIN, lw, cap0=False)
    def shorts(tt, sv, p):
        if tt > 0.9: return RED
        if 0.84 < tt < 0.88: return GOLD
        return LOTUS
    body.tube([lerp(P(sx * 0.08, 0, 0.94), lerp(hp, kn, 0.8), k / 5) for k in range(6)],
              [0.090, 0.090, 0.088, 0.085, 0.082, 0.080], 14, shorts,
              lambda tt, p, t=t: norm_w({'thigh_' + t: 0.6 + 0.4 * tt, 'hips': 0.4 * (1 - tt)}), cap0=False, cap1=False)
    he, to = J['heel' + t], J['toe' + t]
    body.tube([he, lerp(he, to, 0.45), lerp(he, to, 0.8), to], [(0.038, 0.032), (0.046, 0.030), (0.047, 0.022), (0.03, 0.014)],
              10, SKIN, lambda tt, p, t=t: norm_w({'foot_' + t: 0.6 + 0.4 * tt, 'shin_' + t: 0.4 * (1 - tt)}), up=Vector((0, 0, 1)))

# ---- 莲叶甲裙：腰间一圈 8 片莲瓣 ----
for k in range(8):
    a = 2 * math.pi * (k + 0.5) / 8
    top = P(0.150 * math.cos(a), 0.105 * math.sin(a), 1.00); bot = P(0.205 * math.cos(a), 0.150 * math.sin(a), 0.74)
    out = Vector((math.cos(a), math.sin(a) * 0.7, 0)).normalized()
    pts = [lerp(top, bot, i / 8) + out * 0.025 * math.sin(math.pi * i / 8) for i in range(9)]
    tang = Vector((-math.sin(a), math.cos(a) * 0.7, 0)).normalized()
    wd = [0.125 * math.sin(math.pi * min(1.0, 0.25 + 0.75 * i / 8)) ** 0.7 + 0.002 for i in range(9)]
    side = 'L' if math.cos(a) > 0 else 'R'
    kk = 0.3 if abs(math.cos(a)) > 0.35 else 0.0
    body.ribbon(pts, wd, [tang] * 9, lambda tt, v, p: GOLD if abs(v) > 0.38 else mix(RED, LOTUS, sstep(0.55, 1.0, tt) * 0.55),
                lambda tt, p, side=side, kk=kk: norm_w({'hips': 1 - kk * tt, 'thigh_' + side: kk * tt}), cols=4)
# 腰间铃铛与流苏
for sx in (1, -1):
    bp = P(sx * 0.125, -0.075, 0.99)
    body.sphere(bp, 0.018, GOLD, {'hips': 1.0}, sides=8, rings=5)
    for j in (-1, 0, 1):
        body.cone(bp + Vector((j * 0.008, 0, -0.015)), (j * 0.15, -0.05, -1), 0.10, 0.008, RED, {'hips': 1.0}, sides=5)

# ---- 混天绫：披在肩背的一圈 + 两股长尾（各 2.2 m、宽 0.18 m、12 节骨） ----
def band_pt(th):
    ph = math.radians(115) * th
    return P(0.27 * math.sin(ph), 0.16 * math.cos(ph), 1.13 + 0.12 * abs(math.sin(ph)) ** 1.5)
SASH_RED = RED
def sash_col(tt, v, p, tail=False):
    if abs(v) > 0.42: return GOLD                                   # 金边
    if tail and tt > 0.66:                                          # 末端火焰纹
        fr = (tt * 9) % 1.0
        if fr < 0.55 - abs(v) * 1.0: return mix(GOLD, ORANGE, (tt - 0.66) * 2)
        if tt > 0.93: return ORANGE
    return SASH_RED
bp = [band_pt(-1 + 2 * i / 30) for i in range(31)]
bw = []
for i in range(31):
    tg = (bp[min(i + 1, 30)] - bp[max(i - 1, 0)]).normalized(); zz = Vector((0, 0, 1))
    bw.append((zz - tg * zz.dot(tg)).normalized())
def band_w(tt, p):
    k = sstep(0.17, 0.25, abs(p.x)); side = 'L' if p.x > 0 else 'R'
    return norm_w({'chest': 1 - k, 'upperarm_' + side: k})
body.ribbon(bp, [0.13] * 31, bw, lambda tt, v, p: sash_col(tt, v, p), band_w, m=2, cols=4)
SASH_PTS = {}
for t, sx in SIDES.items():
    p0 = band_pt(sx * 95 / 115)
    raw = [Vector((sx * (0.25 * u + 0.06 * math.sin(3 * math.pi * u)), 1.0 * u, 0.35 * u + 0.15 * math.sin(2.6 * math.pi * u)))
           for u in [i / 44 for i in range(45)]]
    ln = sum((raw[i] - raw[i - 1]).length for i in range(1, 45)); kf = 2.2 / ln
    pts = [p0 + r * kf for r in raw]; SASH_PTS[t] = pts
    wd, wdirs = [], []
    for i in range(45):
        u = i / 44
        wd.append(0.18 * (1 - 0.35 * u) * min(1.0, (1 - u) / 0.12) + 0.003)
        tg = (pts[min(i + 1, 44)] - pts[max(i - 1, 0)]).normalized(); zz = Vector((0, 0, 1))
        w0 = (zz - tg * zz.dot(tg)).normalized()
        wdirs.append(Quaternion(tg, sx * math.radians(70) * u) @ w0)
    def tw(u, p, t=t):
        f = min(u * 12, 11.999); i = int(f); a = f - i
        d = {'sash_%s_%02d' % (t, i + 1): 1 - a}
        if i + 2 <= 12: d['sash_%s_%02d' % (t, i + 2)] = a
        return norm_w(d)
    body.ribbon(pts, wd, wdirs, lambda tt, v, p: sash_col(tt, v, p, True), tw, m=2, cols=6)

# ---------------- 火尖枪（独立模型，挂右手骨，不蒙皮） ----------------
spear = B()
hc = J['wriR'] + J['fdirR'] * 0.085
zb = hc.z - 0.80; zt = zb + 2.4; X0, Y0 = hc.x, hc.y
def SP(z, dx=0.0, dy=0.0): return Vector((X0 + dx, Y0 + dy, z))
NW = {}
shaft_z = [zb + 0.05 + (zt - 0.36 - zb - 0.05) * i / 20 for i in range(21)]
spear.tube([SP(z) for z in shaft_z], [0.017] * 21, 10,
           lambda t, sv, p: GOLD if ((p.z - zb) % 0.45) < 0.025 else LACQ, NW)
spear.cone(SP(zb + 0.06), (0, 0, -1), 0.07, 0.02, GOLD, NW, sides=8)                       # 枪尾铜鐏
spear.tube([SP(zt - 0.37), SP(zt - 0.33)], [0.030, 0.026], 10, GOLD, NW)                   # 枪颈
for k in range(12):                                                                         # 红缨
    a = 2 * math.pi * k / 12
    spear.cone(SP(zt - 0.35, 0.022 * math.cos(a), 0.022 * math.sin(a)), (math.cos(a) * 0.35, math.sin(a) * 0.35, -1), 0.17, 0.012,
               RED, NW, sides=5, bend=Vector((math.cos(a) * 0.03, math.sin(a) * 0.03, 0)))
spear.tube([SP(zt - 0.33), SP(zt - 0.29)], [0.020, 0.017], 8, GOLD, NW, m=1)              # 枪头座
bz = [zt - 0.30 + 0.30 * i / 24 for i in range(25)]                                         # 火焰形枪刃（平面朝前）
bwid = [0.085 * (1 - i / 24) ** 0.85 * (1 + 0.30 * math.sin(3 * math.pi * i / 24 + 0.3)) + 0.002 for i in range(25)]
spear.ribbon([SP(z) for z in bz], bwid, [Vector((1, 0, 0))] * 25, lambda t, v, p: mix(GOLD, ORANGE, t * 0.8 + abs(v) * 0.4),
             lambda t, p: NW, m=1, cols=4)
spear.tube([SP(z) for z in bz[:22]], [0.010 * (1 - i / 24) + 0.002 for i in range(22)], 6, GOLD, NW, m=1)   # 中脊
for sx in (1, -1):                                                                          # 倒钩
    spear.cone(SP(zt - 0.27, sx * 0.032), (sx * 0.55, 0, -1), 0.085, 0.012, lambda t, sv, p: mix(GOLD, ORANGE, t), NW, m=1,
               sides=5, flat=0.5, bend=Vector((sx * 0.025, 0, 0.01)))

# ---------------- 风火轮（两只，水平轮，挂脚骨） ----------------
wheels = {}
for t, sx in SIDES.items():
    wb = B(); c = Vector((sx * 0.09, -0.04, 0.028))
    wb.torus(c, (0, 0, 1), 0.16, 0.026, lambda tt, sv, p: mix(GOLD, ORANGE, 0.3 + 0.3 * sv), {}, seg=32, sides=8)
    wb.sphere(c, 0.032, GOLD, {}, sides=10, rings=6, scale=(1, 1, 0.6))
    for k in range(6):
        a = 2 * math.pi * k / 6
        wb.tube([c, c + Vector((math.cos(a), math.sin(a), 0)) * 0.15], [0.007, 0.007], 5, GOLD, {}, cap0=False, cap1=False)
    for k in range(10):                                                                     # 火焰（平时三成亮度、内收）
        a = 2 * math.pi * k / 10; rd = Vector((math.cos(a), math.sin(a), 0))
        wb.cone(c + rd * 0.17, rd + Vector((0, 0.5, 0.35)), 0.085, 0.024, lambda tt, sv, p: mix(GOLD, ORANGE, tt), {},
                sides=5, flat=0.45, bend=Vector((0, 0.03, 0.02)))
    wheels[t] = wb

# ---------------- 生成对象、材质 ----------------
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
    if emit:
        bs.inputs['Emission Color'].default_value = emit; bs.inputs['Emission Strength'].default_value = strength
    m.use_backface_culling = False
    return m
MAT = {
    'body': make_mat('NZ_Body'),
    'ring': make_mat('NZ_UniverseRing_Glow', GOLD, 0.15),            # 乾坤圈：单一发光参数，随蓄力分段提亮
    'sash': make_mat('NZ_Sash_Glow', L('#E04A1E'), 0.22),           # 发光强度：红绫 > 枪尖 > 风火轮（红中带金，保住朱红本色）
    'spear': make_mat('NZ_Spear'),
    'tip': make_mat('NZ_SpearTip_Glow', ORANGE, 0.18),
    'wheel': make_mat('NZ_Wheel_Glow', ORANGE, 0.12),
}
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
wh = {t: build('WindFireWheel_' + t, wheels[t], [MAT['wheel']]) for t in SIDES}

# ---------------- 骨骼（通用人形 + 两条红绫骨链） ----------------
arm = bpy.data.armatures.new('NezhaRig'); rig = bpy.data.objects.new('NezhaRig', arm)
bpy.context.scene.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT'); eb = arm.edit_bones
def bone(n, h, t, parent=None, conn=False):
    b = eb.new(n); b.head = h; b.tail = t
    if parent: b.parent = eb[parent]; b.use_connect = conn
    return b
bone('root', (0, 0, 0), (0, 0, 0.2))
bone('hips', P(0, 0, 0.90), P(0, 0, 1.00), 'root'); bone('spine', P(0, 0, 1.00), P(0, 0, 1.15), 'hips', True)
bone('chest', P(0, 0, 1.15), P(0, 0.01, 1.37), 'spine', True); bone('neck', P(0, 0.01, 1.37), P(0, 0.005, 1.45), 'chest', True)
bone('head', P(0, 0.005, 1.45), P(0, 0.005, 1.70), 'neck', True)
for t, sx in SIDES.items():
    bone('shoulder_' + t, P(sx * 0.03, 0.01, 1.35), J['sho' + t], 'chest')
    bone('upperarm_' + t, J['sho' + t], J['elb' + t], 'shoulder_' + t, True)
    bone('forearm_' + t, J['elb' + t], J['wri' + t], 'upperarm_' + t, True)
    bone('hand_' + t, J['wri' + t], J['tip' + t], 'forearm_' + t, True)
    bone('thigh_' + t, J['hip' + t], J['knee' + t], 'hips')
    bone('shin_' + t, J['knee' + t], J['ankle' + t], 'thigh_' + t, True)
    bone('foot_' + t, J['ankle' + t], lerp(J['heel' + t], J['toe' + t], 0.75), 'shin_' + t, True)
    pts = SASH_PTS[t]; prev = 'chest'
    for k in range(12):
        n = 'sash_%s_%02d' % (t, k + 1)
        bone(n, pts[round(44 * k / 12)], pts[round(44 * (k + 1) / 12)], prev, k > 0); prev = n
bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.bones: obj.vertex_groups.new(name=b.name)
for vi, wd in enumerate(body.W):
    for g, w in wd.items(): obj.vertex_groups[g].add([vi], w, 'REPLACE')
obj.parent = rig; obj.modifiers.new('Armature', 'ARMATURE').object = rig
def bone_parent(o, bname):
    mw = o.matrix_world.copy(); o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = bname
    bpy.context.view_layer.update(); o.matrix_world = mw
bone_parent(sp, 'hand_R'); bone_parent(wh['L'], 'foot_L'); bone_parent(wh['R'], 'foot_R')
bpy.context.view_layer.update()

tris = lambda b: sum(len(f) - 2 for f in b.F)
total = tris(body) + tris(spear) + tris(wheels['L']) * 2
print('NZ_STATS body=%d spear=%d wheels=%d total=%d bones=%d' % (tris(body), tris(spear), tris(wheels['L']) * 2, total, len(arm.bones)))
dg = bpy.context.evaluated_depsgraph_get()
zmax = max((obj.evaluated_get(dg).matrix_world @ v.co).z for v in obj.evaluated_get(dg).data.vertices
           if abs(v.co.y) < 0.2 and abs(v.co.x) < 0.25 and v.co.z > 1.5)
print('NZ_TOP body+buns top above wheel bottom = %.3f m' % zmax)

# ---------------- 导出（A 字静置） ----------------
bpy.ops.object.select_all(action='DESELECT')
for o in (obj, sp, rig, wh['L'], wh['R']): o.select_set(True)
bpy.context.view_layer.objects.active = rig
glb = os.path.join(OUT, 'nezha_v1.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_skins=True, export_animations=False)
print('NZ_GLB', glb, os.path.getsize(glb))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'nezha_v1.blend'))

# ---------------- 渲染 ----------------
sc = bpy.context.scene
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'CYCLES'):
    try: sc.render.engine = eng; break
    except TypeError: pass
try: sc.view_settings.view_transform = 'Standard'
except Exception: pass
world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
def light(name, kind, rot, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    lo = bpy.data.objects.new(name, ld); sc.collection.objects.link(lo); lo.rotation_euler = rot; return lo
light('Key', 'SUN', (math.radians(45), math.radians(-15), math.radians(-35)), 3.0)
light('Rim', 'SUN', (math.radians(-55), math.radians(10), math.radians(160)), 2.2, (0.75, 0.9, 1.0))
light('Fill', 'SUN', (math.radians(70), 0, math.radians(120)), 0.8)
camd = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', camd); sc.collection.objects.link(cam); sc.camera = cam
def look_at(o, tg): o.rotation_euler = (Vector(tg) - o.location).to_track_quat('-Z', 'Y').to_euler()
def bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get(); pts = []
    for o in objs:
        e = o.evaluated_get(dg); pts += [e.matrix_world @ v.co for v in e.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi
NZOBJS = [obj, sp, wh['L'], wh['R']]
def frame(direction, lens=50, pad=1.1):
    lo, hi = bbox(NZOBJS); c = (lo + hi) / 2; r = (hi - lo).length / 2
    camd.type = 'PERSP'; camd.lens = lens
    fov = 2 * math.atan(18 / lens) * (sc.render.resolution_y / sc.render.resolution_x)
    cam.location = c + Vector(direction).normalized() * (r * pad / math.tan(fov / 2)); look_at(cam, c)
def render(path, w=1600, h=900):
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); print('NZ_RENDER', path)
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

# 1) 三视图（A 字静置）+ 地面与 0.5 m 刻度
bg.inputs[0].default_value = L('#DCE2E7'); bg.inputs[1].default_value = 0.9
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.6, -0.01)); fl = bpy.context.active_object; fl.scale = (3, 5, 0.02)
fl.data.materials.append(flat_mat('Floor', '#9AA6AE'))
tk = flat_mat('Tick', '#2A3036'); ticks = []
for k in range(7):
    for (x, y, rz) in ((-0.85, 0.0, 0), (0.0, -0.9, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, k * 0.5)); o = bpy.context.active_object
        o.scale = (0.12 if k % 2 == 0 else 0.07, 0.12 if k % 2 == 0 else 0.07, 0.008); o.data.materials.append(tk); ticks.append(o)
camd.type = 'ORTHO'; camd.ortho_scale = 3.2
views = [('front', (0, -10, 1.3), (math.radians(90), 0, 0)), ('side', (10, 0.75, 1.3), (math.radians(90), 0, math.radians(90))),
         ('back', (0, 10, 1.3), (math.radians(90), 0, math.radians(180)))]
for nm, loc, rot in views:
    cam.location = loc; cam.rotation_euler = rot
    render(os.path.join(OUT, '_turn_%s.png' % nm), 1000, 1000)
subprocess.run(['/opt/homebrew/bin/ffmpeg', '-y', '-loglevel', 'error'] + sum([['-i', os.path.join(OUT, '_turn_%s.png' % v[0])] for v in views], [])
               + ['-filter_complex', 'hstack=inputs=3', os.path.join(OUT, 'render_02_turnaround.png')], check=True)
for v in views: os.remove(os.path.join(OUT, '_turn_%s.png' % v[0]))
for o in [fl] + ticks: o.hide_render = True

# ---- 英雄姿态：前倾、右手提枪斜指、左臂后展、一腿收一腿伸、红绫大弧线越过头顶 ----
pbs = rig.pose.bones
def _apply(name, q):
    pb = pbs[name]; bpy.context.view_layer.update()
    M = rig.matrix_world @ pb.matrix; h = rig.matrix_world @ pb.head
    R = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h)
    pb.matrix = rig.matrix_world.inverted() @ (R @ M); bpy.context.view_layer.update()
def aim(name, d):
    bpy.context.view_layer.update(); pb = pbs[name]
    cur = (pb.tail - pb.head).normalized(); _apply(name, cur.rotation_difference(Vector(d).normalized()))
def rot(name, axis, deg): _apply(name, Quaternion(Vector(axis).normalized(), math.radians(deg)))
rot('hips', (1, 0, 0), 7); rot('chest', (0, 0, 1), -10); rot('chest', (1, 0, 0), 5)
rot('head', (1, 0, 0), -9); rot('head', (0, 0, 1), 9)
aim('upperarm_R', (-0.30, -0.30, -0.90)); aim('forearm_R', (-0.10, -0.92, 0.10)); aim('hand_R', (-0.08, -0.95, 0.0))
bpy.context.view_layer.update()
cur = (sp.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
_apply('hand_R', cur.rotation_difference(Vector((-0.10, -0.62, 0.78)).normalized()))
aim('upperarm_L', (0.72, 0.42, -0.55)); aim('forearm_L', (0.55, 0.62, -0.05)); aim('hand_L', (0.45, 0.75, -0.15))
aim('thigh_L', (0.06, -0.62, -0.78)); aim('shin_L', (0.0, 0.40, -0.92)); aim('foot_L', (0.0, -0.98, -0.12))
aim('thigh_R', (-0.05, 0.25, -0.97)); aim('shin_R', (-0.02, 0.55, -0.83)); aim('foot_R', (0.0, -0.95, -0.25))
for t in SIDES:                                                    # 风火轮保持接近水平（脚骨扭转会把轮子带歪）
    bpy.context.view_layer.update()
    up = (wh[t].matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    _apply('foot_' + t, up.rotation_difference(Vector((0, 0.12, 1)).normalized()))
for t, sx in SIDES.items():
    for k in range(12):
        n = 'sash_%s_%02d' % (t, k + 1)
        rot(n, (1, 0, 0), (10 if t == 'L' else 8) if k < 8 else -7)
        rot(n, (0, 0, 1), sx * 3)

# 2) 英雄图
bg.inputs[0].default_value = L('#DCE2E7'); bg.inputs[1].default_value = 0.9
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
frame((1.0, -0.7, 0.3), lens=50, pad=0.9)
render(os.path.join(OUT, 'render_01_hero.png'), 1600, 1000)
frame((-0.8, 0.9, 0.35), lens=50, pad=0.9)
render(os.path.join(OUT, 'render_03_hero_back.png'), 1600, 1000)

# 3) 30 m 灰模剪影（设计文档 QA 第 20 条：只看灰模，30 m 外能认出哪吒）
grey = flat_mat('Grey', '#9AA0A6')
bpy.context.view_layer.material_override = grey
bg.inputs[0].default_value = L('#1E4560'); bg.inputs[1].default_value = 1.0
lo, hi = bbox(NZOBJS); c = (lo + hi) / 2
camd.type = 'PERSP'; camd.lens = 25
cam.location = c + Vector((-0.55, -0.83, 0.08)).normalized() * 30.0; look_at(cam, c)
render(os.path.join(OUT, '_sil_full.png'), 1920, 1080)
subprocess.run(['/opt/homebrew/bin/ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(OUT, '_sil_full.png'), '-vf',
                'crop=360:200:780:440,scale=1440:800:flags=neighbor', os.path.join(OUT, 'render_04_silhouette_30m.png')], check=True)
os.remove(os.path.join(OUT, '_sil_full.png'))
bpy.context.view_layer.material_override = None

# 4) 与龙王同框：游戏视角（过肩），深海背景，漩涡涡面
DK = os.path.join(os.path.dirname(OUT.rstrip('/')), 'dragon-blender-v1', 'dragon_king_v1.blend')
if os.path.exists(DK):
    with bpy.data.libraries.load(DK, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in ('DragonKing', 'DragonKingRig')]
    for o in dst.objects:
        if o: sc.collection.objects.link(o)
    drig = bpy.data.objects['DragonKingRig']
    drig.location = (1.0, -9.5, 4.2); drig.rotation_euler = (0, 0, math.radians(180))
    for i in range(40):
        b = drig.pose.bones['spine_%02d' % i]; b.rotation_mode = 'XYZ'; s_ = i / 40
        b.rotation_euler = (0.06 * math.sin(2 * math.pi * s_ * 1.1 + 0.3) - (0.05 if i < 5 else 0), 0, 0.2 * math.sin(2 * math.pi * s_ * 1.3 + 0.8))
    drig.pose.bones['head'].rotation_mode = 'XYZ'; drig.pose.bones['head'].rotation_euler = (math.radians(14), 0, math.radians(-6))
    drig.pose.bones['jaw'].rotation_mode = 'XYZ'; drig.pose.bones['jaw'].rotation_euler = (math.radians(18), 0, 0)
    rig.location = (0, 0, 1.15)
    bpy.ops.mesh.primitive_cylinder_add(radius=20, depth=0.1, location=(0, -6, -0.05), vertices=96)
    dc = bpy.context.active_object; dc.data.materials.append(flat_mat('Vortex', '#2C4A5C'))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=0.01, location=(0, 0, 0.01), vertices=48)
    cl = bpy.context.active_object; cl.data.materials.append(flat_mat('ContactLight', '#FFA531', 0.7))
    bg.inputs[0].default_value = L('#0D1E33'); bg.inputs[1].default_value = 1.0
    camd.type = 'PERSP'; camd.lens = 24
    cam.location = (-1.8, 7.6, 4.6); look_at(cam, (0.8, -6.0, 1.3))
    render(os.path.join(OUT, 'render_05_with_dragon.png'), 1600, 900)
print('NZ_DONE')
