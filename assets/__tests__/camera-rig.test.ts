import { describe, expect, it } from 'vitest';
import { boomLimit, createBoom, desiredBoom, orbitDirection, wallLift } from '../camera/rig.ts';
import { defaultTuning } from '../shared/tuning.ts';

const cam = defaultTuning().camera;

describe('right-shoulder camera rig', () => {
  it('sits behind the focus and 0.6 m to the right', () => {
    const { unit, length } = desiredBoom([0, 1.6, 0], 0, 0, 5, 0.6);
    const pos = [unit[0] * length, 1.6 + unit[1] * length, unit[2] * length];
    expect(pos[0]).toBeCloseTo(0.6);
    expect(pos[2]).toBeCloseTo(5);
    expect(orbitDirection(0, 0)[2]).toBeCloseTo(1);
  });
  it('pulls in instantly and returns after a delay with easing', () => {
    const boom = createBoom(5);
    expect(boom.step(2, cam, 1 / 60)).toBe(2);
    expect(boom.step(5, cam, 0.05)).toBe(2); // still inside the return delay
    let length = 2;
    for (let t = 0; t < 0.6; t += 1 / 60) length = boom.step(5, cam, 1 / 60);
    expect(length).toBeGreaterThan(4.8);
  });
  it('keeps the margin in front of the nearest hit', () => {
    expect(boomLimit(5, [undefined, 3, 4], 0.3)).toEqual({ limit: 2.7, blocked: true });
    expect(boomLimit(5, [undefined], 0.3).blocked).toBe(false);
  });
  it('lifts up the wall to keep ≥ 1.2 m from the focus, capped at 1.05 m', () => {
    expect(wallLift(1.5, cam)).toBe(0);
    const lift = wallLift(0.8, cam);
    expect(Math.hypot(0.8, lift)).toBeCloseTo(1.2);
    expect(wallLift(0, cam)).toBeCloseTo(1.05);
    expect(wallLift(0.2, cam, 0.4)).toBeCloseTo(0.4);
  });
});
