/**
 * Nezha's procedural float (pure; tested). Visual only: the result offsets the
 * model child, never the root or the capsule.
 *
 * Idle: ±idleAmp at idleFreq, plus ±swayDeg roll at swayFreq, 90° out of phase.
 * Moving: amplitude drops to moveAmp; sprinting to sprintAmp with no sway.
 * Amplitude changes blend over `blendTime`; phase is continuous (no pops).
 */
export interface FloatTuning {
  readonly idleAmp: number;
  readonly idleFreq: number;
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
        y: amp * Math.sin(bobPhase),
        roll: ((sway * Math.PI) / 180) * Math.sin(swayPhase + offset),
        amp,
        bobPhase,
      };
    },
  };
}
