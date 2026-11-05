import { quat } from '@forgeax/engine/math';
import { describe, expect, it } from 'vitest';
import { project } from '../lock-on/lock-on.pack.ts';

function pose(position: [number, number, number], target: [number, number, number]) {
  const q = quat.fromLookAt(quat.create(), position, target, [0, 1, 0]);
  return { position, rotation: [q[0]!, q[1]!, q[2]!, q[3]!] as const, fov: (55 * Math.PI) / 180 };
}

describe('screen projection used for lock framing', () => {
  for (const [name, position] of [['from +Z', [0, 0, 5]], ['from +X', [5, 0, 0]], ['from -Z', [0, 0, -5]], ['from a diagonal above', [3, 2, -4]]] as const) {
    it(`centres the look target and keeps up / right consistent ${name}`, () => {
      const p = pose([...position], [0, 0, 0]);
      const centre = project([0, 0, 0], p, 16 / 9);
      expect(centre.visible).toBe(true);
      expect(centre.x).toBeCloseTo(0.5, 4);
      expect(centre.y).toBeCloseTo(0.5, 4);
      expect(project([0, 1, 0], p, 16 / 9).y).toBeLessThan(0.5);
      // Camera-right in world: cross(forward, up).
      const f = [-position[0], -position[1], -position[2]];
      const right = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];
      const n = Math.hypot(...right);
      expect(project([right[0]! / n, right[1]! / n, right[2]! / n], p, 16 / 9).x).toBeGreaterThan(0.5);
      expect(project([-f[0] * 2, -f[1] * 2, -f[2] * 2], p, 16 / 9).visible).toBe(false);
    });
  }
});
