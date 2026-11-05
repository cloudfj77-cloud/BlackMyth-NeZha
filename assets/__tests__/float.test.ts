import { describe, expect, it } from 'vitest';
import { placeSeaweed, swayAngle } from '../ambient-float/placement.ts';
import { bobShape, createFloat } from '../float-fx/float.ts';
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
  it('idles at ±15 cm, 0.8 Hz (±10%) with ±3° sway (M3)', () => {
    const m = measure('idle');
    expect(m.amp).toBeCloseTo(0.15, 3);
    expect(Math.abs(m.hz - 0.8) / 0.8).toBeLessThanOrEqual(0.1);
    expect((m.roll * 180) / Math.PI).toBeCloseTo(3, 1);
  });
  it('rises over 35 % of each cycle and settles over the rest, without a seam', () => {
    let rising = 0;
    const n = 1000;
    for (let i = 0; i < n; i += 1) if (bobShape((i + 1) / n, 0.35) > bobShape(i / n, 0.35)) rising += 1;
    expect(rising / n).toBeCloseTo(0.35, 2);
    for (const p of [0, 0.35, 1]) expect(Math.abs(bobShape(p - 1e-6, 0.35) - bobShape(p + 1e-6, 0.35))).toBeLessThan(1e-3);
    // Symmetric share reproduces the M1 sine.
    for (let p = 0; p < 1; p += 0.05) expect(bobShape(p + 0.25, 0.5)).toBeCloseTo(Math.sin(2 * Math.PI * p), 6);
  });
  it('drops to ±10 cm moving and ±5 cm without sway when sprinting (M3)', () => {
    expect(measure('move').amp).toBeCloseTo(0.1, 3);
    const sprint = measure('sprint');
    expect(sprint.amp).toBeCloseTo(0.05, 3);
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
