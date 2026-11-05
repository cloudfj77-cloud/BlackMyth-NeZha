import { describe, expect, it } from 'vitest';
import { axisPoint, keepOutside, lockedVelocity, surfaceDistance, type TargetShape } from '../lock-on/geometry.ts';

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
