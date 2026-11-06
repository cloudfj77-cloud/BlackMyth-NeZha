import { describe, expect, it } from 'vitest';
import { radius, zoneHits } from '../dragon/body.ts';
import { AOBING, createAobing, moveSteps, type AobingEvent } from '../dragon/aobing.ts';

const R = 0.35;
type Ev = { step: number; e: AobingEvent };
const run = (b: ReturnType<typeof createAobing>, n: number, nezha = { x: 0, z: 0 }, engaged = true) => {
  const out: Ev[] = [];
  for (let i = 1; i <= n; i += 1) for (const e of b.step({ nezha, engaged })) out.push({ step: i, e });
  return out;
};

describe('敖丙 on the long dragon (v1.4.0 boss AI)', () => {
  it('keeps v1.4.0 timings, ÷3 damage and 0.86 distances', () => {
    const c = moveSteps('combo', false);
    expect(c.map((s) => s.anim)).toEqual(['slashR', 'slashL', 'smash']);
    expect(c.map((s) => s.wind)).toEqual([43, 28, 37]);
    expect(c.map((s) => s.damage)).toEqual([10, 10, 14]);
    expect(c[0]!.range).toBeCloseTo(5.6 * 0.86, 6);
    const c2 = moveSteps('combo', true);
    expect(c2.length).toBe(4);
    expect(c2[3]!.ice).toBe(true);
    expect(moveSteps('lunge', false).length).toBe(1);
    expect(moveSteps('lunge', true).length).toBe(3);
    expect(moveSteps('sweep', true).length).toBe(2);
    expect(moveSteps('leap', true)[0]!.air).toBe(57);
  });
  it('floats low: the body underside stays in the hover band (≈ Nezha’s 0.5 m), bobbing', () => {
    const b = createAobing({ seed: 3 });
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 600; i += 1) {
      b.step({ nezha: { x: 0, z: 14 }, engaged: false });
      const p = b.points();
      for (let j = 10; j < p.length; j += 1) { const u = p[j]![1] - radius(j); lo = Math.min(lo, u); hi = Math.max(hi, u); }
    }
    expect(lo).toBeGreaterThan(AOBING.hover - 0.2);
    expect(hi).toBeLessThan(AOBING.hover + 0.25);
    expect(hi - lo).toBeGreaterThan(0.08);
  });
  it('chases Nezha and attacks with a telegraph whose zone covers her', () => {
    const b = createAobing({ seed: 5 });
    const ev = run(b, 900, { x: 0, z: 2 });
    const tele = ev.filter((x) => x.e.type === 'telegraph');
    const hits = ev.filter((x) => x.e.type === 'hit');
    expect(tele.length).toBeGreaterThan(2);
    expect(hits.length).toBeGreaterThan(2);
    const landed = hits.filter((h) => h.e.type === 'hit' && zoneHits(h.e.zone, 0, 2, R)).length;
    expect(landed).toBeGreaterThan(0);
  });
  it('uses all three phase-1 moves and never the leap; phase 2 adds the leap, spikes and the ice ring', () => {
    const b = createAobing({ seed: 11 });
    const seen = new Set<string>();
    for (const z of [2, 3, 9, 12, 2, 4, 10]) for (const x of run(b, 600, { x: 0, z })) if (x.e.type === 'telegraph') seen.add(x.e.kind);
    expect(seen.has('slash') && seen.has('sweep') && seen.has('thrust')).toBe(true);
    expect(seen.has('leap')).toBe(false);
    const b2 = createAobing({ seed: 11, phase2: true });
    const seen2 = new Set<string>();
    const fx = new Set<string>();
    for (const z of [9, 2, 10, 3, 12, 8, 2]) for (const x of run(b2, 600, { x: 0, z })) {
      if (x.e.type === 'telegraph' || x.e.type === 'hit') seen2.add(x.e.kind);
      if (x.e.type === 'fx') fx.add(x.e.fx);
    }
    expect(seen2.has('leap')).toBe(true);
    expect(fx.has('spikes')).toBe(true);
    expect(fx.has('icering')).toBe(true);
  });
  it('the ice ring catches a grounded Nezha who dodged the leap, once, and can be jumped (≤ 0.7 m)', () => {
    const b = createAobing({ seed: 2, phase2: true });
    let nz = { x: 0, z: 10 };
    let ring: AobingEvent | undefined;
    let at: { x: number; z: number } | undefined;
    for (let i = 0; i < 6000 && !ring; i += 1) {
      if (!at && i % 400 === 0) nz = { x: (i % 800 === 0 ? 1 : -1) * 2, z: i % 1200 < 600 ? 10 : 3 };
      for (const e of b.step({ nezha: nz, engaged: true })) {
        if (e.type === 'fx' && e.fx === 'icering' && !at) { at = e.at; nz = { x: at.x + 4, z: at.z }; }
        if (e.type === 'hit' && e.kind === 'icering') ring = e;
      }
    }
    expect(at).toBeDefined();
    expect(ring && ring.type === 'hit' && ring.maxAir).toBe(AOBING.airRing);
  });
  it('half health starts the phase change (570 steps first, 240 after) with the roar at 48', () => {
    const b = createAobing({ seed: 1, hp: AOBING.hpMax / 2 + 5 });
    run(b, 5);
    expect(b.damage(10)).toBe('phase');
    expect(b.snapshot().mode).toBe('roar');
    expect(b.damage(10)).toBe('ignored');
    const ev = run(b, 600);
    expect(ev.find((x) => x.e.type === 'fx' && x.e.fx === 'roar')!.step).toBe(AOBING.roarAt);
    expect(ev.find((x) => x.e.type === 'transition-end')!.step).toBe(AOBING.transitionFirst);
    expect(b.snapshot().phase).toBe(2);
    const again = createAobing({ seed: 1, hp: AOBING.hpMax / 2 + 5, transitionSeen: true });
    again.damage(10);
    expect(again.snapshot().transitionLen).toBe(AOBING.transitionRepeat);
  });
  it('破势: poise from hits staggers it for 2.1 s; staggered hits deal ×1.35', () => {
    const b = createAobing({ seed: 4 });
    run(b, 2, { x: 0, z: 30 }, false);
    let n = 0;
    while (b.snapshot().mode !== 'stagger' && n < 40) { b.damage(9); n += 1; }
    expect(b.snapshot().mode).toBe('stagger');
    expect(b.snapshot().breaks).toBe(1);
    expect(n).toBe(Math.ceil(AOBING.poise1 / (9 * 1.2)));
    const hp0 = b.snapshot().hp;
    b.damage(10);
    expect(hp0 - b.snapshot().hp).toBeCloseTo(13.5, 6);
    run(b, AOBING.staggerSteps, { x: 0, z: 30 }, false);
    expect(b.snapshot().mode).toBe('chase');
  });
  it('stays on the stage and dies at 0', () => {
    const b = createAobing({ seed: 8, hp: 5, phase2: true });
    for (const z of [18, -18, 0]) run(b, 400, { x: 15, z });
    expect(Math.hypot(b.snapshot().pos.x, b.snapshot().pos.z)).toBeLessThanOrEqual(AOBING.roam + 1e-6);
    expect(b.damage(10)).toBe('dead');
    const ev = run(b, AOBING.deathSteps);
    expect(ev.some((x) => x.e.type === 'dead-done')).toBe(true);
  });
  it('plays the M4 intro from the lurk and hands over facing Nezha', () => {
    const b = createAobing({ start: 'lurk' });
    run(b, 10);
    expect(b.snapshot().mode).toBe('lurk');
    b.beginIntro();
    const ev = run(b, 900, { x: 0, z: 16.5 });
    expect(ev.some((x) => x.e.type === 'intro-end')).toBe(true);
    expect(b.snapshot().mode).not.toBe('intro');
  });
});
