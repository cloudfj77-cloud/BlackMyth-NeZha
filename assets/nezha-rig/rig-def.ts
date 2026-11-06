/**
 * Jointed procedural Nezha (ported from BlackMyth-NeZha v1.4.0 `characters.js` buildNezha /
 * applyPose / HoverMotion; boss 11-06 batch 2). Pure data + math (tested), used at build time
 * (meshes per joint, character.pack.ts), by the scene (joint entities) and at run time (poses).
 *
 * Frame: v1.4.0 units — model origin at the wheels' bottom, +Y up, the character faces +Z.
 * The rig root entity turns it 180° (our characters face −Z) and scales it by RIG_SCALE so the
 * bun tops sit at our silhouette height (1.75 m); the spear is scaled back to 2.4 m.
 */
export type V3 = readonly [number, number, number];
export type Q = readonly [number, number, number, number];

export const RIG_SCALE = 0.86;
/** Hip height in rig units (v1.4.0 BH). */
export const BH = 1.22;
/** Spear: overall length and grip distance from the butt (v1.4.0 SL / grip). */
/** Rig units (× 0.86 = metres): the asset-track v2 spear, 4.83 m, grip 1.55 m from the butt. */
export const SPEAR = Object.freeze({ length: 4.83 / 0.86, grip: 1.55 / 0.86 });

// --- Joints -------------------------------------------------------------------------------------
export const JOINT_NAMES = [
  'hips', 'torso', 'head', 'rS', 'rE', 'rH', 'staffPivot', 'lS', 'lE', 'lH', 'lHip', 'lK', 'lMount', 'lWheel', 'rHip', 'rK', 'rMount', 'rWheel',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

/** Parent (null = rig root) and rest position in the parent (rig units). */
export const JOINTS: Readonly<Record<JointName, { readonly parent: JointName | null; readonly pos: V3 }>> = {
  hips: { parent: null, pos: [0, BH, 0] },
  torso: { parent: 'hips', pos: [0, 0.07, 0] },
  head: { parent: 'torso', pos: [0, 0.56, 0.01] },
  rS: { parent: 'torso', pos: [-0.25, 0.39, 0] },
  rE: { parent: 'rS', pos: [0, -0.29, 0] },
  rH: { parent: 'rE', pos: [0, -0.27, 0] },
  staffPivot: { parent: 'rH', pos: [0, 0, 0] },
  lS: { parent: 'torso', pos: [0.25, 0.39, 0] },
  lE: { parent: 'lS', pos: [0, -0.29, 0] },
  lH: { parent: 'lE', pos: [0, -0.27, 0] },
  lHip: { parent: 'hips', pos: [0.1, -0.05, 0] },
  lK: { parent: 'lHip', pos: [0, -0.4, 0] },
  lMount: { parent: 'lK', pos: [0, -0.53, 0.02] },
  lWheel: { parent: 'lMount', pos: [0, 0, 0] },
  rHip: { parent: 'hips', pos: [-0.1, -0.05, 0] },
  rK: { parent: 'rHip', pos: [0, -0.4, 0] },
  rMount: { parent: 'rK', pos: [0, -0.53, 0.02] },
  rWheel: { parent: 'rMount', pos: [0, 0, 0] },
};

// --- Materials (sRGB hex from v1.4.0) -------------------------------------------------------------
export const RIG_MATERIALS = {
  skin: { color: 0xf0c9a8, rough: 0.7 },
  red: { color: 0xb3160e, rough: 0.75, emissive: 0x2a0200 },
  redDark: { color: 0x5a0a08, rough: 0.85 },
  gold: { color: 0xe2a93a, rough: 0.25, metal: 1 },
  hair: { color: 0x14100e, rough: 0.55 },
  lotusPink: { color: 0xf2a0a8, rough: 0.6, emissive: 0x3a0a10 },
  lotusGreen: { color: 0x3f7a3a, rough: 0.7 },
  steel: { color: 0xd8dce4, rough: 0.2, metal: 1, emissive: 0x401000 },
  shaft: { color: 0x4a1a10, rough: 0.5, metal: 0.2 },
  eye: { color: 0x1a0c08, rough: 0.5, emissive: 0xff3010, emissiveIntensity: 0.6 },
  mark: { color: 0xff2a10, rough: 0.5, emissive: 0xff2a10, emissiveIntensity: 1.5 },
  lip: { color: 0xd88a7a, rough: 0.7 },
  gourd: { color: 0xb08a3e, rough: 0.55, metal: 0.1 },
  /** Spear blade (boss 11-06 20:57): the cutting edge glows orange. */
  blade: { color: 0xffd0a0, rough: 0.2, metal: 0.6, emissive: 0xff6a10, emissiveIntensity: 3.2 },
} as const;
export type RigMaterial = keyof typeof RIG_MATERIALS | 'fire';

/** Asset key of a rig material (kebab-case: redDark → nz-red-dark; fire = the wheel fire). */
export const rigMaterialKey = (m: RigMaterial): string => (m === 'fire' ? 'wheel-fire' : `nz-${m.replace(/[A-Z]/g, (c: string) => `-${c.toLowerCase()}`)}`);

/** kebab-case of a joint name (scene keys and mesh keys): rWheel → r-wheel. */
export const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** Scene entity key of a joint. */
export const jointKey = (name: JointName): string => `player/rig/${kebab(name)}`;

/** sRGB hex → linear RGB triple. */
export function linearRgb(hex: number): [number, number, number] {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

// --- Parts per joint ------------------------------------------------------------------------------
export type Prim =
  | { readonly kind: 'sphere'; readonly r: number; readonly w?: number; readonly h?: number }
  | { readonly kind: 'capsule'; readonly r: number; readonly l: number }
  | { readonly kind: 'torus'; readonly R: number; readonly t: number; readonly rs?: number; readonly ts?: number }
  | { readonly kind: 'cyl'; readonly rt: number; readonly rb: number; readonly h: number; readonly seg?: number }
  | { readonly kind: 'cone'; readonly r: number; readonly h: number; readonly seg?: number }
  | { readonly kind: 'box'; readonly w: number; readonly h: number; readonly d: number };
export interface Part {
  readonly prim: Prim;
  readonly mat: RigMaterial;
  readonly p?: V3;
  /** Euler XYZ (three.js order). */
  readonly r?: V3;
  readonly s?: V3;
  /** Orient +Z toward this point (joint space), like three.js `lookAt` (overrides r). */
  readonly look?: V3;
  /** Extra rotation applied before everything (wheel group yaw). */
  readonly pre?: V3;
}

const sph = (r: number, w = 16, h = 12): Prim => ({ kind: 'sphere', r, w, h });
const cap = (r: number, l: number): Prim => ({ kind: 'capsule', r, l });
const torus = (R: number, t: number, rs = 8, ts = 20): Prim => ({ kind: 'torus', R, t, rs, ts });
const cyl = (rt: number, rb: number, h: number, seg = 12): Prim => ({ kind: 'cyl', rt, rb, h, seg });
const PI = Math.PI;

function hipsParts(): Part[] {
  const parts: Part[] = [{ prim: sph(0.15), mat: 'redDark', s: [1.2, 0.8, 1] }];
  // Lotus skirt: green leaves below, pink petals above.
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * PI * 2;
    const p: V3 = [Math.sin(a) * 0.17, -0.13, Math.cos(a) * 0.15];
    parts.push({ prim: sph(0.13, 10, 6), mat: 'lotusGreen', p, s: [0.9, 1.6, 0.25], look: [p[0] * 3, p[1] * 3 - 0.6, p[2] * 3] });
  }
  for (let i = 0; i < 8; i += 1) {
    const a = ((i + 0.5) / 8) * PI * 2;
    const p: V3 = [Math.sin(a) * 0.16, -0.03, Math.cos(a) * 0.14];
    parts.push({ prim: sph(0.09, 10, 6), mat: 'lotusPink', p, s: [0.8, 1.4, 0.25], look: [p[0] * 3, p[1] * 3 - 0.25, p[2] * 3] });
  }
  parts.push({ prim: torus(0.17, 0.025, 8, 20), mat: 'gold', p: [0, 0.05, 0], r: [PI / 2, 0, 0] });
  // Waist gourd.
  parts.push({ prim: sph(0.045), mat: 'gourd', p: [0.19, 0.01, -0.06] });
  parts.push({ prim: sph(0.065), mat: 'gourd', p: [0.19, -0.08, -0.06] });
  return parts;
}
function torsoParts(): Part[] {
  return [
    { prim: cap(0.17, 0.24), mat: 'skin', p: [0, 0.25, 0], s: [1.1, 1, 0.8] },
    // Red bib (dudou) over the front, gold rim medallion.
    { prim: cyl(0.19, 0.175, 0.34, 14), mat: 'red', p: [0, 0.24, 0.03], s: [1.02, 1, 0.82] },
    { prim: torus(0.1, 0.012, 6, 16), mat: 'gold', p: [0, 0.27, 0.165] },
    // Universe Ring at the neck, lotus-petal shoulder guards, sash band.
    { prim: torus(0.16, 0.032, 10, 32), mat: 'gold', p: [0, 0.47, 0.01], r: [PI / 2 - 0.12, 0, 0] },
    { prim: sph(0.1, 12, 8), mat: 'lotusPink', p: [-0.25, 0.42, 0], r: [0, 0, 0.5], s: [1.1, 0.5, 1] },
    { prim: sph(0.1, 12, 8), mat: 'lotusPink', p: [0.25, 0.42, 0], r: [0, 0, -0.5], s: [1.1, 0.5, 1] },
    { prim: { kind: 'box', w: 0.05, h: 0.4, d: 0.015 }, mat: 'red', p: [-0.05, 0.25, 0.17], r: [0, 0, -0.5] },
  ];
}
function headParts(): Part[] {
  const parts: Part[] = [
    { prim: sph(0.14), mat: 'skin', p: [0, 0.02, 0], s: [1, 1.08, 1] },
    { prim: sph(0.145), mat: 'hair', p: [0, 0.07, -0.02], s: [1.02, 0.85, 1.02] },
    { prim: { kind: 'box', w: 0.17, h: 0.02, d: 0.03 }, mat: 'hair', p: [0, 0.05, 0.13], r: [0.2, 0, 0] },
    { prim: sph(0.016, 8, 6), mat: 'eye', p: [-0.045, 0.01, 0.13] },
    { prim: sph(0.016, 8, 6), mat: 'eye', p: [0.045, 0.01, 0.13] },
    // Fire mark between the brows, lips.
    { prim: { kind: 'cone', r: 0.014, h: 0.05, seg: 4 }, mat: 'mark', p: [0, 0.07, 0.138], r: [0.15, 0, 0] },
    { prim: sph(0.03, 8, 6), mat: 'lip', p: [0, -0.07, 0.125], s: [1.3, 0.5, 0.6] },
  ];
  // Twin hair buns with red ties.
  for (const x of [0.1, -0.1]) {
    parts.push({ prim: sph(0.065), mat: 'hair', p: [x, 0.17, -0.02] });
    parts.push({ prim: torus(0.05, 0.012, 6, 14), mat: 'red', p: [x, 0.15, -0.02], r: [PI / 2, 0, 0] });
  }
  return parts;
}
const upperArm = (): Part[] => [
  { prim: cap(0.055, 0.19), mat: 'skin', p: [0, -0.14, 0] },
  { prim: torus(0.06, 0.012, 6, 14), mat: 'gold', p: [0, -0.06, 0], r: [PI / 2, 0, 0] },
];
const foreArm = (): Part[] => [
  { prim: cap(0.048, 0.16), mat: 'skin', p: [0, -0.11, 0] },
  { prim: torus(0.055, 0.014, 6, 14), mat: 'gold', p: [0, -0.17, 0], r: [PI / 2, 0, 0] },
];
const hand = (): Part[] => [{ prim: sph(0.048), mat: 'skin', s: [1, 1.1, 0.9] }];
const thigh = (): Part[] => [{ prim: cap(0.072, 0.24), mat: 'redDark', p: [0, -0.19, 0] }];
const shin = (): Part[] => [
  { prim: cap(0.058, 0.26), mat: 'skin', p: [0, -0.18, 0] },
  { prim: torus(0.06, 0.014, 6, 14), mat: 'gold', p: [0, -0.33, 0], r: [PI / 2, 0, 0] },
  { prim: { kind: 'box', w: 0.085, h: 0.05, d: 0.19 }, mat: 'redDark', p: [0, -0.42, 0.035] },
];
/** Upright rolling Wind-Fire Wheel (wheel group turned 90° about Y, as in v1.4.0). */
function wheelParts(): Part[] {
  const pre: V3 = [0, PI / 2, 0];
  const parts: Part[] = [
    { prim: torus(0.16, 0.034, 10, 32), mat: 'gold', pre },
    { prim: torus(0.11, 0.02, 8, 26), mat: 'red', pre },
    { prim: cyl(0.105, 0.105, 0.03, 24), mat: 'red', r: [PI / 2, 0, 0], pre },
    { prim: sph(0.04, 10, 8), mat: 'gold', pre },
    { prim: torus(0.2, 0.05, 8, 32), mat: 'fire', pre },
  ];
  for (let k = 0; k < 6; k += 1) parts.push({ prim: { kind: 'box', w: 0.016, h: 0.3, d: 0.02 }, mat: 'gold', r: [0, 0, (k / 6) * PI], pre });
  for (let k = 0; k < 12; k += 1) {
    const a = (k / 12) * PI * 2;
    parts.push({ prim: { kind: 'cone', r: 0.05, h: 0.22, seg: 6 }, mat: 'fire', p: [Math.cos(a) * 0.23, Math.sin(a) * 0.23, 0], r: [0, 0, a - PI / 2], pre });
  }
  return parts;
}
/** Red-tasselled spear in grip space (+Y toward the tip). */
export function spearParts(): Part[] {
  const { length: SL, grip } = SPEAR;
  return [
    { prim: cyl(0.024, 0.026, SL, 10), mat: 'shaft', p: [0, SL / 2 - grip, 0] },
    { prim: { kind: 'cone', r: 0.06, h: 0.34, seg: 4 }, mat: 'blade', p: [0, SL - grip + 0.17, 0], s: [1, 1, 0.3] },
    { prim: cyl(0.035, 0.028, 0.08, 10), mat: 'gold', p: [0, SL - grip - 0.02, 0] },
    { prim: cyl(0.03, 0.03, 0.12, 10), mat: 'gold', p: [0, -grip + 0.06, 0] },
  ];
}

/** Meshes carried by joints (the spear is its own entity under staffPivot). */
export const JOINT_PARTS: Readonly<Partial<Record<JointName, readonly Part[]>>> = {
  hips: hipsParts(),
  torso: torsoParts(),
  head: headParts(),
  rS: upperArm(),
  rE: foreArm(),
  rH: hand(),
  lS: upperArm(),
  lE: foreArm(),
  lH: hand(),
  lHip: thigh(),
  lK: shin(),
  lWheel: wheelParts(),
  rHip: thigh(),
  rK: shin(),
  rWheel: wheelParts(),
};
/** Material slot order of a part list (one submesh per material, in first-use order). */
export function slotsOf(parts: readonly Part[]): RigMaterial[] {
  const out: RigMaterial[] = [];
  for (const p of parts) if (!out.includes(p.mat)) out.push(p.mat);
  return out;
}

/** Pins in joint space (rig units) for ribbons and effects. */
export const PINS = Object.freeze({
  backL: { joint: 'torso' as JointName, pos: [0.2, 0.45, -0.12] as V3 },
  backR: { joint: 'torso' as JointName, pos: [-0.2, 0.45, -0.12] as V3 },
  waist: { joint: 'hips' as JointName, pos: [-0.12, 0.0, -0.14] as V3 },
  bunL: { joint: 'head' as JointName, pos: [0.1, 0.17, -0.02] as V3 },
  bunR: { joint: 'head' as JointName, pos: [-0.1, 0.17, -0.02] as V3 },
  armL: { joint: 'lE' as JointName, pos: [0, 0, 0] as V3 },
  /** On the spear (grip space): the tassel, just under the head. */
  tassel: { joint: 'staffPivot' as JointName, pos: [0, SPEAR.length - SPEAR.grip - 0.07, 0] as V3 },
  tip: { joint: 'staffPivot' as JointName, pos: [0, SPEAR.length - SPEAR.grip, 0] as V3 },
});

// --- Quaternion helpers -------------------------------------------------------------------------------
export function qAxis(axis: V3, angle: number): Q {
  const n = Math.hypot(...axis) || 1;
  const s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
export function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
/** three.js Euler 'XYZ' (intrinsic): R = Rx · Ry · Rz. */
export function qEuler(x: number, y: number, z: number): Q {
  return qMul(qMul(qAxis([1, 0, 0], x), qAxis([0, 1, 0], y)), qAxis([0, 0, 1], z));
}
/** Rotation turning +Z toward `dir` (three.js Object3D.lookAt for non-cameras, up +Y). */
export function qLook(dir: V3): Q {
  const zn = Math.hypot(...dir) || 1;
  const z: V3 = [dir[0] / zn, dir[1] / zn, dir[2] / zn];
  let x: V3 = [z[2], 0, -z[0]]; // up × z
  let xn = Math.hypot(...x);
  if (xn < 1e-6) {
    x = [1, 0, 0];
    xn = 1;
  }
  x = [x[0] / xn, x[1] / xn, x[2] / xn];
  const y: V3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
/** Rotate v by q. */
export function qRotate(q: Q, v: V3): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const ix = qw * v[0] + qy * v[2] - qz * v[1];
  const iy = qw * v[1] + qz * v[0] - qx * v[2];
  const iz = qw * v[2] + qx * v[1] - qy * v[0];
  const iw = -qx * v[0] - qy * v[1] - qz * v[2];
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
/** Placement of a part in its joint: translation and rotation (a group pre-rotation wraps both). */
export function partPlace(part: Part): { readonly t: V3; readonly r: Q } {
  const base = part.look ? qLook([part.look[0] - (part.p?.[0] ?? 0), part.look[1] - (part.p?.[1] ?? 0), part.look[2] - (part.p?.[2] ?? 0)]) : qEuler(...(part.r ?? [0, 0, 0]));
  const t: V3 = part.p ?? [0, 0, 0];
  if (!part.pre) return { t, r: base };
  const pre = qEuler(...part.pre);
  return { t: qRotate(pre, t), r: qMul(pre, base) };
}

// --- Poses (v1.4.0 KEYS, radians) -------------------------------------------------------------------------
export const KEYS = ['hipY', 'hipX', 'hipZ', 'tX', 'tY', 'tZ', 'hX', 'hY', 'rsX', 'rsY', 'rsZ', 'reX', 'wX', 'wY', 'wZ', 'lsX', 'lsY', 'lsZ', 'leX', 'lhX', 'rhX', 'lkX', 'rkX', 'lhZ', 'rhZ'] as const;
export type PoseKey = (typeof KEYS)[number];
export type Pose = Record<PoseKey, number>;
export type PosePatch = Partial<Pose>;

export const zeroPose = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose;
const make = (patch: PosePatch): Pose => ({ ...zeroPose(), ...patch });

export const P_IDLE = make({ hipY: -0.04, tX: 0.12, rsX: -0.45, rsZ: -0.15, reX: -0.9, wX: 1.65, wZ: 0.45, lsX: -0.55, lsZ: -0.25, leX: -1.0, lhX: -0.15, rhX: 0.2, lkX: 0.25, rkX: 0.3 });
const relax = (o: PosePatch): Pose => ({ ...P_IDLE, ...o });
const L1a: PosePatch = { tY: -0.9, tX: 0.1, rsX: -0.35, rsZ: -1.25, reX: -0.3, wX: 1.57, wZ: 0, lsX: -0.4, lsZ: 0.7, leX: -0.4, hipY: -0.08, lhX: -0.45, lkX: 0.5, rhX: 0.35, rkX: 0.25 };
const L1b: PosePatch = { tY: 1.05, tX: 0.2, rsX: -0.2, rsZ: -1.2, reX: -0.2, wX: 1.57, wZ: 0, lsX: -0.2, lsZ: 0.9, leX: -0.4, hipY: -0.14, lhX: -0.6, lkX: 0.6, rhX: 0.4, rkX: 0.3 };
const L2a: PosePatch = { tY: 1.0, tX: 0.1, rsX: -1.3, rsZ: 0.55, reX: -0.3, wX: 1.4, wZ: 0, lsX: -0.3, lsZ: 0.2, leX: -0.6, hipY: -0.08, lhX: 0.3, lkX: 0.25, rhX: -0.45, rkX: 0.5 };
const L2b: PosePatch = { tY: -1.05, tX: 0.2, rsX: -0.3, rsZ: -1.3, reX: -0.2, wX: 1.57, wZ: 0, lsX: -0.3, lsZ: 0.5, leX: -0.5, hipY: -0.14, lhX: 0.35, lkX: 0.3, rhX: -0.6, rkX: 0.6 };
const L3a: PosePatch = { tX: -0.25, hX: -0.2, rsX: -2.85, rsZ: -0.15, reX: -0.5, wX: 2.05, wZ: 0, lsX: -2.6, lsZ: -0.2, leX: -0.6, hipY: -0.02, lhX: -0.2, lkX: 0.2, rhX: 0.2, rkX: 0.2 };
export const L3b: PosePatch = { tX: 0.5, hX: 0.15, rsX: -0.95, rsZ: -0.1, reX: -0.2, wX: 3.3, wZ: 0, lsX: -1.1, lsZ: -0.3, leX: -0.4, hipY: -0.28, lhX: -0.7, lkX: 0.8, rhX: 0.45, rkX: 0.5 };
export const HC: PosePatch = { tX: -0.2, hX: -0.1, rsX: -2.9, rsZ: -0.15, reX: -0.4, wX: 2.3, wZ: 0, lsX: -2.7, lsZ: -0.2, leX: -0.5, hipY: -0.18, lhX: -0.6, lkX: 0.75, rhX: 0.45, rkX: 0.55 };
const HR: PosePatch = { tX: 0.6, hX: 0.2, rsX: -0.85, rsZ: -0.1, reX: -0.15, wX: 3.4, wZ: 0, lsX: -1.0, lsZ: -0.3, leX: -0.3, hipY: -0.38, lhX: -0.85, lkX: 1.0, rhX: 0.5, rkX: 0.6 };
export const ROLL_TUCK = make({ hipY: -0.3, tX: 1.05, tY: 0, hX: 0.6, rsX: -1.3, rsZ: -0.1, reX: -1.7, wX: 0.5, wZ: 0, lsX: -1.3, lsZ: -0.2, leX: -1.7, lhX: -1.9, lkX: 2.5, rhX: -1.9, rkX: 2.5 });
export const JUMP_UP = make({ hipY: -0.04, tX: 0.28, hX: -0.1, rsX: 0.5, rsZ: -0.35, reX: -0.6, wX: -1.9, wZ: 0.2, lsX: -1.5, lsZ: 0.5, leX: -0.7, lhX: -1.25, lkX: 1.7, rhX: -0.15, rkX: 0.7 });
export const JUMP_DOWN = make({ hipY: -0.02, tX: 0.12, hX: 0.05, rsX: 0.1, rsZ: -0.45, reX: -0.5, wX: -1.6, wZ: 0.2, lsX: -0.6, lsZ: 0.7, leX: -0.5, lhX: -0.55, lkX: 0.6, rhX: 0.15, rkX: 0.35 });
export const P_HURT = relax({ tX: -0.45, hX: -0.4, hipY: -0.1, rsX: 0.2, lsX: 0.4, lhX: -0.3, lkX: 0.5 });
export const P_DRINK = relax({ lsX: -2.35, lsZ: -0.55, leX: -1.7, hX: -0.45, tX: -0.05 });
export const P_CAST = relax({ lsX: -1.55, lsZ: -0.05, leX: -0.15, tY: -0.35, hY: 0.2 });
export const P_DEAD = relax({ tX: -0.2, hX: -0.3, rsX: -2.5, rsZ: -0.6, lsX: -2.5, lsZ: 0.6, lhX: -0.2, rhX: 0.1, lkX: 0.3, hipY: 0 });

type Frames = readonly (readonly [number, PosePatch])[];
/** Light combo keyframes over the normalised action time (v1.4.0 LIGHT[0..2]). */
export const LIGHT_KF: readonly Frames[] = [
  [[0, L1a], [0.28, { ...L1a, tY: -1.1 }], [0.56, L1b], [1, relax({ tY: 0.3, rsZ: -0.4 })]],
  [[0, L2a], [0.28, { ...L2a, tY: 1.15 }], [0.56, L2b], [1, relax({ tY: -0.3 })]],
  [[0, L3a], [0.3, { ...L3a, rsX: -3.05, tX: -0.3 }], [0.5, L3b], [0.75, L3b], [1, relax({ tX: 0.3 })]],
];
const L4a: PosePatch = { tY: -0.4, tX: 0.2, rsX: -0.1, rsZ: -1.45, reX: 0, wX: Math.PI, wZ: 0, lsX: -0.2, lsZ: 1.2, leX: -0.2, hipY: -0.16, lhX: -0.4, lkX: 0.5, rhX: 0.3, rkX: 0.4 };
/** v1.4.0 LIGHT[3] 回旋枪: arms out, spear level, the whole body spins once (see `spinOf`). */
export const LIGHT4_KF: Frames = [[0, L4a], [0.22, { ...L4a, tY: -0.6 }], [0.65, { ...L4a, tY: 0.2 }], [1, relax({})]];
/** v1.4.0 `extra.spin` for the 4th hit: one full turn over 22 %–65 % of the move, eased. */
export function spinOf(u: number): number {
  const k = Math.min(1, Math.max(0, (u - 0.22) / 0.43));
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  return Math.PI * 2 * e;
}
export const HEAVY_KF: Frames = [[0, HC], [0.18, { ...HC, rsX: -3.15, tX: -0.35 }], [0.36, HR], [0.7, HR], [1, relax({ tX: 0.3 })]];
/** Nezha gliding on her wheels (v1.4.0 `CH.glide`): upright torso, spear trailing. */
export function glidePose(speed: number): Pose {
  const lean = Math.min(1, Math.max(0, speed / 9.5));
  return relax({ tX: 0.06, tY: 0.12, hipY: 0, rsX: 0.35 + lean * 0.5, rsZ: -0.25, reX: -0.5, wX: -1.9 - lean * 0.4, wZ: 0.25, lsX: -0.5 - lean * 0.5, lsZ: 0.35 + lean * 0.3, leX: -0.6 });
}

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** v1.4.0 `keyframes`: eased interpolation between the keys around t, on top of `base`. */
export function keyframes(base: Pose, frames: Frames, t: number): Pose {
  const out: Pose = { ...base };
  let i = 0;
  while (i < frames.length - 1 && t > frames[i + 1]![0]) i += 1;
  const [t0, a] = frames[i]!;
  const [t1, b] = frames[Math.min(i + 1, frames.length - 1)]!;
  const u = t1 > t0 ? ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 1;
  for (const k of KEYS) {
    if (!(k in a) && !(k in b)) continue;
    const va = a[k] ?? base[k], vb = b[k] ?? base[k];
    out[k] = va + (vb - va) * u;
  }
  return out;
}
export function blendPose(cur: Pose, tgt: Pose, k: number): void {
  for (const key of KEYS) cur[key] += (tgt[key] - cur[key]) * k;
}

/** Joint rotations from a pose (v1.4.0 applyPose, joint part): hips height and Euler XYZ per joint. */
export function poseJoints(p: Pose): { readonly hipsY: number; readonly rot: Readonly<Partial<Record<JointName, V3>>> } {
  return {
    hipsY: BH + p.hipY * (BH / 0.98),
    rot: {
      hips: [p.hipX, 0, p.hipZ],
      torso: [p.tX, p.tY, p.tZ],
      head: [p.hX, p.hY, 0],
      rS: [p.rsX, p.rsY, p.rsZ],
      rE: [p.reX, 0, 0],
      staffPivot: [p.wX, p.wY, p.wZ],
      lS: [p.lsX, p.lsY, p.lsZ],
      lE: [p.leX, 0, 0],
      lHip: [p.lhX, 0, p.lhZ],
      rHip: [p.rhX, 0, p.rhZ],
      lK: [p.lkX, 0, 0],
      rK: [p.rkX, 0, 0],
    },
  };
}

// --- HoverMotion (v1.4.0): springs driving the floating body ---------------------------------------
export class Spring {
  x = 0;
  v = 0;
  constructor(public f = 3, public z = 0.6) {}
  step(target: number, dt: number, force = 0): number {
    const w = 2 * Math.PI * this.f;
    const a = w * w * (target - this.x) - 2 * this.z * w * this.v + force;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

/** Per-state float profiles (v1.4.0): hover height (m), legs tuck 0..1, extra lean (rad), drift. */
export const HOVER_PROFILES = {
  idle: { hover: 0.58, bob: 0.065, freq: 0.5, legs: 0.35, lean: 0.0, drift: 1.0 },
  move: { hover: 0.48, bob: 0.045, freq: 0.9, legs: 0.5, lean: 0.12, drift: 0.6 },
  sprint: { hover: 0.4, bob: 0.025, freq: 1.4, legs: 0.85, lean: 0.3, drift: 0.3 },
  attack: { hover: 0.42, bob: 0.015, freq: 1.2, legs: 0.55, lean: 0.1, drift: 0.2 },
  heavy: { hover: 0.3, bob: 0.01, freq: 1.0, legs: 0.9, lean: 0.05, drift: 0.1 },
  charge: { hover: 0.85, bob: 0.03, freq: 2.2, legs: 1.0, lean: -0.05, drift: 0.2 },
  roll: { hover: 0.55, bob: 0, freq: 0, legs: 1.0, lean: 0.0, drift: 0 },
  jump: { hover: 0.3, bob: 0, freq: 0, legs: 0.7, lean: 0.05, drift: 0.2 },
  airatk: { hover: 0.2, bob: 0, freq: 0, legs: 1.0, lean: 0.25, drift: 0 },
  land: { hover: 0.3, bob: 0, freq: 0, legs: 0.7, lean: 0.05, drift: 0.2 },
  cast: { hover: 0.95, bob: 0.05, freq: 1.6, legs: 0.6, lean: -0.08, drift: 0.4 },
  drink: { hover: 0.62, bob: 0.05, freq: 0.7, legs: 0.4, lean: -0.04, drift: 0.8 },
  hurt: { hover: 0.38, bob: 0, freq: 0, legs: 0.6, lean: -0.3, drift: 0 },
  dead: { hover: 0.12, bob: 0, freq: 0, legs: 0.2, lean: 0, drift: 0 },
} as const;
export type HoverState = keyof typeof HOVER_PROFILES;

export interface HoverOut {
  /** Height offset relative to the idle hover (m); our approved base 1.15 m and bob are added elsewhere. */
  dy: number;
  pitch: number;
  roll: number;
  pelvisYaw: number;
  headYaw: number;
  thigh: number;
  shin: number;
  legSide: number;
  arm: number;
  legs: number;
}

/**
 * Inertia layer (v1.4.0 HoverMotion, our frame): lean forward with acceleration, back when braking
 * (sinking and bouncing back), bank into turns, pelvis lags, head looks where you steer, legs swing.
 * Facing convention here: yaw 0 = −Z (ours), so forward = (−sin, −cos).
 */
export class HoverMotion {
  private h = new Spring(1.8, 0.55);
  private pitchS = new Spring(2.2, 0.5);
  private rollS = new Spring(2.0, 0.45);
  private pelvis = new Spring(2.6, 0.5);
  private headS = new Spring(4.0, 0.7);
  private thighS = new Spring(2.4, 0.4);
  private shinS = new Spring(3.2, 0.35);
  private sideS = new Spring(2.0, 0.45);
  private armS = new Spring(2.4, 0.4);
  private prev = { x: 0, z: 0 };
  private prevYaw = 0;
  private yawRate = 0;
  private t = 0;
  out: HoverOut = { dy: 0, pitch: 0, roll: 0, pelvisYaw: 0, headYaw: 0, thigh: 0, shin: 0, legSide: 0, arm: 0, legs: 0.35 };

  reset(facing = 0) {
    for (const s of [this.h, this.pitchS, this.rollS, this.pelvis, this.headS, this.thighS, this.shinS, this.sideS, this.armS]) s.reset();
    this.prev = { x: 0, z: 0 };
    this.prevYaw = facing;
    this.yawRate = 0;
  }

  feed(dt: number, state: HoverState, vel: { x: number; z: number }, vy: number, facing: number, inputYaw: number | null): HoverOut {
    if (dt <= 0) return this.out;
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const prof = HOVER_PROFILES[state];
    const ax = (vel.x - this.prev.x) / dt, az = (vel.z - this.prev.z) / dt;
    this.prev = { x: vel.x, z: vel.z };
    // World acceleration → body frame (forward = (−sin f, −cos f), right = (cos f, −sin f)).
    const s = Math.sin(facing), c = Math.cos(facing);
    const aF = Math.max(-40, Math.min(40, -ax * s - az * c));
    const aS = Math.max(-40, Math.min(40, ax * c - az * s));
    let dy = facing - this.prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.prevYaw = facing;
    const yawRateNew = dy / dt;
    const yawAcc = (yawRateNew - this.yawRate) / dt;
    this.yawRate = yawRateNew;
    const speed = Math.hypot(vel.x, vel.z);
    const G = 9.8, t = this.t;
    const drift = prof.drift * 0.02 * Math.sin(t * 0.37 + 2.1);
    const sink = -Math.min(0.12, Math.max(0, -aF) * 0.004);
    const o = this.out;
    // v1.4.0 height: state base + two-frequency bob + drift + braking sink, on a soft spring.
    // Our model origin already sits at the idle hover (move.hoverHeight = 0.58 × 0.86): dy is the rest, in metres.
    const bob = prof.bob * (Math.sin(t * prof.freq * Math.PI * 2) * 0.7 + Math.sin(t * prof.freq * Math.PI * 2 * 1.618 + 1.3) * 0.3);
    o.dy = this.h.step(prof.hover - HOVER_PROFILES.idle.hover + bob + drift + sink, dt) * RIG_SCALE;
    const leanA = Math.atan2(aF, G) * 0.35 + Math.min(0.14, speed * 0.014) + prof.lean * 0.5;
    o.pitch = this.pitchS.step(Math.max(-0.35, Math.min(0.38, leanA)), dt);
    // Turning left (yaw rate > 0 here) banks left: roll toward the inside of the turn.
    const centri = this.yawRate * speed;
    const rollT = Math.atan2(aS * 0.5 - centri * 0.6, G) + Math.sin(t * 0.43) * 0.025 * prof.drift;
    o.roll = this.rollS.step(Math.max(-0.5, Math.min(0.5, rollT)), dt);
    o.pelvisYaw = this.pelvis.step(0, dt, -yawAcc * 0.35);
    let hy = 0;
    if (inputYaw !== null) hy = Math.atan2(Math.sin(inputYaw - facing), Math.cos(inputYaw - facing));
    o.headYaw = this.headS.step(Math.max(-0.6, Math.min(0.6, hy * 0.6)), dt);
    o.thigh = this.thighS.step(prof.legs * 0.25, dt, -aF * 1.4 - vy * 1.5);
    o.shin = this.shinS.step(0, dt, this.thighS.v * 9);
    o.legSide = this.sideS.step(0, dt, -centri * 2.2 + aS * 0.8);
    o.arm = this.armS.step(0, dt, -aF * 1.2);
    o.legs = prof.legs;
    return o;
  }

  /** Hover leg layer (v1.4.0 apply): legs never step — tucked by state, swung by inertia. */
  legs(time: number): { lHip: V3; rHip: V3; lK: V3; rK: V3 } {
    const o = this.out, tuck = o.legs;
    const sw = Math.sin(time * 1.3) * 0.06, sw2 = Math.sin(time * 1.3 + 1.1) * 0.06;
    return {
      lHip: [-0.28 - tuck * 0.55 + o.thigh + sw, 0, o.legSide * 0.6 + 0.06],
      rHip: [0.12 - tuck * 0.2 + o.thigh * 0.85 + sw2, 0, o.legSide * 0.6 - 0.06],
      lK: [0.55 + tuck * 0.9 + o.shin, 0, 0],
      rK: [0.35 + tuck * 0.5 + o.shin * 0.8, 0, 0],
    };
  }
}
