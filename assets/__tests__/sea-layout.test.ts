import { describe, expect, it } from 'vitest';
import { ARENA } from '../shared/layout.ts';
import { AMBUSH, ARENA_PILLARS, gerstner, LEVEL_SCALE, onPlatform, SEA, SEA_LAMPS, seaConstrain } from '../shared/sea-layout.ts';

const R = 0.35;
const OPEN = { gateOpen: true, arenaOnly: false };
const SHUT = { gateOpen: false, arenaOnly: false };
const FIGHT = { gateOpen: true, arenaOnly: true };

describe('陈塘关 layout (v1.4.0 × 0.86)', () => {
  it('keeps v1.4.0 proportions', () => {
    expect(SEA.arenaRadius).toBeCloseTo(24 * LEVEL_SCALE, 6);
    expect(SEA.pathZ1 - SEA.pathZ0).toBeCloseTo(120 * LEVEL_SCALE, 6);
    expect(SEA_LAMPS.length).toBe(8);
    expect(ARENA_PILLARS.length).toBe(8); // v1.4.0's skip never fires: the two by the entry stand 8.4 m aside
    expect(Math.min(...ARENA_PILLARS.map((p) => Math.abs(p.x)))).toBeGreaterThan(SEA.pathHalfWidth + 3);
    expect(AMBUSH.map((w) => w.spawns.length)).toEqual([2, 3]);
    // Spawn is on the boardwalk, north of both ambush lines; the waves sit between spawn and gate.
    expect(SEA.spawn[1]).toBeGreaterThan(AMBUSH[0]!.z);
    expect(AMBUSH[1]!.spawns.every(([, z]) => z > SEA.gateZ)).toBe(true);
  });
  it('lets Nezha walk the boardwalk but not off its sides or past its north end', () => {
    expect(seaConstrain(0, 100, R, SHUT)).toEqual({ x: 0, z: 100 });
    expect(seaConstrain(9, 100, R, SHUT).x).toBeCloseTo(SEA.pathHalfWidth - R, 6);
    expect(seaConstrain(0, 200, R, SHUT).z).toBeCloseTo(SEA.pathZ1 - R, 6);
  });
  it('stops her at the shut water gate and lets her through once it opens', () => {
    const shut = seaConstrain(0, SEA.gateZ - 2, R, SHUT);
    expect(shut.z).toBeGreaterThan(SEA.gateZ);
    const open = seaConstrain(0, SEA.gateZ - 2, R, OPEN);
    expect(open.z).toBeCloseTo(SEA.gateZ - 2, 6);
    expect(seaConstrain(0, 0, R, OPEN)).toEqual({ x: 0, z: 0 });
  });
  it('keeps her on the platform (boss boundary) and seals the boardwalk in the fight', () => {
    const p = seaConstrain(30, 0, R, OPEN);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(ARENA.boundary, 6);
    const f = seaConstrain(0, 40, R, FIGHT);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(ARENA.boundary, 6);
    expect(onPlatform(0, SEA.entryZ - 1)).toBe(true);
    expect(onPlatform(0, SEA.entryZ + 1)).toBe(false);
  });
  it('pushes her out of the lamps and the lotus pond', () => {
    const [lx, lz] = SEA_LAMPS[2]!;
    const p = seaConstrain(lx, lz + 0.01, R, SHUT);
    expect(Math.hypot(p.x - lx, p.z - lz)).toBeGreaterThanOrEqual(0.45 * LEVEL_SCALE + R - 1e-6);
    const q = seaConstrain(SEA.lotus[0] - 0.5, SEA.lotus[1], R, SHUT);
    expect(Math.hypot(q.x - SEA.lotus[0], q.z - SEA.lotus[1])).toBeGreaterThanOrEqual(SEA.lotusRadius + R - 1e-6);
  });
  it('waves stay below the walking surface and have upward normals', () => {
    let top = -Infinity;
    for (let i = 0; i < 400; i += 1) {
      const g = gerstner((i * 7.3) % 90 - 45, (i * 3.1) % 140 - 20, i * 0.37);
      top = Math.max(top, SEA.seaY + g.dy);
      expect(g.ny).toBeGreaterThan(0.5);
    }
    expect(top).toBeLessThan(-0.3);
  });
});
