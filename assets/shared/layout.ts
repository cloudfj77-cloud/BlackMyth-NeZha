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

export const ARENA = Object.freeze({
  /** White-jade plaza: diameter 40 m. */
  radius: 20,
  /** Palace wall ring (宫墙) around the plaza. */
  wallRadius: 21,
  wallHeight: 4.2,
  wallThickness: 1.2,
  wallSegments: 28,
  /** Entrance gap toward +Z (the canyon), half-angle in degrees. */
  entranceHalfAngleDeg: 12,
  /** Palace gate gap toward -Z, closed by the palace facade. */
  gateHalfAngleDeg: 16,
  /** No seaweed inside this radius (designer rule: the plaza centre stays clear). */
  seaweedInnerRadius: 16,
});

export const PALACE = Object.freeze({
  /** Facade plane closing the gate gap, and the hall volume behind it. */
  facadeZ: -21.6,
  hallDepth: 12,
  hallWidth: 26,
  hallHeight: 14,
});

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

export const SPAWN: Vec3 = [canyonCenterX(CANYON.spawnZ), FLOOR_Y, CANYON.spawnZ];

/** Standing dragon pillars: eight around the plaza, two in the canyon (none overhead below 3 m). */
export interface PillarSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

export const PILLARS: readonly PillarSpec[] = Object.freeze([
  ...Array.from({ length: 8 }, (_, index): PillarSpec => {
    const angle = ((index + 0.5) / 8) * Math.PI * 2;
    return { id: `plaza-${index}`, x: Math.sin(angle) * 12.5, z: Math.cos(angle) * 12.5, radius: 0.85, height: 10 };
  }),
  { id: 'canyon-0', x: canyonCenterX(28) - 1.6, z: 28, radius: 0.7, height: 8 },
  { id: 'canyon-1', x: canyonCenterX(38) + 1.4, z: 38, radius: 0.7, height: 8 },
]);

/** Long lock-on placeholder (stands in for the serpentine dragon body). */
export const LOCK_TARGET = Object.freeze({
  center: [0, FLOOR_Y, -7] as Vec3,
  /** Long axis yaw (radians); 0 = along world X. */
  yaw: 0,
  /** Cross-section thickness as a fraction of height, clamped to [1, 3] m. */
  thicknessRatio: 0.45,
});

export function targetThickness(height: number): number {
  return Math.min(3, Math.max(1, height * LOCK_TARGET.thicknessRatio));
}

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
