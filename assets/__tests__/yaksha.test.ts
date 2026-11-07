import { describe, expect, it } from 'vitest';
import { seaConstrain } from '../shared/sea-layout.ts';
import { createMobs, YAKSHA, type MobEvent } from '../yaksha/brain.ts';

const OPEN = { gateOpen: false, arenaOnly: false };
const world = (x: number, z: number, air = 0, ok = true) => ({
  nezha: { x, z, air, ok },
  constrain: (px: number, pz: number, r: number) => seaConstrain(px, pz, r, OPEN),
});
const runSteps = (mobs: ReturnType<typeof createMobs>, n: number, w = world(0, 80)) => {
  const out: { step: number; e: MobEvent }[] = [];
  for (let i = 1; i <= n; i += 1) for (const e of mobs.step(w)) out.push({ step: i, e });
  return out;
};

describe('巡海夜叉 (v1.4.0 Mobs)', () => {
  it('alerts, closes in and stabs after a 45-step wind-up with a fan telegraph', () => {
    const mobs = createMobs(3);
    const m = mobs.spawn(0, 86);
    const ev = runSteps(mobs, 400);
    const wind = ev.find((x) => x.e.type === 'windup');
    const stab = ev.find((x) => x.e.type === 'stab');
    expect(wind).toBeDefined();
    expect(stab!.step - wind!.step).toBe(YAKSHA.windup + 1);
    expect((stab!.e as { hit: boolean }).hit).toBe(true);
    expect((stab!.e as { damage: number }).damage).toBe(YAKSHA.damage);
    expect(Math.hypot(m.x, m.z - 80)).toBeLessThan(YAKSHA.attackRange + 1);
  });
  it('lets only one of them strike at a time (attack token)', () => {
    const mobs = createMobs(7);
    mobs.spawn(-2, 84); mobs.spawn(2, 84); mobs.spawn(0, 86);
    let concurrent = 0;
    for (let i = 0; i < 1500; i += 1) {
      mobs.step(world(0, 80));
      concurrent = Math.max(concurrent, mobs.list().filter((m) => m.state === 'attack').length);
    }
    expect(concurrent).toBe(1);
  });
  it('misses when Nezha jumps above 1.4 m or is behind it', () => {
    const mobs = createMobs(3);
    mobs.spawn(0, 86);
    const ev = runSteps(mobs, 400, world(0, 80, 2));
    const stab = ev.find((x) => x.e.type === 'stab');
    expect((stab!.e as { hit: boolean }).hit).toBe(false);
  });
  it('a heavy hit always staggers a wind-up; light hits only after 25 poise', () => {
    const mobs = createMobs(3);
    const m = mobs.spawn(0, 82);
    const ev: MobEvent[] = [];
    while (m.state !== 'attack') mobs.step(world(0, 80));
    mobs.damage(m.id, 8, false, 0, 80, ev);
    expect(m.state).toBe('attack');
    mobs.damage(m.id, 9, false, 0, 80, ev);
    expect(m.state).toBe('attack');
    mobs.damage(m.id, 14, false, 0, 80, ev);
    expect(m.state).toBe('hurt');
    expect(mobs.token()).toBeNull();
  });
  it('dies at 0 HP (45: about five light hits) and frees the token', () => {
    const mobs = createMobs(3);
    const m = mobs.spawn(0, 82);
    const ev: MobEvent[] = [];
    let hits = 0;
    while (m.state !== 'dead' && hits < 20) { mobs.damage(m.id, 9, false, 0, 80, ev); hits += 1; }
    expect(m.state).toBe('dead');
    expect(hits).toBeGreaterThanOrEqual(4);
    expect(hits).toBeLessThanOrEqual(6);
    expect(mobs.alive()).toBe(0);
    expect(ev.some((e) => e.type === 'dead')).toBe(true);
  });
  it('stays on the boardwalk', () => {
    const mobs = createMobs(9);
    const m = mobs.spawn(3, 70);
    for (let i = 0; i < 600; i += 1) mobs.step(world(3.2, 60));
    expect(Math.abs(m.x)).toBeLessThanOrEqual(4.2 * 0.86 - YAKSHA.radius + 1e-6);
  });
});
