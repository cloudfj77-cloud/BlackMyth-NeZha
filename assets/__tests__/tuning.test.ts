import { describe, expect, it } from 'vitest';
import { defaultTuning, overrides, readPath, TUNING_RANGES, writePath } from '../shared/tuning.ts';

describe('tuning.json', () => {
  it('keeps the locked design values', () => {
    const t = defaultTuning();
    expect(t.move).toMatchObject({ walkSpeed: 5, sprintSpeed: 9, accelTime: 0.1, decelTime: 0.15, turnRate: 720, sprintHoldThreshold: 0, hoverHeight: 0.3 });
    expect(t.float).toMatchObject({ idleAmp: 0.05, idleFreq: 0.8, swayDeg: 1.5, swayFreq: 0.55, swayPhase: 90, moveAmp: 0.03, sprintAmp: 0.015 });
    expect(t.lock).toMatchObject({ acquireRange: 25, breakRange: 30 });
    expect(t.camera).toMatchObject({ shoulderOffset: 0.6, minDistance: 1.2, distance: 5 });
    expect(t.ambient.seaweedCanyon + t.ambient.seaweedEdge + t.ambient.seaweedFar).toBe(480);
    expect(t.ambient.seaweedSwayHz).toBeLessThanOrEqual(0.25);
    expect(t.combat).toMatchObject({ hitstopLight1: 3, hitstopLight3: 5, hitstopHeavyMin: 5, hitstopHeavyMax: 8, shakeHeavyMax: 0.06, slowmoSteps: 18, rollDistance: 3, costLight: 6, costHeavy: 15 });
  });
  it('every default lies inside its panel range', () => {
    const t = defaultTuning();
    for (const [path, range] of Object.entries(TUNING_RANGES)) {
      const value = readPath(t, path);
      expect(value, path).toBeDefined();
      expect(value!, path).toBeGreaterThanOrEqual(range![0]);
      expect(value!, path).toBeLessThanOrEqual(range![1]);
    }
  });
  it('clamps panel edits and reports overrides', () => {
    const t = defaultTuning();
    expect(writePath(t, 'move.walkSpeed', 100)).toBe(true);
    expect(t.move.walkSpeed).toBe(8);
    expect(writePath(t, 'move.capsuleHeight', 3)).toBe(false);
    expect(overrides(t)).toEqual({ 'move.walkSpeed': 8 });
  });
});
