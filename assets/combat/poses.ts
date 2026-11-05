/**
 * Procedural action poses for the rigid greybox Nezha (no skeleton): the model is turned
 * about a pivot and the spear is re-placed in model space. Keyframes are in action frames
 * (60 / s). Pure, so poses can be tested and later re-targeted to real animation.
 */
import { NEZHA } from '../shared/nezha-shape.ts';
import type { CombatState, V2 } from './machine.ts';

export type Q = [number, number, number, number];
export type P3 = [number, number, number];

export interface SpearPose {
  readonly pos: P3;
  /** Euler (radians): pitch about X then yaw about Y, applied as Ry * Rx. */
  readonly rx: number;
  readonly ry: number;
}
export interface BodyPose {
  /** Twist about +Y (radians), pitch about X (negative leans forward). */
  readonly twist: number;
  readonly pitch: number;
}
interface Key {
  readonly f: number;
  readonly spear: SpearPose;
  readonly body: BodyPose;
}

const DEG = Math.PI / 180;
export const SPEAR_REST: SpearPose = { pos: [NEZHA.grip[0], NEZHA.grip[1], NEZHA.grip[2]], rx: -NEZHA.spearTiltDeg * DEG, ry: 0 };
const BODY_REST: BodyPose = { twist: 0, pitch: 0 };
const H = -90 * DEG; // spear horizontal, tip forward (-Z)
const k = (f: number, spear: Partial<SpearPose> & { pos?: P3 }, body: Partial<BodyPose> = {}): Key => ({
  f,
  spear: { ...SPEAR_REST, ...spear },
  body: { ...BODY_REST, ...body },
});

const LIGHT: readonly (readonly Key[])[] = [
  // 1: thrust — draw back, stab 0.6 m forward on frame 7, return.
  [k(0, {}), k(6, { pos: [0.24, 1.15, 0.2], rx: H }, { twist: 0.15 }), k(7, { pos: [0.16, 1.15, -0.45], rx: H }, { pitch: -0.12 }), k(11, { pos: [0.16, 1.15, -0.45], rx: H }, { pitch: -0.12 }), k(21, {})],
  // 2: sweep — wind to the right, cut across on frame 7.
  [k(0, {}), k(6, { pos: [0.3, 1.15, -0.1], rx: H, ry: 50 * DEG }, { twist: 0.6 }), k(7, { pos: [0.2, 1.15, -0.3], rx: H, ry: 0 }, { twist: 0 }), k(10, { pos: [0.1, 1.15, -0.2], rx: H, ry: -50 * DEG }, { twist: -0.6 }), k(23, {})],
  // 3: spinning thrust — full turn over frames 1..10, stab on 11.
  [k(0, {}), k(10, { pos: [0.24, 1.15, 0.2], rx: H }, { twist: 2 * Math.PI }), k(11, { pos: [0.14, 1.15, -0.6], rx: H }, { twist: 2 * Math.PI, pitch: -0.15 }), k(16, { pos: [0.14, 1.15, -0.6], rx: H }, { twist: 2 * Math.PI, pitch: -0.15 }), k(33, {}, { twist: 2 * Math.PI })],
];
const CHARGE: readonly Key[] = [k(0, {}), k(12, { pos: [0.25, 1.1, 0.35], rx: -95 * DEG }, { pitch: -10 * DEG })];
const HEAVY: readonly Key[] = [
  k(0, { pos: [0.25, 1.1, 0.35], rx: -95 * DEG }, { pitch: -10 * DEG }),
  // The heavy thrust brings the spear onto the centre line, so the tip flame runs along the judgement axis.
  k(8, { pos: [0, 1.15, -0.55], rx: H }, { pitch: -0.2 }),
  k(15, { pos: [0, 1.15, -0.55], rx: H }, { pitch: -0.2 }),
  k(33, {}),
];
const HURT: readonly Key[] = [k(0, {}), k(4, { rx: 5 * DEG }, { pitch: 8 * DEG }), k(24, {})];
const LOTUS: readonly Key[] = [k(0, {}), k(12, { pos: [0.3, 0.95, 0.05], rx: 0 }, { pitch: 5 * DEG }), k(48, { pos: [0.3, 0.95, 0.05], rx: 0 }, { pitch: 5 * DEG }), k(60, {})];
const SASH: readonly Key[] = [k(0, {}), k(4, { pos: [0.25, 1.3, -0.1], rx: -40 * DEG }, { pitch: -0.05 }), k(12, { pos: [0.2, 1.25, -0.3], rx: -70 * DEG }, { pitch: -0.12 }), k(22, {})];

function sample(keys: readonly Key[], frame: number): { spear: SpearPose; body: BodyPose } {
  if (frame <= keys[0]!.f) return keys[0]!;
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (frame <= b.f) {
      const raw = (frame - a.f) / Math.max(1, b.f - a.f);
      const t = raw * raw * (3 - 2 * raw);
      const mix = (x: number, y: number) => x + (y - x) * t;
      return {
        spear: { pos: [mix(a.spear.pos[0], b.spear.pos[0]), mix(a.spear.pos[1], b.spear.pos[1]), mix(a.spear.pos[2], b.spear.pos[2])], rx: mix(a.spear.rx, b.spear.rx), ry: mix(a.spear.ry, b.spear.ry) },
        body: { twist: mix(a.body.twist, b.body.twist), pitch: mix(a.body.pitch, b.body.pitch) },
      };
    }
  }
  return keys.at(-1)!;
}

/** Roll angle (degrees) per the animator's curve: tuck 30° by f2, 330° by f12, 360° by f16, then unfold. */
export function rollAngleDeg(frame: number): number {
  if (frame <= 0) return 0;
  if (frame <= 2) return 15 * frame;
  if (frame <= 12) return 30 + ((frame - 2) / 10) * 300;
  if (frame <= 16) return 330 + ((frame - 12) / 4) * 30;
  return 360;
}

export function axisAngle(axis: P3, angle: number): Q {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
export function mulQ(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function rotate(q: Q, v: P3): P3 {
  const [qx, qy, qz, qw] = q;
  const ix = qw * v[0] + qy * v[2] - qz * v[1];
  const iy = qw * v[1] + qz * v[0] - qx * v[2];
  const iz = qw * v[2] + qx * v[1] - qy * v[0];
  const iw = -qx * v[0] - qy * v[1] - qz * v[2];
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
export const spearQuat = (s: SpearPose): Q => mulQ(axisAngle([0, 1, 0], s.ry), axisAngle([1, 0, 0], s.rx));

/** Root-local direction of a world direction for a root with yaw `facing`. */
export function toRootLocal(d: V2, facing: number): V2 {
  const c = Math.cos(facing), s = Math.sin(facing);
  return { x: d.x * c - d.z * s, z: d.x * s + d.z * c };
}

export interface ActionVisual {
  readonly spear: SpearPose & { readonly quat: Q };
  /** Model rotation (root-local) and the pivot height above the seabed it turns about. */
  readonly rotation: Q;
  readonly pivotY: number;
  readonly flame: boolean;
  readonly wheelsFull: boolean;
  /** Floats fade out during any action. */
  readonly floatGate: number;
}

/** Pose for the current combat state. `facing` is the root yaw (for the roll direction). */
export function actionVisual(state: CombatState, facing: number): ActionVisual {
  const f = state.frame;
  let pose = { spear: SPEAR_REST, body: BODY_REST };
  let flame = false;
  let wheelsFull = false;
  let pivotY = 0.9;
  let rotation: Q = [0, 0, 0, 1];
  switch (state.kind) {
    case 'light':
      pose = sample(LIGHT[state.stage - 1] ?? LIGHT[0]!, f);
      break;
    case 'charge':
      pose = sample(CHARGE, f);
      break;
    case 'heavy':
      pose = sample(HEAVY, f);
      flame = f >= 7 && f <= 15; // 2 frames before the hit (9) through recovery frame 6
      break;
    case 'hurt':
      pose = sample(HURT, f);
      break;
    case 'lotus':
      pose = sample(LOTUS, f);
      break;
    case 'sash':
      pose = sample(SASH, f);
      break;
    case 'roll': {
      const d = toRootLocal(state.rollDir, facing);
      const axis: P3 = [d.z, 0, -d.x];
      rotation = axisAngle(axis, rollAngleDeg(f) * DEG);
      pivotY = 1.0;
      wheelsFull = f >= 1 && f <= 18;
      // Spear hugged across the chest, parallel to the roll axis.
      const n = Math.hypot(axis[0], axis[2]) || 1;
      const a: P3 = [axis[0] / n, 0, axis[2] / n];
      const ry = Math.atan2(a[0], a[2]) ;
      const tuck = f <= 18 ? 1 : Math.max(0, 1 - (f - 18) / 9);
      pose = {
        spear: {
          pos: [SPEAR_REST.pos[0] + (0 - a[0] * 0.25 - SPEAR_REST.pos[0]) * tuck, SPEAR_REST.pos[1] + (1.1 - SPEAR_REST.pos[1]) * tuck, SPEAR_REST.pos[2] + (-0.12 - a[2] * 0.25 - SPEAR_REST.pos[2]) * tuck],
          rx: SPEAR_REST.rx + (90 * DEG - SPEAR_REST.rx) * tuck,
          ry: ry * tuck,
        },
        body: BODY_REST,
      };
      break;
    }
    default:
      break;
  }
  if (state.kind !== 'roll') {
    rotation = mulQ(axisAngle([0, 1, 0], pose.body.twist), axisAngle([1, 0, 0], pose.body.pitch));
  }
  return {
    spear: { ...pose.spear, quat: spearQuat(pose.spear) },
    rotation,
    pivotY,
    flame,
    wheelsFull,
    floatGate: state.kind === 'free' ? 1 : 0,
  };
}
