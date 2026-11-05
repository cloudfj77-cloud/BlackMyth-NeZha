/**
 * Tuning authority. `assets/data/tuning.json` holds the defaults (the single
 * file designers edit); this module types them, declares the debug-panel
 * ranges and owns the live, clamped copy that runtime plugins read each frame.
 */
import DEFAULTS from '../data/tuning.json' with { type: 'json' };

export type Tuning = typeof DEFAULTS;
export type TuningGroup = keyof Tuning;
export type TuningPath = { [G in TuningGroup]: `${G & string}.${keyof Tuning[G] & string}` }[TuningGroup];

/** Panel range per key: [min, max, step]. Keys absent here are read-only in the panel. */
export const TUNING_RANGES: Readonly<Partial<Record<TuningPath, readonly [number, number, number]>>> = {
  'move.walkSpeed': [3, 8, 0.1],
  'move.sprintSpeed': [6, 14, 0.1],
  'move.accelTime': [0.03, 0.4, 0.01],
  'move.decelTime': [0.05, 0.5, 0.01],
  'move.turnRate': [360, 1440, 10],
  'move.sprintHoldThreshold': [0.1, 0.4, 0.01],
  'move.hoverHeight': [0.1, 0.6, 0.01],
  'move.leanWalk': [0, 30, 1],
  'move.leanSprint': [0, 30, 1],
  'move.leanBlendTime': [0.05, 0.4, 0.01],
  'camera.shoulderOffset': [0, 1, 0.05],
  'camera.focusHeight': [1.4, 2, 0.05],
  'camera.focusHeightLocked': [1.4, 2, 0.05],
  'camera.distance': [4, 6, 0.1],
  'camera.distanceLocked': [5.5, 8, 0.1],
  'camera.minDistance': [1, 1.6, 0.05],
  'camera.collisionMargin': [0.15, 0.5, 0.01],
  'camera.wallLiftMax': [0, 1.5, 0.05],
  'camera.fovY': [50, 65, 1],
  'camera.sensitivity': [0.03, 0.3, 0.01],
  'camera.returnDelay': [0, 0.3, 0.01],
  'camera.returnTime': [0.25, 0.8, 0.01],
  'camera.lockLookAtRatio': [0, 0.5, 0.01],
  'float.idleAmp': [0, 0.12, 0.005],
  'float.idleFreq': [0.3, 1.5, 0.05],
  'float.swayDeg': [0, 4, 0.1],
  'float.swayFreq': [0.2, 1.2, 0.05],
  'float.moveAmp': [0, 0.08, 0.005],
  'float.sprintAmp': [0, 0.05, 0.005],
  'float.blendTime': [0.05, 0.8, 0.01],
  'sash.stiffness': [5, 120, 1],
  'sash.damping': [0.5, 20, 0.5],
  'sash.buoyancy': [0, 8, 0.1],
  'sash.length': [0.6, 1.6, 0.05],
  'wheel.emissive': [0, 1, 0.05],
  'glow.radius': [0.4, 1.4, 0.05],
  'lock.targetHeight': [2, 8, 0.5],
  'lock.targetLength': [4, 20, 1],
  'lock.minOrbitGap': [0.5, 4, 0.1],
  'ambient.seaweedCanyon': [0, 600, 10],
  'ambient.seaweedEdge': [0, 450, 10],
  'ambient.seaweedFar': [0, 150, 10],
  'ambient.seaweedSwayHz': [0.05, 0.25, 0.01],
  'ambient.particles': [0, 3000, 100],
  'occlusion.fadeOpacity': [0.1, 0.6, 0.01],
  'occlusion.fadeTime': [0.05, 0.6, 0.01],
};

export function defaultTuning(): Tuning {
  return structuredClone(DEFAULTS);
}

export function readPath(tuning: Tuning, path: string): number | undefined {
  const [group, key] = path.split('.') as [string, string];
  const value = (tuning as unknown as Record<string, Record<string, unknown>>)[group]?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** Applies one panel edit, clamped to its declared range. Returns false for unknown or read-only keys. */
export function writePath(tuning: Tuning, path: string, value: number): boolean {
  const range = TUNING_RANGES[path as TuningPath];
  if (range === undefined || !Number.isFinite(value)) return false;
  const [group, key] = path.split('.') as [string, string];
  const target = (tuning as unknown as Record<string, Record<string, number>>)[group];
  if (target === undefined || typeof target[key] !== 'number') return false;
  target[key] = Math.min(range[1], Math.max(range[0], value));
  return true;
}

/** Keys whose live value differs from tuning.json (exported by the panel). */
export function overrides(tuning: Tuning): Record<string, number> {
  const out: Record<string, number> = {};
  const defaults = DEFAULTS as unknown as Record<string, Record<string, number>>;
  for (const [group, values] of Object.entries(tuning as unknown as Record<string, Record<string, number>>)) {
    for (const [key, value] of Object.entries(values)) if (defaults[group]?.[key] !== value) out[`${group}.${key}`] = value;
  }
  return out;
}

export const DEG = Math.PI / 180;
