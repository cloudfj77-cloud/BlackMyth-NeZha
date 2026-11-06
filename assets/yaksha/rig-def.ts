/**
 * 巡海夜叉 jointed model (v1.4.0 `Chars.buildYaksha`, ported part by part). Hunched, long-armed,
 * fin crest, dark-green skin with coral bone spines, a fish trident; ≈ 1.2 × Nezha so its silhouette
 * never reads as the boss. Rig units = v1.4.0 metres; the root entity scales by LEVEL_SCALE.
 * The model faces +Z (v1.4.0); the root yaw adds π for our −Z-forward convention.
 */
import type { Prim } from '../nezha-rig/rig-def.ts';

type V3 = readonly [number, number, number];

export const YJOINT_NAMES = ['model', 'hips', 'torso', 'head', 'rS', 'rE', 'rH', 'lS', 'lE', 'lH', 'staff', 'lHip', 'lK', 'rHip', 'rK'] as const;
export type YJoint = (typeof YJOINT_NAMES)[number];

/** Hip height of the rest pose (v1.4.0 BH). */
export const Y_BASE_HIP = 1.05;

export const YJOINTS: Readonly<Record<YJoint, { readonly parent: YJoint | null; readonly pos: V3 }>> = {
  model: { parent: null, pos: [0, 0, 0] },
  hips: { parent: 'model', pos: [0, Y_BASE_HIP, 0] },
  torso: { parent: 'hips', pos: [0, 0.08, 0] },
  head: { parent: 'torso', pos: [0, 0.62, 0.14] },
  rS: { parent: 'torso', pos: [-0.3, 0.45, 0.06] },
  rE: { parent: 'rS', pos: [0, -0.42, 0] },
  rH: { parent: 'rE', pos: [0, -0.4, 0] },
  lS: { parent: 'torso', pos: [0.3, 0.45, 0.06] },
  lE: { parent: 'lS', pos: [0, -0.42, 0] },
  lH: { parent: 'lE', pos: [0, -0.4, 0] },
  staff: { parent: 'rH', pos: [0, 0, 0] },
  lHip: { parent: 'hips', pos: [0.14, -0.05, 0] },
  lK: { parent: 'lHip', pos: [0, -0.48, 0] },
  rHip: { parent: 'hips', pos: [-0.14, -0.05, 0] },
  rK: { parent: 'rHip', pos: [0, -0.48, 0] },
};

export const Y_MATERIALS = {
  skin: { color: 0x3a6a5a, rough: 0.55 },
  belly: { color: 0x8aa890, rough: 0.6 },
  fin: { color: 0xc85a3a, rough: 0.5, emissive: 0x200604, twoSided: true },
  bone: { color: 0xe0d0b0, rough: 0.6 },
  cloth: { color: 0x2a2a30, rough: 0.9 },
  iron: { color: 0x5a6066, rough: 0.4, metal: 0.8 },
  eye: { color: 0xffe06a, rough: 0.5, emissive: 0xffb020, emissiveIntensity: 2.5 },
  wood: { color: 0x4a3a2a, rough: 0.8 },
} as const;
export type YMaterial = keyof typeof Y_MATERIALS;
export const yMaterialKey = (m: YMaterial): string => `yaksha-${m}`;

export interface YPart {
  readonly prim: Prim;
  readonly mat: YMaterial;
  readonly p?: V3;
  /** Euler XYZ (three.js order). */
  readonly r?: V3;
  readonly s?: V3;
}

const sph = (r: number, w = 14, h = 10): Prim => ({ kind: 'sphere', r, w, h });
const cap = (r: number, l: number): Prim => ({ kind: 'capsule', r, l });
const cone = (r: number, h: number, seg = 5): Prim => ({ kind: 'cone', r, h, seg });

function arm(): Partial<Record<'sh' | 'el' | 'hand', YPart[]>> {
  return {
    sh: [{ prim: cap(0.07, 0.3), mat: 'skin', p: [0, -0.2, 0] }],
    el: [
      { prim: cap(0.06, 0.3), mat: 'skin', p: [0, -0.18, 0] },
      { prim: { kind: 'torus', R: 0.07, t: 0.02, rs: 6, ts: 12 }, mat: 'iron', p: [0, -0.1, 0], r: [Math.PI / 2, 0, 0] },
    ],
    hand: [
      { prim: sph(0.07, 10, 8), mat: 'skin' },
      ...[0, 1, 2].map((k): YPart => ({ prim: cone(0.018, 0.1, 4), mat: 'bone', p: [(k - 1) * 0.04, -0.08, 0.04], r: [Math.PI * 0.8, 0, 0] })),
    ],
  };
}

function leg(): Partial<Record<'hip' | 'knee', YPart[]>> {
  return {
    hip: [{ prim: cap(0.09, 0.3), mat: 'skin', p: [0, -0.22, 0] }],
    knee: [
      { prim: cap(0.075, 0.3), mat: 'skin', p: [0, -0.2, 0] },
      { prim: { kind: 'box', w: 0.14, h: 0.06, d: 0.26 }, mat: 'skin', p: [0, -0.46, 0.06] },
    ],
  };
}

const ARM = arm();
const LEG = leg();
const SL = 2.4, GRIP = 0.9;

export const YJOINT_PARTS: Partial<Record<YJoint, readonly YPart[]>> = {
  hips: [
    { prim: sph(0.22), mat: 'cloth', s: [1.2, 0.8, 1] },
    { prim: { kind: 'cyl', rt: 0.24, rb: 0.36, h: 0.42, seg: 10 }, mat: 'cloth', p: [0, -0.15, 0] },
  ],
  torso: [
    { prim: cap(0.24, 0.32), mat: 'skin', p: [0, 0.3, 0.04], r: [0.25, 0, 0], s: [1.2, 1, 0.95] },
    { prim: sph(0.2), mat: 'belly', p: [0, 0.22, 0.17], s: [1.1, 1.1, 0.6] },
    ...[0, 1, 2, 3, 4].map((i): YPart => ({ prim: cone(0.04, 0.26 - i * 0.02, 5), mat: 'bone', p: [0, 0.55 - i * 0.1, -0.2 - i * 0.02], r: [-1.0, 0, 0] })),
  ],
  head: [
    { prim: sph(0.2), mat: 'skin', s: [1.05, 0.9, 1.2] },
    { prim: sph(0.13), mat: 'skin', p: [0, -0.08, 0.15], s: [1.2, 0.6, 1] },
    ...[0, 1, 2, 3, 4, 5].map((i): YPart => ({ prim: cone(0.018, 0.07, 4), mat: 'bone', p: [(i - 2.5) * 0.04, -0.12, 0.26], r: [Math.PI, 0, 0] })),
    { prim: sph(0.035, 8, 6), mat: 'eye', p: [-0.09, 0.04, 0.17] },
    { prim: sph(0.035, 8, 6), mat: 'eye', p: [0.09, 0.04, 0.17] },
    // Fin crest and side fins (v1.4.0 open 3-sided cones flattened to 0.15 in x).
    { prim: cone(0.25, 0.5, 3), mat: 'fin', p: [0, 0.22, -0.05], r: [-0.4, 0, 0], s: [0.15, 1, 1] },
    { prim: cone(0.25, 0.5, 3), mat: 'fin', p: [-0.18, 0.02, -0.02], r: [0, 0, -1.2], s: [0.105, 0.7, 0.7] },
    { prim: cone(0.25, 0.5, 3), mat: 'fin', p: [0.18, 0.02, -0.02], r: [0, 0, 1.2], s: [0.105, 0.7, 0.7] },
  ],
  rS: ARM.sh!, rE: ARM.el!, rH: ARM.hand!,
  lS: ARM.sh!, lE: ARM.el!, lH: ARM.hand!,
  staff: [
    { prim: { kind: 'cyl', rt: 0.03, rb: 0.03, h: SL, seg: 8 }, mat: 'wood', p: [0, SL / 2 - GRIP, 0] },
    ...[-1, 0, 1].map((k): YPart => ({ prim: cone(0.03, 0.3, 4), mat: 'iron', p: [k * 0.07, SL - GRIP + 0.12, 0], r: [0, 0, -k * 0.15] })),
    { prim: { kind: 'box', w: 0.2, h: 0.04, d: 0.04 }, mat: 'iron', p: [0, SL - GRIP - 0.02, 0] },
  ],
  lHip: LEG.hip!, lK: LEG.knee!,
  rHip: LEG.hip!, rK: LEG.knee!,
};

/** Pose keys (v1.4.0 KEYS subset used by the yaksha). */
export type YPose = Record<'hipY' | 'hipX' | 'hipZ' | 'tX' | 'tY' | 'tZ' | 'hX' | 'hY' | 'rsX' | 'rsY' | 'rsZ' | 'reX' | 'wX' | 'wY' | 'wZ' | 'lsX' | 'lsY' | 'lsZ' | 'leX' | 'lhX' | 'rhX' | 'lkX' | 'rkX' | 'lhZ' | 'rhZ', number>;
const Y_KEYS = ['hipY', 'hipX', 'hipZ', 'tX', 'tY', 'tZ', 'hX', 'hY', 'rsX', 'rsY', 'rsZ', 'reX', 'wX', 'wY', 'wZ', 'lsX', 'lsY', 'lsZ', 'leX', 'lhX', 'rhX', 'lkX', 'rkX', 'lhZ', 'rhZ'] as const;
export const yZero = (): YPose => Object.fromEntries(Y_KEYS.map((k) => [k, 0])) as YPose;
const pose = (p: Partial<YPose>): YPose => ({ ...yZero(), ...p });

export const M_IDLE = pose({ hipY: -0.1, tX: 0.35, hX: -0.2, rsX: -0.6, reX: -0.9, wX: 1.4, lsX: -0.4, lsZ: -0.3, leX: -0.8, lhX: -0.4, lkX: 0.7, rhX: 0.2, rkX: 0.5 });
export const M_WIND = pose({ hipY: -0.2, tX: -0.1, tY: -0.6, hX: -0.1, rsX: -2.7, rsZ: -0.3, reX: -0.4, wX: 2.1, lsX: -0.9, lsZ: 0.4, lhX: -0.7, lkX: 1.0, rhX: 0.5, rkX: 0.6 });
export const M_STAB = pose({ hipY: -0.25, tX: 0.6, tY: 0.3, rsX: -1.4, rsZ: -0.1, reX: -0.05, wX: 3.0, lsX: 0.3, lhX: -1.0, lkX: 0.6, rhX: 0.6, rkX: 0.3 });
export const M_HURT = pose({ hipY: -0.15, tX: -0.5, hX: -0.4, rsX: 0.3, lsX: 0.4, lhX: -0.3, lkX: 0.6 });
export const M_ALERT = pose({ ...M_IDLE, tX: -0.3, hX: -0.6, rsX: -1.2, lsX: -1.2, lsZ: 0.8 });

export function yBlend(cur: YPose, tgt: YPose, k: number): void {
  for (const key of Y_KEYS) cur[key] += (tgt[key] - cur[key]) * k;
}
export function yMix(a: YPose, b: YPose, u: number): YPose {
  const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  const out = yZero();
  for (const key of Y_KEYS) out[key] = a[key] + (b[key] - a[key]) * e;
  return out;
}

/** Joint Euler (XYZ) for a pose (v1.4.0 applyPose); hips also move in y. */
export function yJointEuler(p: YPose): Partial<Record<YJoint, V3>> {
  return {
    hips: [p.hipX, 0, p.hipZ],
    torso: [p.tX, p.tY, p.tZ],
    head: [p.hX, p.hY, 0],
    rS: [p.rsX, p.rsY, p.rsZ],
    rE: [p.reX, 0, 0],
    staff: [p.wX, p.wY, p.wZ],
    lS: [p.lsX, p.lsY, p.lsZ],
    lE: [p.leX, 0, 0],
    lHip: [p.lhX, 0, p.lhZ],
    rHip: [p.rhX, 0, p.rhZ],
    lK: [p.lkX, 0, 0],
    rK: [p.rkX, 0, 0],
  };
}
export const yHipY = (p: YPose): number => Y_BASE_HIP + p.hipY * (Y_BASE_HIP / 0.98);

/** How many yaksha the level ever has at once (two waves: 2 + 3). */
export const MOB_SLOTS = 5;
export const mobKey = (slot: number, joint?: YJoint): string => (joint ? `mob/${slot}/${joint.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}` : `mob/${slot}`);
