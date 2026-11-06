/**
 * 东海 · 陈塘关 static geometry (v1.4.0 `sea.js` ported at LEVEL_SCALE). Each function returns one
 * merged mesh (one draw per material slot); colliders are not here — `seaConstrain` owns walking.
 * Deterministic: `seeded(808)` like v1.4.0's `U.rng(808)`, never Math.random().
 */
import {
  createBoxGeometry,
  createCylinderGeometry,
  createIcosahedronGeometry,
  createPlaneGeometry,
  createSphereGeometry,
} from '@forgeax/engine/geometry';
import type { MeshAsset } from '@forgeax/engine/types';
import { slot } from '../shared/asset-refs.ts';
import { seeded } from '../shared/layout.ts';
import { axisAngle, displaceMesh, euler, fbm3, fromTo, MeshKit, mulQ, rotate, yawQ, type V3 } from '../shared/mesh-kit.ts';
import { ARENA_PILLARS, GATE_PILLAR_HEIGHT, GATE_PILLARS, LEVEL_SCALE as S, SEA, SEA_LAMPS, WRECKS } from '../shared/sea-layout.ts';

const HX = 4.2; // v1.4.0 units below; every placement goes through `s()` / S.
const Z0 = 22, Z1 = 142, R = 24, GZ = 27.5;
const s3 = (x: number, y: number, z: number): V3 => [x * S, y * S, z * S];

/**
 * v1.4.0 `roof`: CylinderGeometry(top, 1, 1, 4) with the 45° turn baked into the geometry *before* the
 * w × d scale (MeshKit scales before it rotates, so the turn must already be in the source mesh).
 */
const ROOF_CACHE = new Map<number, MeshAsset>();
function roofMesh(top: number): MeshAsset {
  let m = ROOF_CACHE.get(top);
  if (!m) {
    m = new MeshKit().add(createCylinderGeometry(top, 1, 1, 4, 1), { r: yawQ(Math.PI / 4) }, 0).build([slot('Roof', 'sea-tile')]);
    ROOF_CACHE.set(top, m);
  }
  return m;
}
function addRoof(kit: MeshKit, slotIndex: number, w: number, d: number, h: number, x: number, y: number, z: number, top = 0.3, ry = 0): void {
  const k = 1 / Math.SQRT1_2;
  kit.add(roofMesh(top), { t: s3(x, y, z), r: yawQ(ry), s: [(w / 2) * k * S, h * S, (d / 2) * k * S] }, slotIndex);
}

const box = (kit: MeshKit, slotIndex: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  kit.add(createBoxGeometry(w * S, h * S, d * S), { t: s3(x, y, z), r: euler(rx, ry, rz) }, slotIndex);
const cyl = (kit: MeshKit, slotIndex: number, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 16) =>
  kit.add(createCylinderGeometry(rt * S, rb * S, h * S, seg, 1), { t: s3(x, y, z) }, slotIndex);

/** ① Boardwalk: stone footing, salt-bleached planks (a few missing), broken railings, sea lamps, wrecks, the 「陈塘关」 arch. */
export function seaWalk(): MeshAsset {
  const kit = new MeshKit();
  const rnd = seeded(808);
  // Slots: 0 rock, 1 wood, 2 stone, 3 jade-dark, 4 lamp glow, 5 tile, 6 red lacquer, 7 gold, 8 plaque.
  const pathLen = Z1 - Z0;
  box(kit, 0, HX * 2 + 1.4, 2.2, pathLen + 2, 0, -1.25, (Z0 + Z1) / 2);
  for (let z = Z0 + 0.6; z < Z1; z += 0.62) {
    if (rnd() < 0.04) continue; // missing plank
    const w = HX * 2 + 0.6 - (rnd() < 0.15 ? rnd() * 1.2 : 0);
    box(kit, 1, w, 0.12, 0.56, (rnd() - 0.5) * 0.15, 0, z, 0, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.02);
  }
  for (const side of [-1, 1]) {
    for (let z = Z0 + 2; z < Z1 - 1; z += 3.2) {
      if (rnd() < 0.22) continue;
      const x = side * (HX + 0.45);
      cyl(kit, 1, 0.11, 0.13, 1.25, x, 0.62, z, 8);
      if (rnd() > 0.3) box(kit, 1, 0.1, 0.1, 3.2, x, 1.08, z + 1.6, 0, 0, (rnd() - 0.5) * 0.1);
      if (rnd() < 0.18) kit.add(createCylinderGeometry(0.02 * S, 0.02 * S, 1.2 * S, 4, 1), { t: s3(x, 0.4, z + 0.8), r: axisAngle([0, 0, 1], 0.3) }, 1);
    }
  }
  // Sea lamps: stone foot, post, jade cap, cold glow box, tiled hat.
  for (const [x0, z0] of SEA_LAMPS) {
    const x = x0 / S, z = z0 / S;
    cyl(kit, 2, 0.32, 0.4, 0.3, x, 0.15, z, 8);
    cyl(kit, 2, 0.12, 0.15, 1.1, x, 0.85, z, 8);
    box(kit, 3, 0.6, 0.12, 0.6, x, 1.45, z);
    box(kit, 4, 0.32, 0.36, 0.32, x, 1.7, z);
    addRoof(kit, 5, 0.9, 0.9, 0.35, x, 2.05, z, 0.1);
  }
  // Wrecked fishing boats: ribs (half hoops of segments), keel, broken mast.
  for (const [wx, wz, ry] of WRECKS) {
    const base = s3(wx / S, -0.6, wz / S);
    const rot = mulQ(yawQ(ry), euler(0.25, 0, 0.35));
    const place = (p: V3): V3 => {
      const q = rotate(rot, [p[0] * S, p[1] * S, p[2] * S]);
      return [base[0] + q[0], base[1] + q[1], base[2] + q[2]];
    };
    for (let i = 0; i < 7; i += 1) {
      const z = i * 0.7 - 2.1;
      let prev: V3 | undefined;
      for (let k = 0; k <= 6; k += 1) {
        const a = Math.PI + (k / 6) * Math.PI; // lower half hoop (rotation.z = π of a half torus)
        const p = place([Math.cos(a) * 1.3, Math.sin(a) * 1.3, z]);
        if (prev) limb(kit, 1, prev, p, 0.09 * S);
        prev = p;
      }
    }
    limb(kit, 1, place([0, -1.3, -2.7]), place([0, -1.3, 2.7]), 0.12 * S);
    limb(kit, 1, place([-1.2, -0.85, 0.4]), place([1.2, 2.05, 0.4]), 0.09 * S);
  }
  // 「陈塘关」 arch over the entrance: red posts on stone feet, beams, tiled roof, gold strip, name board.
  const pz = Z1 - 4;
  const W = HX + 1.2;
  for (const x of [-W, W]) {
    cyl(kit, 6, 0.3, 0.34, 6, x, 3, pz);
    box(kit, 2, 1.1, 0.8, 1.1, x, 0.4, pz);
  }
  box(kit, 6, W * 2 + 0.6, 0.5, 0.45, 0, 5.2, pz);
  addRoof(kit, 5, W * 2 + 3, 2.4, 1.1, 0, 6.6, pz);
  box(kit, 7, W * 2 + 0.7, 0.08, 0.5, 0, 5.47, pz);
  box(kit, 6, W * 2, 0.35, 0.3, 0, 4.0, pz);
  box(kit, 8, 3.1, 1.0, 0.36, 0, 4.5, pz);
  return kit.build([
    slot('Footing', 'sea-rock'), slot('Wood', 'sea-wood'), slot('Stone', 'sea-stone'), slot('Jade', 'sea-jade-dark'),
    slot('Lamp', 'sea-lamp-glow'), slot('Tile', 'sea-tile'), slot('Lacquer', 'sea-red-lac'), slot('Gold', 'sea-gold'), slot('Board', 'sea-plaque'),
  ]);
}

function limb(kit: MeshKit, slotIndex: number, a: V3, b: V3, r: number, rb = r): void {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return;
  kit.add(createCylinderGeometry(rb * 0.7 + r * 0.3, r, len, 6, 1), { t: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r: fromTo([0, 1, 0], [d[0] / len, d[1] / len, d[2] / len]) }, slotIndex);
}

/** Six lumpy rock shapes (v1.4.0 rockGeo: noise-scaled icosahedra, detail lowered to 2). */
const ROCKS: readonly MeshAsset[] = Array.from({ length: 6 }, (_, v) =>
  displaceMesh(createIcosahedronGeometry(1, 2), (p) => {
    const k = 0.62 + fbm3(p[0] * 1.4 + v * 7, p[1] * 1.3 + p[2], 0.5, v, 4) * 0.7 + (fbm3(p[0] * 6 + v, p[1] * 6 - p[2] * 3, 0.5, v + 11, 2) - 0.5) * 0.12;
    return [p[0] * k, p[1] * k * (0.8 + v * 0.08), p[2] * k];
  }),
);

/** Shore reefs on both sides of the boardwalk (two depths) and the distant sea stacks. */
export function seaRocks(): MeshAsset {
  const kit = new MeshKit();
  const rnd = seeded(909);
  const rock = (x: number, y: number, z: number, size: number, slotIndex: number, sy = 1) => {
    kit.add(ROCKS[Math.floor(rnd() * ROCKS.length)]!, { t: s3(x, y, z), r: euler(rnd() * 0.5, rnd() * 6.3, rnd() * 0.5), s: [size * S, size * sy * S, size * S] }, slotIndex);
  };
  for (let z = Z0; z < Z1 + 10; z += 3.4) {
    for (const side of [-1, 1]) {
      rock(side * (HX + 2.2 + rnd() * 3), -0.8 + rnd() * 0.5, z + rnd() * 2, 1.2 + rnd() * 1.8, rnd() < 0.5 ? 1 : 0);
      if (rnd() < 0.2) rock(side * (HX + 9 + rnd() * 18), -1.5 + rnd() * 2, z, 3 + rnd() * 6, 0, 1.4 + rnd());
    }
  }
  // Around the platform foot, so the round stage sits on a reef, not on nothing.
  for (let i = 0; i < 26; i += 1) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2;
    if (Math.cos(a) > 0.93) continue; // boardwalk joins here
    const d = R + 4 + rnd() * 3;
    rock(Math.sin(a) * d, -1.2 + rnd() * 0.6, Math.cos(a) * d, 1.6 + rnd() * 2.2, rnd() < 0.5 ? 1 : 0);
  }
  for (let i = 0; i < 18; i += 1) {
    const a = rnd() * Math.PI * 2, d = 90 + rnd() * 150;
    const x = Math.sin(a) * d, z = 40 + Math.cos(a) * d;
    if (Math.abs(x) < 30 && z > 0 && z < 160) continue;
    const h = 12 + rnd() * 35;
    rock(x, h * 0.35 - 2, z, 4 + rnd() * 6, 0, h / 8);
  }
  return kit.build([slot('Rock', 'sea-rock'), slot('Wet Rock', 'sea-wet-rock')]);
}

/** v1.4.0 dragonPillar: plinth, shaft, 44 scale knots spiralling up, gold collar and head. Origin at its foot. */
function dragonPillar(kit: MeshKit, x: number, z: number, h: number, slots: { stone: number; dark: number; jade: number; gold: number }, y0 = 0): void {
  cyl(kit, slots.stone, 0.95, 1.05, 0.6, x, y0 + 0.3, z, 12);
  cyl(kit, slots.dark, 0.55, 0.62, h, x, y0 + h / 2 + 0.6, z, 14);
  for (let i = 0; i < 44; i += 1) {
    const u = i / 44, a = u * Math.PI * 4.2, r = 0.66;
    kit.add(createSphereGeometry(1, 8, 6), {
      t: s3(x + Math.cos(a) * r, y0 + 1.0 + u * (h - 0.8), z + Math.sin(a) * r),
      r: yawQ(-a),
      s: [(0.2 - u * 0.05) * 0.55 * S, (0.2 - u * 0.05) * 0.7 * S, (0.2 - u * 0.05) * 1.25 * S],
    }, slots.jade);
  }
  cyl(kit, slots.gold, 0.7, 0.6, 0.25, x, y0 + h + 0.7, z, 12);
  kit.add(createCylinderGeometry(0, 0.32 * S, 0.9 * S, 6, 1), { t: s3(x, y0 + h + 1.0, z + 0.35), r: axisAngle([1, 0, 0], Math.PI / 2) }, slots.gold);
}

/** ③ 镇海水门: two dragon pillars, lintel and a double-eaved roof (the curtain is its own mesh). */
export function seaGate(): MeshAsset {
  const kit = new MeshKit();
  const sl = { stone: 0, dark: 1, jade: 2, gold: 3 };
  for (const [x, z] of GATE_PILLARS) dragonPillar(kit, x / S, z / S, GATE_PILLAR_HEIGHT / S, sl);
  box(kit, 1, HX * 2 + 5, 0.7, 0.9, 0, 8.4, GZ);
  addRoof(kit, 4, HX * 2 + 8, 3, 1.4, 0, 9.5, GZ, 0.25);
  return kit.build([slot('Stone', 'sea-stone'), slot('Shaft', 'sea-jade-dark'), slot('Scales', 'sea-jade'), slot('Gold', 'sea-gold'), slot('Tile', 'sea-tile')]);
}

/** Total pillar height (plinth to head) in metres: the entity sits at half of it. */
export const pillarSpan = (height: number): number => height + 1.2 * S;

/** One platform pillar, origin at its middle (its cylinder collider is centred too); faded one by one. */
export function seaArenaPillar(height: number): MeshAsset {
  const kit = new MeshKit();
  dragonPillar(kit, 0, 0, height / S, { stone: 0, dark: 1, jade: 2, gold: 3 }, -pillarSpan(height) / S / 2);
  return kit.build([slot('Stone', 'sea-stone'), slot('Shaft', 'sea-jade-dark'), slot('Scales', 'sea-jade'), slot('Gold', 'sea-gold')]);
}
export const ARENA_PILLAR_HEIGHTS = [...new Set(ARENA_PILLARS.map((p) => p.height))];

/** ④ 镇海台: reef drum under the stage, the slab floor (top at y = 0), stone balustrade open to the boardwalk. */
export function seaArena(): MeshAsset {
  const kit = new MeshKit();
  cyl(kit, 0, R + 2.8, R + 4.2, 4, 0, -2.05, 0, 72);
  cyl(kit, 1, R + 2.8, R + 2.8, 0.1, 0, -0.05, 0, 72);
  for (let i = 0; i < 64; i += 1) {
    const a = (i / 64) * Math.PI * 2;
    if (Math.cos(a) > 0.93) continue;
    const x = Math.sin(a) * (R + 2.5), z = Math.cos(a) * (R + 2.5);
    cyl(kit, 1, 0.12, 0.14, 1.0, x, 0.5, z, 6);
    if (i % 2 === 0) kit.add(createBoxGeometry(0.12 * S, 0.12 * S, 2.4 * S), { t: s3(x, 0.9, z), r: yawQ(a + Math.PI / 2) }, 1);
  }
  return kit.build([slot('Reef', 'sea-rock'), slot('Slab', 'sea-stone')]);
}

/** Taiji runes on the stage: three rings and eight spokes (glow), plus the dark half disc in the centre. */
export function seaRunes(): MeshAsset {
  const kit = new MeshKit();
  const ring = (a: number, b: number) => {
    const n = 96;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i += 1) {
      const t = (i / n) * Math.PI * 2;
      for (const r of [a, b]) { pos.push(Math.sin(t) * r * S, 0.03 * S, Math.cos(t) * r * S); nor.push(0, 1, 0); uv.push(i / n, r === a ? 0 : 1); }
    }
    for (let i = 0; i < n; i += 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    kit.addRaw(pos, nor, uv, idx, 0);
  };
  ring(7.0, 7.25); ring(14.8, 15.0); ring(R - 0.3, R);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    kit.add(createPlaneGeometry(0.14 * S, 7.6 * S), { t: s3(Math.sin(a) * 11, 0.031, Math.cos(a) * 11), r: mulQ(yawQ(a), axisAngle([1, 0, 0], -Math.PI / 2)) }, 0);
  }
  // Taiji: half disc of radius 3.2 (dark, translucent).
  const pos: number[] = [0, 0.025 * S, 0], nor: number[] = [0, 1, 0], uv: number[] = [0.5, 0.5], idx: number[] = [];
  const n = 48;
  for (let i = 0; i <= n; i += 1) {
    const t = Math.PI / 2 + (i / n) * Math.PI;
    pos.push(Math.cos(t) * 3.2 * S, 0.025 * S, Math.sin(t) * 3.2 * S); nor.push(0, 1, 0); uv.push(0, 0);
    if (i > 0) idx.push(0, i + 1, i);
  }
  kit.addRaw(pos, nor, uv, idx, 1);
  return kit.build([slot('Runes', 'sea-rune'), slot('Taiji', 'sea-taiji')]);
}

/** ② 太乙莲台 pond: stone rim, water disc, lily pads (the lotus itself spins: separate mesh). */
export function seaLotusPond(): MeshAsset {
  const kit = new MeshKit();
  const rnd = seeded(62);
  const [lx, lz] = SEA.lotus;
  const x = lx / S, z = lz / S;
  cyl(kit, 0, 1.75, 1.85, 0.25, x, 0.0, z, 24);
  cyl(kit, 1, 1.6, 1.6, 0.02, x, 0.13, z, 32);
  for (let i = 0; i < 5; i += 1) {
    const a = rnd() * 6.28;
    cyl(kit, 2, 0.3 + rnd() * 0.15, 0.3, 0.01, x + Math.sin(a) * 1.1, 0.15, z + Math.cos(a) * 1.1, 16);
  }
  return kit.build([slot('Rim', 'sea-stone'), slot('Pond', 'sea-pond'), slot('Pad', 'sea-lotus-pad')]);
}

/** The lotus (two rings of eight petals), origin at its centre. */
export function seaLotus(): MeshAsset {
  const kit = new MeshKit();
  for (let ring = 0; ring < 2; ring += 1) {
    for (let i = 0; i < 8; i += 1) {
      const a = ((i + ring * 0.5) / 8) * Math.PI * 2;
      const r = 0.32 - ring * 0.12;
      const py = 0.18 + ring * 0.08;
      // v1.4.0 looked each petal's thin side at (3x, −1.5, 3z): yaw to the radial, tilt open by that angle.
      const tilt = Math.atan2(1.5 + py, 2 * r);
      kit.add(createSphereGeometry(0.28 - ring * 0.06, 10, 8), { t: s3(Math.sin(a) * r, py, Math.cos(a) * r), r: mulQ(yawQ(a), axisAngle([1, 0, 0], tilt)), s: [0.55 * S, 1.3 * S, 0.25 * S] }, 0);
    }
  }
  kit.add(createSphereGeometry(0.1, 10, 8), { t: s3(0, 0.25, 0), s: S }, 1);
  return kit.build([slot('Petal', 'sea-lotus'), slot('Heart', 'sea-gold')]);
}

/** Coral (recursive branching, v1.4.0 `coral`) round the platform and under the boardwalk. */
export function seaCoral(): MeshAsset {
  const kit = new MeshKit();
  const rnd = seeded(313);
  const coral = (x: number, y: number, z: number, size: number) => {
    const grow = (p: V3, dir: V3, len: number, r: number, depth: number) => {
      if (depth > 3) return;
      const end: V3 = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
      limb(kit, 0, [x * S + p[0] * size * S, y * S + p[1] * size * S, z * S + p[2] * size * S], [x * S + end[0] * size * S, y * S + end[1] * size * S, z * S + end[2] * size * S], r * size * S, r * 0.7 * size * S);
      for (let k = 0; k < 2; k += 1) {
        const nd: V3 = [dir[0] + (rnd() - 0.5) * 1.2, dir[1] + 0.3, dir[2] + (rnd() - 0.5) * 1.2];
        const l = Math.hypot(...nd);
        grow(end, [nd[0] / l, nd[1] / l, nd[2] / l], len * 0.7, r * 0.7, depth + 1);
      }
    };
    grow([0, 0, 0], [0, 1, 0], 0.8, 0.12, 0);
  };
  for (let i = 0; i < 14; i += 1) { const a = rnd() * Math.PI * 2; coral(Math.sin(a) * (R + 6 + rnd() * 4), -1.2, Math.cos(a) * (R + 6 + rnd() * 4), 0.7 + rnd() * 0.7); }
  for (let i = 0; i < 10; i += 1) coral((rnd() < 0.5 ? -1 : 1) * (HX + 2.5 + rnd() * 2), -1.1, Z0 + 8 + rnd() * (Z1 - Z0 - 16), 0.5 + rnd() * 0.5);
  return kit.build([slot('Coral', 'sea-coral')]);
}

/** Distant Dragon Palace rising from the sea (far, big, fogged into a silhouette). */
export function seaPalace(): MeshAsset {
  const kit = new MeshKit();
  const PS = 1.6, PZ = -150;
  const fbox = (sl: number, w: number, h: number, d: number, x: number, y: number, z: number) =>
    kit.add(createBoxGeometry(w * PS * S, h * PS * S, d * PS * S), { t: s3(x * PS, y * PS - 2, PZ + z * PS) }, sl);
  const froof = (w: number, d: number, h: number, x: number, y: number, z: number, top: number) => {
    const k = 1 / Math.SQRT1_2;
    kit.add(roofMesh(top), { t: s3(x * PS, y * PS - 2, PZ + z * PS), s: [(w / 2) * k * PS * S, h * PS * S, (d / 2) * k * PS * S] }, 1);
  };
  fbox(0, 70, 5, 30, 0, 0.5, 0);
  for (let i = 0; i < 3; i += 1) fbox(0, 70 - i * 6, 1, 32 - i * 2, 0, 3.5 + i, 2 + i);
  for (let i = -4; i <= 4; i += 1) kit.add(createCylinderGeometry(0.7 * PS * S, 0.8 * PS * S, 12 * PS * S, 10, 1), { t: s3(i * 6.5 * PS, 12 * PS - 2, PZ + 10 * PS) }, 0);
  fbox(0, 58, 1.2, 22, 0, 18.4, 2);
  froof(72, 32, 4.5, 0, 21.5, 2, 0.42);
  fbox(0, 38, 4, 14, 0, 25.5, 2);
  froof(48, 22, 6, 0, 30.5, 2, 0.2);
  fbox(2, 1.6, 4, 1.6, 0, 35.5, 2);
  for (const sx of [-1, 1]) {
    fbox(0, 9, 30, 9, sx * 40, 15, 6); froof(14, 14, 5, sx * 40, 32.5, 6, 0.15);
    fbox(0, 5, 8, 5, sx * 40, 37, 6); froof(8, 8, 3.5, sx * 40, 42.5, 6, 0.1);
  }
  return kit.build([slot('Hall', 'sea-far'), slot('Roof', 'sea-far-roof'), slot('Finial', 'sea-far-gold')]);
}

/** Water curtain quad (uv 0–1), origin at its bottom centre, facing ±Z. */
export function seaCurtain(width: number, height: number): MeshAsset {
  const kit = new MeshKit();
  kit.add(createPlaneGeometry(width, height, 1, 1), { t: [0, height / 2, 0] }, 0);
  return kit.build([slot('Curtain', 'sea-veil')]);
}

/** Far flat sea beyond the moving grid (same material, rest level). */
export function seaFar(): MeshAsset {
  const kit = new MeshKit();
  kit.add(createPlaneGeometry(1400, 1400, 1, 1), { r: axisAngle([1, 0, 0], -Math.PI / 2) }, 0);
  return kit.build([slot('Sea', 'sea-water')]);
}
