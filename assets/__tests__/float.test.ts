import { describe, expect, it } from 'vitest';
import { placeSeaweed, swayAngle } from '../ambient-float/placement.ts';
import { createFloat } from '../float-fx/float.ts';
import { canyonCenterX } from '../shared/layout.ts';
import { defaultTuning } from '../shared/tuning.ts';

const t = defaultTuning();
const DT = 1 / 60;

function measure(mode: 'idle' | 'move' | 'sprint', seconds = 6) {
  const float = createFloat();
  const ys: number[] = [];
  const rolls: number[] = [];
  for (let i = 0; i < seconds / DT; i += 1) {
    const s = float.step(mode, t.float, DT);
    ys.push(s.y);
    rolls.push(s.roll);
  }
  const tail = ys.slice(ys.length / 2);
  // Interpolated upward zero crossings: frequency = cycles / time between first and last crossing.
  const times: number[] = [];
  for (let i = 1; i < tail.length; i += 1) {
    if (tail[i - 1]! < 0 && tail[i]! >= 0) times.push((i - 1 + -tail[i - 1]! / (tail[i]! - tail[i - 1]!)) * DT);
  }
  const hz = times.length > 1 ? (times.length - 1) / (times.at(-1)! - times[0]!) : 0;
  return { amp: (Math.max(...tail) - Math.min(...tail)) / 2, hz, roll: Math.max(...rolls.slice(rolls.length / 2)) };
}

describe('Nezha float', () => {
  it('idles at ±5 cm, 0.8 Hz (±10%) with ±1.5° sway', () => {
    const m = measure('idle');
    expect(m.amp).toBeCloseTo(0.05, 3);
    expect(Math.abs(m.hz - 0.8) / 0.8).toBeLessThanOrEqual(0.1);
    expect((m.roll * 180) / Math.PI).toBeCloseTo(1.5, 1);
  });
  it('drops to ±3 cm moving and ±1.5 cm without sway when sprinting', () => {
    expect(measure('move').amp).toBeCloseTo(0.03, 3);
    const sprint = measure('sprint');
    expect(sprint.amp).toBeCloseTo(0.015, 3);
    expect(Math.abs(sprint.roll)).toBeLessThan(1e-3);
  });
});

describe('environment float', () => {
  it('plants exactly the requested seaweed counts per group', () => {
    for (const [group, count] of [['canyon', 240], ['edge', 180], ['far', 60]] as const) {
      expect(placeSeaweed(group, count, 1.2).reduce((n, c) => n + c.blades.length, 0)).toBe(count);
    }
  });
  it('keeps the canyon centre lane and the vortex clear', () => {
    for (const clump of placeSeaweed('canyon', 600, 1.2)) expect(Math.abs(clump.x - canyonCenterX(clump.z))).toBeGreaterThanOrEqual(1.5 - 1e-6);
    for (const clump of placeSeaweed('edge', 450, 1.2)) expect(Math.hypot(clump.x, clump.z)).toBeGreaterThanOrEqual(20.6 - 1e-6);
  });
  it('sways no faster than 0.25 Hz', () => {
    let crossings = 0;
    for (let i = 1; i < 6000; i += 1) if (swayAngle((i - 1) / 100, 0.18, 3, 4) < 0 && swayAngle(i / 100, 0.18, 3, 4) >= 0) crossings += 1;
    expect(crossings / 60).toBeLessThanOrEqual(0.25);
  });
});
