/**
 * 东海 · 陈塘关 (v1.4.0 port, boss ruling 11-06 14:46/14:50): the whole level, south of the old trench.
 *
 * Layout authority for the build-time scene/geometry Packs and the runtime plugins. Every number is
 * v1.4.0's `sea.js` value times LEVEL_SCALE: our Nezha is the v1.4.0 rig at RIG_SCALE 0.86, so the
 * level is scaled by the same factor and keeps its proportions to her.
 *
 * The player walks from the north (+Z, spawn) toward the boss platform at the origin, facing −Z:
 *   ① 海岸栈道 boardwalk z 122 → 19 (two ambush waves of 巡海夜叉)
 *   ② 太乙莲台 lotus checkpoint (z ≈ 50)
 *   ③ 镇海水门 water gate (z ≈ 23.7), sealed by a water curtain until the yaksha are cleared
 *   ④ 镇海台 boss platform, radius 20.6 m, sea all round, eight dragon pillars, taiji runes
 */
import { ARENA } from './layout.ts';

export const LEVEL_SCALE = 0.86;
const S = LEVEL_SCALE;

export type XZ = readonly [number, number];

export const SEA = Object.freeze({
  /** Boss platform radius (v1.4.0 ARENA_R 24). */
  arenaRadius: 24 * S,
  /** Boardwalk half width (PATH_HX 4.2) and its south / north ends (PATH_Z0 22, PATH_Z1 142). */
  pathHalfWidth: 4.2 * S,
  pathZ0: 22 * S,
  pathZ1: 142 * S,
  /** Crossing south of this line onto the platform starts the fight (ENTRY_Z 21.5). */
  entryZ: 21.5 * S,
  /** Water gate line (GZ 27.5). */
  gateZ: 27.5 * S,
  /** Sea surface rest height (−1.6) under the y = 0 walking surface. */
  seaY: -1.6 * S,
  /** Spawn on the boardwalk, 8 m inside the arch so the camera starts clear of it (v1.4.0 showcase 128). */
  spawn: [0, 128 * S] as XZ,
  /** Fight seal: the mist stands just inside the water gate (the retry camera, 5 m behind Nezha, stays inside it). */
  mistZ: (27.5 - 0.7) * S,
  /** 太乙莲台: the lotus pond (shrine) and the respawn point beside it (checkpoint 58). */
  lotus: [3 * S, 62 * S] as XZ,
  lotusRadius: 1.9 * S,
  lotusCheckpoint: [0, 58 * S] as XZ,
  /** Arena light / boss home (0, −12). */
  bossHome: [0, -12 * S] as XZ,
  /** Name board 「陈塘关」 over the boardwalk entrance (PATH_Z1 − 4). */
  paifangZ: (142 - 4) * S,
  /** Distant Dragon Palace silhouette (PZ −150, its own scale 1.6). */
  palaceZ: -150 * S,
});

/** Sea lamps along the boardwalk, alternating sides (v1.4.0: every 14 m from PATH_Z0 + 8). */
export const SEA_LAMPS: readonly XZ[] = (() => {
  const out: XZ[] = [];
  for (let z = 22 + 8; z < 142; z += 14) out.push([(Math.floor(z / 14) % 2 ? 1 : -1) * (4.2 - 0.5) * S, z * S]);
  return Object.freeze(out);
})();

/** Gate dragon pillars (one each side of the boardwalk) and the eight platform pillars (fading). */
export const GATE_PILLARS: readonly XZ[] = Object.freeze([[-(4.2 + 1.6) * S, 27.5 * S], [(4.2 + 1.6) * S, 27.5 * S]]);
export interface ArenaPillar { readonly id: string; readonly x: number; readonly z: number; readonly height: number }
export const ARENA_PILLARS: readonly ArenaPillar[] = (() => {
  const out: ArenaPillar[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    out.push({ id: `arena-${i}`, x: Math.sin(a) * (24 + 1.6) * S, z: Math.cos(a) * (24 + 1.6) * S, height: (5.5 + (i % 2) * 1.5) * S });
  }
  return Object.freeze(out);
})();
/** Dragon pillar radius as a collider (v1.4.0 1.1) and its visual height at the gate (7.5). */
export const PILLAR_RADIUS = 1.1 * S;
export const GATE_PILLAR_HEIGHT = 7.5 * S;

/** Wrecked fishing boats beside the boardwalk (x, z, yaw). */
export const WRECKS: readonly (readonly [number, number, number])[] = Object.freeze([[-9.5 * S, 96 * S, 0.4], [10.5 * S, 58 * S, -0.9]]);

/** Ambush waves of 巡海夜叉 (v1.4.0 `ambush`): trigger line z and spawn points. */
export const AMBUSH: readonly { readonly z: number; readonly spawns: readonly XZ[] }[] = Object.freeze([
  { z: 112 * S, spawns: [[-2.5 * S, 100 * S], [2.5 * S, 98 * S]] },
  { z: 80 * S, spawns: [[0, 66 * S], [-3 * S, 70 * S], [3 * S, 72 * S]] },
]);

/** Round obstacles on the walkable area (lamps, the lotus pond, pillars): root pushed out. */
export const SEA_COLLIDERS: readonly { readonly x: number; readonly z: number; readonly r: number }[] = Object.freeze([
  ...SEA_LAMPS.map(([x, z]) => ({ x, z, r: 0.45 * S })),
  { x: SEA.lotus[0], z: SEA.lotus[1], r: SEA.lotusRadius },
  ...GATE_PILLARS.map(([x, z]) => ({ x, z, r: PILLAR_RADIUS })),
  ...ARENA_PILLARS.map((p) => ({ x: p.x, z: p.z, r: PILLAR_RADIUS })),
]);

export interface SeaRules {
  /** Water gate open (the yaksha are cleared): the boardwalk joins the platform. */
  readonly gateOpen: boolean;
  /** In the fight: platform only (the entry is sealed by mist). */
  readonly arenaOnly: boolean;
}

/**
 * v1.4.0 `constrain`: free roaming = platform ∪ boardwalk (not past the gate while it is shut);
 * fighting = platform only. Then push out of the round obstacles. `rad` = capsule radius.
 * The platform limit is our `ARENA.boundary` (every boss damage area is designed inside it).
 */
export function seaConstrain(x: number, z: number, rad: number, rules: SeaRules): { x: number; z: number } {
  const disc = ARENA.boundary;
  const hx = SEA.pathHalfWidth - rad;
  const z1 = SEA.pathZ1 - rad;
  const zMin = rules.gateOpen ? SEA.pathZ0 : SEA.gateZ + 0.8 * S + rad;
  const d = Math.hypot(x, z);
  const inDisc = (rules.gateOpen || rules.arenaOnly) && d <= disc;
  const inRect = !rules.arenaOnly && Math.abs(x) <= hx && z >= zMin && z <= z1;
  let px = x, pz = z;
  if (!(inDisc || inRect)) {
    let bd = Infinity;
    if (rules.gateOpen || rules.arenaOnly) {
      const k = disc / Math.max(d, 1e-4);
      px = x * k; pz = z * k;
      bd = Math.hypot(px - x, pz - z);
    }
    if (!rules.arenaOnly) {
      const cx = Math.max(-hx, Math.min(hx, x)), cz = Math.max(zMin, Math.min(z1, z));
      const dd = Math.hypot(cx - x, cz - z);
      if (dd < bd) { px = cx; pz = cz; }
    }
  }
  for (const c of SEA_COLLIDERS) {
    const dx = px - c.x, dz = pz - c.z, dd = Math.hypot(dx, dz), m = c.r + rad;
    if (dd < m && dd > 1e-4) { px = c.x + (dx / dd) * m; pz = c.z + (dz / dd) * m; }
  }
  return { x: px, z: pz };
}

/** v1.4.0 `inArena`: on the platform, south of the entry line (fight trigger). */
export function onPlatform(x: number, z: number): boolean {
  return Math.hypot(x, z) < ARENA.boundary && z < SEA.entryZ;
}

/** Sea surface waves (v1.4.0 Gerstner set): direction, wavenumber k (1/m), amplitude (m), speed. */
export const WAVES: readonly { readonly dir: XZ; readonly k: number; readonly a: number; readonly speed: number }[] = (() => {
  const n = (x: number, z: number): XZ => { const l = Math.hypot(x, z); return [x / l, z / l]; };
  // Lengths scale with the level: k / S, amplitude × S, phase speed × S (same period).
  return Object.freeze([
    { dir: n(1, 0.6), k: 0.08 / S, a: 0.55 * S, speed: 3.0 * S },
    { dir: n(-0.7, 1), k: 0.14 / S, a: 0.28 * S, speed: 2.4 * S },
    { dir: n(0.2, -1), k: 0.31 / S, a: 0.12 * S, speed: 1.8 * S },
    { dir: n(-1, -0.3), k: 0.6 / S, a: 0.05 * S, speed: 1.3 * S },
  ]);
})();

/**
 * Gerstner displacement of a rest point (x, z) at time t, with the surface normal.
 * Same sums as the v1.4.0 vertex shader (`gw`), evaluated on the CPU for the dynamic sea mesh.
 */
export function gerstner(x: number, z: number, t: number): { dx: number; dy: number; dz: number; nx: number; ny: number; nz: number } {
  let dx = 0, dy = 0, dz = 0;
  let tx = 1, ty = 0, tz = 0; // tangent (d/dx)
  let bx = 0, by = 0, bz = 1; // binormal (d/dz)
  for (const w of WAVES) {
    const f = w.k * (w.dir[0] * x + w.dir[1] * z - w.speed * t);
    const q = w.a * w.k;
    const s = Math.sin(f), c = Math.cos(f);
    tx += -w.dir[0] * w.dir[0] * q * s; ty += w.dir[0] * q * c; tz += -w.dir[0] * w.dir[1] * q * s;
    bx += -w.dir[0] * w.dir[1] * q * s; by += w.dir[1] * q * c; bz += -w.dir[1] * w.dir[1] * q * s;
    dx += w.dir[0] * w.a * c; dy += w.a * s; dz += w.dir[1] * w.a * c;
  }
  // normal = binormal × tangent (points up)
  let nx = by * tz - bz * ty, ny = bz * tx - bx * tz, nz = bx * ty - by * tx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return { dx, dy, dz, nx, ny, nz };
}
