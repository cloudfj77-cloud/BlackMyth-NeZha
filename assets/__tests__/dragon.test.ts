import { describe, expect, it } from 'vitest';
import {
  ATTACKS,
  attackFrame,
  createAttack,
  damagingDiscs,
  discHull,
  hitCrossesBand,
  hurtCapsules,
  HITTABLE_UNDERSIDE,
  OPENING,
  polygonDistance,
  radius,
  straightBody,
  type AttackKind,
  type Disc,
  type Polygon,
} from '../dragon/body.ts';
import { BRAIN, createBrain } from '../dragon/brain.ts';

/** Raster check on a 5 cm grid: warning polygon vs the true union of damaging body discs. */
function coverage(poly: Polygon, discs: readonly Disc[]) {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const cell = 0.05;
  // Bucket the discs on a 1 m grid so the union test stays fast.
  const buckets = new Map<string, Disc[]>();
  for (const d of discs) {
    for (let gx = Math.floor(d.x - d.r); gx <= Math.floor(d.x + d.r); gx += 1)
      for (let gz = Math.floor(d.z - d.r); gz <= Math.floor(d.z + d.r); gz += 1) {
        const key = `${gx},${gz}`;
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(d);
      }
  }
  const near = (x: number, z: number) => buckets.get(`${Math.floor(x)},${Math.floor(z)}`) ?? [];
  let union = 0, both = 0, maxOut = 0;
  const outside: [number, number][] = [];
  for (let x = Math.min(...xs) - 0.2; x <= Math.max(...xs) + 0.2; x += cell) {
    for (let z = Math.min(...zs) - 0.2; z <= Math.max(...zs) + 0.2; z += cell) {
      const u = near(x, z).some((d) => (x - d.x) ** 2 + (z - d.z) ** 2 <= d.r * d.r);
      const w = polygonDistance(poly, x, z) <= 0;
      if (u) union += 1;
      if (u && w) both += 1;
      if (w && !u) outside.push([x, z]);
    }
  }
  for (const [x, z] of outside) {
    let d = Infinity;
    for (let gx = Math.floor(x) - 1; gx <= Math.floor(x) + 1; gx += 1)
      for (let gz = Math.floor(z) - 1; gz <= Math.floor(z) + 1; gz += 1)
        for (const q of buckets.get(`${gx},${gz}`) ?? []) d = Math.min(d, Math.hypot(x - q.x, z - q.z) - q.r);
    maxOut = Math.max(maxOut, Math.min(d, 1));
  }
  return { overlap: both / Math.max(1, union), maxOut };
}

const chain = straightBody({ x: 0, z: 6 }, { x: 0, z: -1 });
const NEZHA = { x: 0, z: -2 };

describe('dragon attacks: warning = damage = what the body really sweeps', () => {
  for (const kind of ['bite', 'lash', 'charge'] as AttackKind[]) {
    const nezha = kind === 'lash' ? { x: 4, z: 6 + 11.25 } : kind === 'charge' ? { x: 0, z: -9 } : NEZHA;
    const att = createAttack(kind, chain, 0, 1, nezha);
    const discs = damagingDiscs(att);
    const poly = discHull(discs);
    it(`${kind}: overlap ≥ 90 %, outflow ≤ 0.1 m, the hit frame crosses the 1.2–2.6 m band`, () => {
      expect(discs.length).toBeGreaterThan(0);
      const c = coverage(poly, discs);
      expect(c.overlap).toBeGreaterThanOrEqual(0.9);
      expect(c.maxOut).toBeLessThanOrEqual(0.1);
      expect(hitCrossesBand(att)).toBe(true);
    });
    it(`${kind}: the hold never moves (definite freeze)`, () => {
      const A = ATTACKS[kind];
      const a = attackFrame(att, A.windup).points, b = attackFrame(att, A.hold).points;
      const moved = Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1], p[2] - b[i]![2])));
      expect(moved).toBeLessThan(1e-9);
    });
    it(`${kind}: in the opening the front 11 m lies low enough to be hit`, () => {
      const A = ATTACKS[kind];
      const pts = attackFrame(att, A.hit + 30).points;
      const front = hurtCapsules(pts).filter((c) => !c.tail);
      expect(front.every((c) => c.bottom <= HITTABLE_UNDERSIDE)).toBe(true);
      expect(pts[0]![1]).toBeCloseTo(2.2, 1);
    });
  }
  it('bite reaches about 9 m ahead, the lash sweeps a 7 m / 140° fan, the charge stays inside r 19 m', () => {
    const bite = discHull(damagingDiscs(createAttack('bite', chain, 0, 1, NEZHA)));
    expect(Math.min(...bite.map((p) => p.z))).toBeLessThan(6 - 7.5);
    const lash = createAttack('lash', chain, 0, 1, { x: 4, z: 17.25 });
    expect(Math.abs(lash.theta1 - lash.theta0)).toBeCloseTo((140 * Math.PI) / 180, 6);
    const reach = Math.max(...damagingDiscs(lash).map((d) => Math.hypot(d.x - lash.pivot.x, d.z - lash.pivot.z) + d.r));
    expect(reach).toBeGreaterThan(6.6);
    expect(reach).toBeLessThan(7.3);
    const far = createAttack('charge', straightBody({ x: 0, z: 14 }, { x: 0, z: -1 }), 0, 1, { x: 0, z: -18 });
    expect(far.length).toBeCloseTo(16, 6);
    const edge = createAttack('charge', straightBody({ x: 0, z: -8 }, { x: 0, z: -1 }), 0, 1, { x: 0, z: -18 });
    expect(edge.length).toBeCloseTo(11, 6);
  });
});

describe('hurt capsules', () => {
  it('has 6 front and 4 tail capsules; a swimming dragon cannot be hit (underside > 2.5 m)', () => {
    const caps = hurtCapsules(chain);
    expect(caps.filter((c) => !c.tail).length).toBe(6);
    expect(caps.filter((c) => c.tail).length).toBe(4);
    expect(Math.min(...caps.map((c) => c.bottom))).toBeGreaterThan(HITTABLE_UNDERSIDE);
    expect(radius(5) * 2).toBeCloseTo(1.5);
  });
});

describe('dragon AI', () => {
  const run = (nezha: { x: number; z: number } | ((step: number) => { x: number; z: number }), steps: number) => {
    const brain = createBrain();
    const telegraphs: { step: number; kind: AttackKind; forced: boolean }[] = [];
    let minOverhead = Infinity;
    let maxGapToHit = 0;
    let lastOpeningEnd = 0;
    for (let s = 1; s <= steps; s += 1) {
      const n = typeof nezha === 'function' ? nezha(s) : nezha;
      for (const e of brain.step({ nezha: n, engaged: true })) {
        if (e.type === 'telegraph') telegraphs.push({ step: s, kind: e.kind, forced: e.forced });
        if (e.type === 'opening-end') lastOpeningEnd = s;
        if (e.type === 'hit') maxGapToHit = Math.max(maxGapToHit, s - lastOpeningEnd);
      }
      // Passing over = swimming at height (after the 90-step rise and retreat that follows an opening).
      if (brain.snapshot().mode === 'swim' && brain.snapshot().since > BRAIN.returnAt) {
        for (const [i, p] of brain.points().entries()) {
          if (Math.hypot(p[0] - n.x, p[2] - n.z) < radius(i) + 0.35) minOverhead = Math.min(minOverhead, p[1] - radius(i));
        }
      }
    }
    return { brain, telegraphs, minOverhead, maxGapToHit };
  };

  it('keeps ≥ 60 steps between attacks, never more than 2 of a kind in a row, and always threatens within 234 steps', () => {
    const { brain, telegraphs, maxGapToHit } = run((s) => ({ x: 6 * Math.sin(s / 300), z: 4 * Math.cos(s / 400) }), 6000);
    expect(telegraphs.length).toBeGreaterThan(10);
    for (const entry of brain.snapshot().log) expect(entry.sinceOpening).toBeGreaterThanOrEqual(entry.forced ? BRAIN.maxGap : BRAIN.minGap);
    for (let i = 2; i < telegraphs.length; i += 1) {
      const same = telegraphs[i]!.kind === telegraphs[i - 1]!.kind && telegraphs[i]!.kind === telegraphs[i - 2]!.kind;
      expect(same).toBe(false);
    }
    expect(maxGapToHit).toBeLessThanOrEqual(BRAIN.maxGap + ATTACKS.lash.hit);
    expect(new Set(telegraphs.map((t) => t.kind)).size).toBe(3);
  });
  it('starts regular bites and charges facing Nezha within 30°', () => {
    const { brain } = run((s) => ({ x: 8 * Math.sin(s / 250), z: 8 * Math.cos(s / 330) }), 6000);
    for (const entry of brain.snapshot().log) if (!entry.forced && entry.kind !== 'lash') expect(entry.aligned).toBeLessThanOrEqual(BRAIN.alignDeg + 1e-6);
  });
  it('passes over Nezha with its underside at least 3.5 m up', () => {
    const { minOverhead } = run((s) => ({ x: 3 * Math.sin(s / 200), z: 3 * Math.cos(s / 260) }), 4000);
    expect(minOverhead).toBeGreaterThanOrEqual(3.5);
  });
  it('gives a 72-step opening after every hit frame, then swims again', () => {
    const brain = createBrain();
    let hitAt = 0, endAt = 0;
    for (let s = 1; s < 4000 && !endAt; s += 1) {
      for (const e of brain.step({ nezha: { x: 0, z: 0 }, engaged: true })) {
        if (e.type === 'hit') hitAt = s;
        if (e.type === 'opening-end' && hitAt) endAt = s;
      }
      if (hitAt && s > hitAt && s < hitAt + OPENING) expect(brain.snapshot().opening).toBe(true);
    }
    expect(endAt - hitAt).toBe(OPENING);
  });
  it('patrols the band and never attacks while Nezha is not on the vortex', () => {
    const brain = createBrain();
    for (let s = 1; s <= 2000; s += 1) {
      const events = brain.step({ nezha: { x: 0, z: 40 }, engaged: false });
      expect(events.some((e) => e.type === 'telegraph')).toBe(false);
      const h = brain.points()[0]!;
      expect(Math.hypot(h[0], h[2])).toBeLessThanOrEqual(22 + 1e-6);
    }
  });
  it('dies at 0 hp and finishes the fall after 180 steps', () => {
    const brain = createBrain();
    expect(brain.damage(799)).toBe(false);
    expect(brain.damage(5)).toBe(true);
    let done = 0;
    for (let s = 1; s <= 200 && !done; s += 1) if (brain.step({ nezha: { x: 0, z: 0 }, engaged: true }).some((e) => e.type === 'dead-done')) done = s;
    expect(done).toBe(BRAIN.deathSteps);
    expect(Math.max(...brain.points().map((p, i) => p[1] - radius(i)))).toBeLessThan(0.1);
  });
});
