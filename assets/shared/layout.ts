/**
 * World layout of the M1 Dragon Palace greybox. Shared by the build-time scene
 * Pack (meshes, colliders, seaweed placement) and runtime plugins (spawn,
 * lock target, QA probes), so placement has one authority.
 *
 * Coordinates: right-handed, +Y up, seabed at y = 0. The player enters from +Z
 * (the reef canyon) and faces -Z toward the palace behind the plaza.
 */

export type Vec3 = readonly [number, number, number];

/** Deterministic PRNG (mulberry32): never Math.random() in Pack builds. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FLOOR_Y = 0;

/**
 * Boss field (M3, dragon redesign 17:48): a vortex at the bottom of the sea trench.
 * 40 m vortex floor (Nezha boundary r = 19.5 m, every damage area inside it) + a 6 m band
 * where the dragon only swims, closed by a water wall of inner diameter 52 m.
 */
export const ARENA = Object.freeze({
  /** Vortex floor radius (diameter 40 m). */
  radius: 20,
  /** Nezha's root may not go beyond this radius (invisible boundary, gap at the canyon mouth). */
  boundary: 19.5,
  /** Dragon swim band outer edge = water wall inner radius (diameter 52 m). */
  wallRadius: 26,
  wallHeight: 16,
  boundarySegments: 40,
  /** Canyon mouth toward +Z, half-angle in degrees (boundary and water wall are open here). */
  entranceHalfAngleDeg: 13,
  /** Dragon band patrol radius and the farthest its head may go while crossing the band. */
  bandPatrolRadius: 21.5,
  bandMaxHead: 22,
  /** The dragon never crosses the canyon mouth sector (half-angle, degrees). */
  bandForbiddenHalfAngleDeg: 20,
  /** Band floor ring where the edge seaweed grows (static seabed, not the rotating vortex). */
  seaweedInnerRadius: 20.6,
  seaweedOuterRadius: 25.4,
  /** Inner calm zone of the vortex (≤ 1°/s, low contrast) and the outer ring (2°/s). */
  calmRadius: 14,
});

/** Checkpoint (Chentang fishing lamp) on the vortex edge by the canyon mouth: respawn point. */
export const CHECKPOINT: Vec3 = [0, 0, 16.5];

export const CANYON = Object.freeze({
  /** The canyon meets the plaza edge at zStart and runs ~30 m to the dead end at zEnd. */
  zStart: 19.6,
  zEnd: 50,
  wallHeight: 7.5,
  wallThickness: 2.2,
  segmentLength: 2.4,
  spawnZ: 46.5,
});

/** Gentle S-curve centre line of the reef canyon. */
export function canyonCenterX(z: number): number {
  if (z <= 20) return 0;
  return 2.0 * Math.sin((Math.PI * (z - 20)) / 17);
}

/** Half width of the walkable canyon floor (4.8 m to 8 m wide). */
export function canyonHalfWidth(z: number): number {
  return 3.2 + 0.8 * Math.sin((Math.PI * (z - 20)) / 11 + 1);
}

/** 陈塘关 spawn on the boardwalk (v1.4.0 showcase (0, 128) × 0.86; see sea-layout.ts SEA.spawn). */
export const SPAWN: Vec3 = [0, FLOOR_Y, 128 * 0.86];

/** Standing dragon pillars: only the two in the canyon remain (no palace; none overhead). */
export interface PillarSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

export const PILLARS: readonly PillarSpec[] = Object.freeze([
  { id: 'canyon-0', x: canyonCenterX(28) - 1.6, z: 28, radius: 0.7, height: 8 },
  { id: 'canyon-1', x: canyonCenterX(38) + 1.4, z: 38, radius: 0.7, height: 8 },
]);

/** Lowest overhead structure allowed above the passable area (Nezha + sash ≤ 3.45 m). */
export const PASSABLE_CEILING = 4.5;

/** Far trench terraces (远景) where the far seaweed group grows. */
export const TRENCH = Object.freeze({
  radius: 36,
  terraceY: 3.5,
  cliffHeight: 26,
  segments: 20,
});

/** Volumetric light beam from the sea surface over the plaza. */
export const BEAM = Object.freeze({
  origin: [2.5, FLOOR_Y, -3] as Vec3,
  height: 30,
  topRadius: 5.5,
  bottomRadius: 2.4,
  swayDeg: 3,
});

/** Ground warning sizes (training fake attacks; design: Tail Sweep 5 m fan, Trident line). */
export const WARN = Object.freeze({ lineWidth: 1.4, lineLength: 8, fanRadius: 5, fanAngleDeg: 120, edge: 0.08 });
