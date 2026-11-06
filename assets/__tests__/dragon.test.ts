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
import { attackZone, COIL, zoneHits } from '../dragon/body.ts';
import { BRAIN, createBrain, INTRO, introHead } from '../dragon/brain.ts';
import { ARENA } from '../shared/layout.ts';

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
    // Nezha is pushed out of body parts below the 3.5 m clearance every step, as in the game (margin 0.4 m).
    let pushed: { x: number; z: number } | undefined;
    for (let s = 1; s <= steps; s += 1) {
      const scripted = typeof nezha === 'function' ? nezha(s) : nezha;
      let n = pushed ? { x: pushed.x + (scripted.x - pushed.x) * 0.2, z: pushed.z + (scripted.z - pushed.z) * 0.2 } : scripted;
      for (const [i, p] of brain.points().entries()) {
        if (p[1] - radius(i) >= BRAIN.overheadClear) continue;
        const dx = n.x - p[0], dz = n.z - p[2];
        const d = Math.hypot(dx, dz), want = radius(i) + 0.4;
        if (d < want && d > 1e-6) n = { x: p[0] + (dx / d) * want, z: p[2] + (dz / d) * want };
      }
      pushed = n;
      for (const e of brain.step({ nezha: n, engaged: true })) {
        if (e.type === 'telegraph') telegraphs.push({ step: s, kind: e.kind, forced: e.forced });
        if (e.type === 'opening-end') lastOpeningEnd = s;
        if (e.type === 'hit') maxGapToHit = Math.max(maxGapToHit, s - lastOpeningEnd);
      }
      // Passing over = any swimming step, including the rise right after an opening.
      if (brain.snapshot().mode === 'swim') {
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
  it('keeps the gap ≤ 180 steps and ≤ 2 in a row even when only forced attacks fit (Nezha 8–12 m out)', () => {
    for (const path of [(s: number) => ({ x: 10 * Math.sin(s / 400), z: 10 * Math.cos(s / 400) }), () => ({ x: 0, z: 15 }), () => ({ x: -11, z: -6 })]) {
      const { brain, telegraphs } = run(path, 6000);
      for (const entry of brain.snapshot().log) expect(entry.sinceOpening).toBeLessThanOrEqual(BRAIN.maxGap);
      for (let i = 2; i < telegraphs.length; i += 1) {
        expect(telegraphs[i]!.kind === telegraphs[i - 1]!.kind && telegraphs[i]!.kind === telegraphs[i - 2]!.kind).toBe(false);
      }
    }
  });
  it('does not bank waiting time while Nezha is off the vortex', () => {
    const brain = createBrain();
    for (let s = 0; s < 600; s += 1) brain.step({ nezha: { x: 0, z: 40 }, engaged: false });
    let first: number | undefined;
    for (let s = 0; s < 400 && first === undefined; s += 1) for (const e of brain.step({ nezha: { x: 0, z: 6 }, engaged: true })) if (e.type === 'telegraph') first = s;
    expect(first).toBeDefined();
    for (const entry of brain.snapshot().log) expect(entry.sinceOpening).toBeLessThanOrEqual(BRAIN.maxGap);
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
    const brain = createBrain({ phase2: true, hp: 400 });
    expect(brain.damage(399)).toBe('hurt');
    expect(brain.damage(5)).toBe('dead');
    let done = 0;
    for (let s = 1; s <= 200 && !done; s += 1) if (brain.step({ nezha: { x: 0, z: 0 }, engaged: true }).some((e) => e.type === 'dead-done')) done = s;
    expect(done).toBe(BRAIN.deathSteps);
    expect(Math.max(...brain.points().map((p, i) => p[1] - radius(i)))).toBeLessThan(0.1);
  });
});

const NEZ = (x = 0, z = 0) => ({ nezha: { x, z }, engaged: true });

describe('dragon phase 2 (M4)', () => {
  it('stops at half health: the excess is dropped, the attack in progress never lands, no damage while roaring', () => {
    const brain = createBrain();
    let tele = false;
    for (let s = 0; s < 600 && !tele; s += 1) tele = brain.step(NEZ()).some((e) => e.type === 'telegraph');
    expect(tele).toBe(true);
    expect(brain.damage(395)).toBe('hurt');
    expect(brain.damage(30)).toBe('phase');
    expect(brain.snapshot()).toMatchObject({ hp: 400, mode: 'roar', transitionLen: BRAIN.transitionFirst, telegraph: false });
    expect(brain.vulnerable()).toBe(false);
    expect(brain.damage(50)).toBe('ignored');
    let hits = 0, end = 0;
    for (let s = 1; s <= 700 && !end; s += 1) {
      for (const e of brain.step(NEZ(3, 2))) {
        if (e.type === 'hit') hits += 1;
        if (e.type === 'transition-end') end = s;
      }
    }
    expect(hits).toBe(0);
    expect(end).toBe(BRAIN.transitionFirst);
    expect(brain.snapshot().phase).toBe(2);
  });
  it('raises the head while roaring and laps the band, then comes back onto the vortex', () => {
    const brain = createBrain({ hp: 401 });
    brain.damage(5);
    for (let s = 0; s < 60; s += 1) brain.step(NEZ(0, 8));
    expect(brain.points()[0]![1]).toBeGreaterThan(5.5);
    let maxR = 0;
    for (let s = 60; s < 400; s += 1) {
      brain.step(NEZ(0, 8));
      maxR = Math.max(maxR, Math.hypot(brain.points()[0]![0], brain.points()[0]![2]));
    }
    expect(maxR).toBeGreaterThan(ARENA.radius);
  });
  it('opens phase 2 with the coil within 30 steps of the change (570 first, 240 when the lines were seen)', () => {
    for (const seen of [false, true]) {
      const brain = createBrain({ hp: 401, transitionSeen: seen });
      brain.damage(5);
      const len = seen ? BRAIN.transitionRepeat : BRAIN.transitionFirst;
      let coilAt = 0;
      for (let s = 1; s <= len + 60 && !coilAt; s += 1) for (const e of brain.step(NEZ(2, 6))) if (e.type === 'telegraph') coilAt = e.kind === 'coil' ? s : -s;
      expect(coilAt).toBeGreaterThan(len);
      expect(coilAt).toBeLessThanOrEqual(len + BRAIN.coilWindow);
    }
  });
  it('coil: head up to ~7.5 m, ring on the floor around the centre, judged on the 4.75–7 m ring at step 60 only', () => {
    const chain = straightBody({ x: 0, z: 0 }, { x: 0, z: -1 });
    const att = createAttack('coil', chain, 0, 1, { x: 0, z: -6 });
    const pose = attackFrame(att, ATTACKS.coil.windup + 5).points;
    expect(pose[0]![1]).toBeGreaterThan(7.3);
    expect(pose[0]![1]).toBeLessThan(8);
    for (let i = COIL.neck; i < 41; i += 1) {
      expect(Math.hypot(pose[i]![0], pose[i]![2]) + radius(i)).toBeLessThan(3.6);
      expect(pose[i]![1] - radius(i)).toBeLessThan(0.2);
    }
    const zone = attackZone(att);
    for (const [d, hit] of [[0, false], [3.6, false], [4.74, false], [4.75, true], [6.99, true], [7.01, false]] as const) {
      for (const a of [0, 1.3, 2.6, 4.2]) expect(zoneHits(zone, Math.sin(a) * d, Math.cos(a) * d, 0.35), `${d} m`).toBe(hit);
    }
    const brain = createBrain({ phase2: true, hp: 400 });
    let hitEvents = 0;
    for (let s = 0; s < 3000; s += 1) for (const e of brain.step(NEZ(0, 3))) if (e.type === 'hit' && e.kind === 'coil') hitEvents += 1;
    expect(hitEvents).toBeGreaterThan(0);
  });
  it('keeps the coil 720 steps apart', () => {
    const brain = createBrain({ phase2: true, hp: 400 });
    const coils: number[] = [];
    for (let s = 1; s <= 8000; s += 1) for (const e of brain.step(NEZ(5 * Math.sin(s / 300), 5 * Math.cos(s / 300)))) if (e.type === 'hit' && e.kind === 'coil') coils.push(s);
    expect(coils.length).toBeGreaterThan(1);
    for (let i = 1; i < coils.length; i += 1) expect(coils[i]! - coils[i - 1]!).toBeGreaterThan(BRAIN.coilCooldown);
  });
  it('phase 2 charges twice: the second telegraph starts 24 steps after the first hit; one 48-step opening at the end', () => {
    const brain = createBrain({ phase2: true, hp: 400 });
    const tele: { s: number; second: boolean; kind: string }[] = [];
    const hits: { s: number; kind: string }[] = [];
    let ends = 0;
    for (let s = 1; s <= 12000; s += 1) {
      const far = { x: 13 * Math.sin(s / 900), z: 13 * Math.cos(s / 900) };
      for (const e of brain.step({ nezha: far, engaged: true })) {
        if (e.type === 'telegraph') tele.push({ s, second: e.second, kind: e.kind });
        if (e.type === 'hit') hits.push({ s, kind: e.kind });
        if (e.type === 'opening-end') ends += 1;
      }
    }
    const seconds = tele.filter((t) => t.second);
    expect(seconds.length).toBeGreaterThan(0);
    for (const t of seconds) {
      const firstHit = hits.filter((h) => h.kind === 'charge' && h.s < t.s).at(-1)!;
      expect(t.s - firstHit.s).toBe(BRAIN.chargeTurn + 1);
    }
    expect(brain.snapshot().openingSteps).toBe(BRAIN.opening2);
    expect(ends).toBeGreaterThan(0);
  });
  it('intro: lurks behind the wall, orbits at 29 m, breaks through and rests 8 m in front of the checkpoint at 2.2 m', () => {
    const brain = createBrain({ start: 'lurk' });
    expect(brain.vulnerable()).toBe(false);
    for (let s = 0; s < 100; s += 1) expect(brain.step(NEZ(0, 16.5)).length).toBe(0);
    expect(Math.hypot(brain.points()[0]![0], brain.points()[0]![2])).toBeGreaterThan(ARENA.wallRadius);
    brain.beginIntro();
    let breach = 0, end = 0;
    for (let s = 1; s <= INTRO.end && !end; s += 1) {
      for (const e of brain.step(NEZ(0, 16.5))) {
        if (e.type === 'breach') breach = s;
        if (e.type === 'intro-end') end = s;
      }
      if (s <= INTRO.sealEnd) expect(Math.hypot(brain.points()[0]![0], brain.points()[0]![2])).toBeGreaterThan(ARENA.wallRadius);
    }
    expect(breach).toBeGreaterThan(INTRO.sealEnd);
    expect(breach).toBeLessThan(INTRO.breachEnd);
    expect(end).toBe(INTRO.end);
    expect(introHead(INTRO.breachEnd)).toEqual(INTRO.headRest);
    // The tail lies across the canyon mouth when the seal ends.
    const sealed = createBrain({ start: 'lurk' });
    sealed.beginIntro();
    sealed.skipIntroTo(INTRO.sealEnd);
    expect(sealed.points().some((p) => Math.abs(p[0]) < 1.5 && p[2] > ARENA.wallRadius)).toBe(true);
  });
});
