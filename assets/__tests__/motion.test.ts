import { describe, expect, it } from 'vitest';
import { createShiftGesture, createVelocityStepper, leanForSpeed, turnToward } from '../hover-player/motion.ts';
import { defaultTuning } from '../shared/tuning.ts';

const tuning = defaultTuning().move;
const DT = 1 / 60;

function run(from: { x: number; z: number }, target: { x: number; z: number }, top: number, frames: number) {
  let v = from;
  const stepper = createVelocityStepper();
  const speeds: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    v = stepper.step(v, target, top, tuning, DT);
    speeds.push(Math.hypot(v.x, v.z));
  }
  return speeds;
}

describe('hover locomotion', () => {
  it('reaches 95% of walk speed within 0.1 s (±1 frame) and holds 5 m/s', () => {
    const speeds = run({ x: 0, z: 0 }, { x: 0, z: -5 }, 5, 30);
    const t95 = (speeds.findIndex((s) => s >= 4.75) + 1) * DT;
    expect(t95).toBeLessThanOrEqual(0.1 + DT);
    expect(speeds.at(-1)).toBeCloseTo(5, 6);
  });
  it('stops from walk and from sprint within 0.15 s and slides about 0.4 m from walk', () => {
    for (const top of [5, 9]) {
      const speeds = run({ x: 0, z: -top }, { x: 0, z: 0 }, top, 20);
      const stop = (speeds.findIndex((s) => s < 1e-6) + 1) * DT;
      expect(stop).toBeLessThanOrEqual(0.15 + DT);
    }
    const slide = run({ x: 0, z: -5 }, { x: 0, z: 0 }, 5, 20).reduce((sum, s) => sum + s * DT, 0);
    expect(slide).toBeGreaterThan(0.3);
    expect(slide).toBeLessThan(0.45);
  });
  it('turns 180° in 0.25 s at 720°/s', () => {
    let yaw = 0;
    let frames = 0;
    while (Math.abs(Math.abs(yaw) - Math.PI) > 1e-6 && frames < 60) {
      yaw = turnToward(yaw, Math.PI - 1e-9, tuning.turnRate, DT);
      frames += 1;
    }
    expect(frames * DT).toBeCloseTo(0.25, 1);
  });
  it('leans 10° at walk speed and 20° at sprint speed', () => {
    expect(leanForSpeed(5, tuning)).toBeCloseTo(10);
    expect(leanForSpeed(9, tuning)).toBeCloseTo(20);
    expect(leanForSpeed(0, tuning)).toBe(0);
  });
  it('splits Shift into tap (< 0.2 s) and hold (sprint after 0.2 s)', () => {
    const shift = createShiftGesture();
    let result = shift.update(true, DT, 0.2);
    for (let i = 0; i < 5; i += 1) result = shift.update(true, DT, 0.2);
    expect(result.sprint).toBe(false);
    expect(shift.update(false, DT, 0.2).tap).toBe(true);
    for (let i = 0; i < 14; i += 1) result = shift.update(true, DT, 0.2);
    expect(result.sprint).toBe(true);
    expect(shift.update(false, DT, 0.2).tap).toBe(false);
  });
});
