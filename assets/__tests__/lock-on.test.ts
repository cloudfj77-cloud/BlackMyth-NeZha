import { describe, expect, it } from 'vitest';
import { axisPoint, keepOutside, lockedVelocity, strikeTest, surfaceDistance, type TargetShape } from '../lock-on/geometry.ts';

const long: TargetShape = { cx: 0, cz: -7, yaw: 0, length: 20, thickness: 3, height: 8 };

describe('long lock target', () => {
  it('measures lock distance from the body surface', () => {
    expect(surfaceDistance(long, 0, 10)).toBeCloseTo(15.5);
    expect(surfaceDistance(long, 13, -7)).toBeCloseTo(3);
    expect(surfaceDistance(long, 0, -7)).toBe(0);
  });
  it('orbits around the nearest axis point and holds the radius while strafing', () => {
    let x = 0, z = 3;
    const r0 = Math.hypot(x - axisPoint(long, x, z).x, z - axisPoint(long, x, z).z);
    for (let i = 0; i < 2400; i += 1) {
      const v = lockedVelocity(long, x, z, 1, 0, 5, r0, 1.5);
      x += v.x / 60;
      z += v.z / 60;
      const p = keepOutside(long, x, z, 0.5);
      x = p.x;
      z = p.z;
    }
    const pivot = axisPoint(long, x, z);
    expect(Math.hypot(x - pivot.x, z - pivot.z)).toBeCloseTo(r0, 0);
    expect(surfaceDistance(long, x, z)).toBeGreaterThan(5);
  });
  it('pushes the root out of the body', () => {
    const p = keepOutside(long, 1, -7.5, 0.5);
    expect(surfaceDistance(long, p.x, p.z)).toBeCloseTo(0.5);
  });
});

describe('melee judgement (from the body surface, nearest point within ±60°)', () => {
  const dummy: TargetShape = { cx: 0, cz: -7, yaw: 0, length: 4, thickness: 1, height: 2 };
  // Nezha south of the dummy facing north (yaw 0 looks toward -Z). Surface at z = -6.5.
  it('hits at 2.49 m and misses at 2.51 m (light), 2.99 / 3.01 m (heavy)', () => {
    expect(strikeTest(dummy, 0, -6.5 + 2.49, 0, 2.5, 60).hit).toBe(true);
    expect(strikeTest(dummy, 0, -6.5 + 2.51, 0, 2.5, 60).hit).toBe(false);
    expect(strikeTest(dummy, 0, -6.5 + 2.99, 0, 3, 60).hit).toBe(true);
    expect(strikeTest(dummy, 0, -6.5 + 3.01, 0, 3, 60).hit).toBe(false);
  });
  it('measures the angle to the nearest body point: 59° hits, 61° misses', () => {
    const d = 1.5;
    for (const [deg, hit] of [[59, true], [61, false]] as const) {
      const facing = (deg * Math.PI) / 180; // turned left by deg while the dummy is straight ahead
      expect(strikeTest(dummy, 0, -6.5 + d, facing, 2.5, 60).hit).toBe(hit);
    }
  });
  it('hits a long body whose centre is outside ±60° but nearest point is inside', () => {
    const long: TargetShape = { cx: 0, cz: -7, yaw: 0, length: 20, thickness: 1, height: 2 };
    // Nezha at x = 8 facing north: the centre is 70° to the left, the nearest point is straight ahead.
    const centreAngle = (Math.atan2(8, 2) * 180) / Math.PI;
    expect(centreAngle).toBeGreaterThan(60);
    expect(strikeTest(long, 8, -6.5 + 2, 0, 2.5, 60).hit).toBe(true);
  });
});
