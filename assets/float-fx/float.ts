/**
 * Nezha's procedural float (pure; tested). Visual only: the result offsets the
 * model child, never the root or the capsule.
 *
 * Idle: ±idleAmp at idleFreq (the rise takes `riseShare` of the cycle), plus ±swayDeg roll at
 * swayFreq, 90° out of phase.
 * Moving: amplitude drops to moveAmp; sprinting to sprintAmp with no sway.
 * Amplitude changes blend over `blendTime`; phase is continuous (no pops).
 */
export interface FloatTuning {
  readonly idleAmp: number;
  readonly idleFreq: number;
  /** Share of each bob cycle spent rising (M3: 0.35 — a quick lift, a slow settle). */
  readonly riseShare?: number;
  readonly swayDeg: number;
  readonly swayFreq: number;
  readonly swayPhase: number;
  readonly moveAmp: number;
  readonly sprintAmp: number;
  readonly blendTime: number;
}

export type FloatMode = 'idle' | 'move' | 'sprint';

export function floatTargets(mode: FloatMode, tuning: FloatTuning): { readonly amp: number; readonly sway: number } {
  if (mode === 'sprint') return { amp: tuning.sprintAmp, sway: 0 };
  if (mode === 'move') return { amp: tuning.moveAmp, sway: tuning.swayDeg };
  return { amp: tuning.idleAmp, sway: tuning.swayDeg };
}

/** Bob shape at cycle phase `p` (0..1): -1 → +1 over the rise share, +1 → -1 over the rest. */
export function bobShape(p: number, rise = 0.5): number {
  const u = ((p % 1) + 1) % 1;
  const r = Math.min(0.95, Math.max(0.05, rise));
  return u < r ? -Math.cos((Math.PI * u) / r) : Math.cos((Math.PI * (u - r)) / (1 - r));
}

export function createFloat() {
  let amp = -1;
  let sway = -1;
  let bobPhase = 0;
  let swayPhase = 0;
  return {
    step(mode: FloatMode, tuning: FloatTuning, dt: number): { readonly y: number; readonly roll: number; readonly amp: number; readonly bobPhase: number } {
      const target = floatTargets(mode, tuning);
      if (amp < 0) {
        amp = target.amp;
        sway = target.sway;
      }
      const k = 1 - Math.exp((-3 * dt) / Math.max(0.02, tuning.blendTime));
      amp += (target.amp - amp) * k;
      sway += (target.sway - sway) * k;
      bobPhase = (bobPhase + 2 * Math.PI * tuning.idleFreq * dt) % (2 * Math.PI);
      swayPhase = (swayPhase + 2 * Math.PI * tuning.swayFreq * dt) % (2 * Math.PI);
      const offset = (tuning.swayPhase * Math.PI) / 180;
      return {
        y: amp * bobShape(bobPhase / (2 * Math.PI) + (tuning.riseShare ?? 0.5) / 2, tuning.riseShare ?? 0.5),
        roll: ((sway * Math.PI) / 180) * Math.sin(swayPhase + offset),
        amp,
        bobPhase,
      };
    },
  };
}
