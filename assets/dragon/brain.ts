/**
 * Dragon King AI (pure, step-driven at 60 steps/s of the dragon's own clock; tested).
 * Swims at height in the band and over the vortex, attacks only inside the vortex, gives a
 * 1.2 s opening after every attack. Rules: design/milestones/M3-dragon.md §4–6.
 */
import { ARENA } from '../shared/layout.ts';
import {
  angleOf,
  ATTACKS,
  attackFrame,
  CHARGE_MIN,
  chargeLength,
  clone,
  createAttack,
  damagingDiscs,
  discHull,
  dirOf,
  followChain,
  OPENING,
  POINTS,
  radius,
  STEP,
  straightBody,
  SWIM_Y,
  WAIST,
  WAVE_HZ,
  withWave,
  wrap,
  type Attack,
  type AttackKind,
  type P3,
  type Polygon,
  type V2,
} from './body.ts';

export const BRAIN = Object.freeze({
  hpMax: 800,
  speed: 4,
  turnDegPerSec: 90,
  /** Steps after an opening before a new attack may start / the dragon turns back in / it must attack. */
  minGap: 60,
  returnAt: 90,
  maxGap: 180,
  maxRepeat: 2,
  alignDeg: 30,
  /** An intended bite / charge is dropped when the head cannot face Nezha within this many steps. */
  intentTimeout: 60,
  /** Regular attacks start only with the head inside the vortex and within this distance of Nezha. */
  attackRange: 16,
  biteRange: 8,
  chargeMinDistance: 12,
  lashRange: 7,
  deathSteps: 180,
  deathEyesClose: 150,
});

export type Mode = 'swim' | 'attack' | 'dead';

export type DragonEvent =
  | { readonly type: 'telegraph'; readonly kind: AttackKind; readonly polygon: Polygon; readonly hitStep: number; readonly forced: boolean }
  | { readonly type: 'hit'; readonly kind: AttackKind; readonly polygon: Polygon; readonly damage: number; readonly knock?: { readonly dir: V2; readonly distance: number } }
  | { readonly type: 'opening-end' }
  | { readonly type: 'dead' }
  | { readonly type: 'dead-done' };

export interface BrainInput {
  readonly nezha: V2;
  /** Nezha is on the vortex (the fight is on). */
  readonly engaged: boolean;
}

export function createBrain(start?: { readonly head: V2; readonly dir: V2 }) {
  const startHead = start?.head ?? { x: -ARENA.bandPatrolRadius, z: 0 };
  const startDir = start?.dir ?? { x: 0, z: -1 };
  let chain: P3[] = straightBody(startHead, startDir);
  let heading: V2 = startDir;
  let phase = 0;
  let amp = 1;
  let mode: Mode = 'swim';
  let since = 0;
  let step = 0;
  let hp: number = BRAIN.hpMax;
  let patrolDir = 1;
  let intent: { kind: AttackKind; age: number } | undefined;
  let lastKind: AttackKind | undefined;
  let repeat = 0;
  let attack: (Attack & { k: number; polygon: Polygon; forced: boolean }) | undefined;
  let deathK = 0;
  let deathFrom: P3[] = [];
  let lastOpeningEnd = 0;
  const log: { step: number; kind: AttackKind; forced: boolean; sinceOpening: number; distance: number; aligned: number }[] = [];

  const head = (): V2 => ({ x: chain[0]![0], z: chain[0]![2] });
  const allowed = (kind: AttackKind) => !(lastKind === kind && repeat >= BRAIN.maxRepeat);

  const startAttack = (kind: AttackKind, nezha: V2, forced: boolean, events: DragonEvent[]) => {
    const a = createAttack(kind, chain, phase, amp, nezha);
    const polygon = discHull(damagingDiscs(a));
    const h = head();
    log.push({ step, kind, forced, sinceOpening: since, distance: Math.hypot(nezha.x - h.x, nezha.z - h.z), aligned: alignment(nezha) });
    while (log.length > 40) log.shift();
    attack = { ...a, k: 0, polygon, forced };
    mode = 'attack';
    intent = undefined;
    repeat = lastKind === kind ? repeat + 1 : 1;
    lastKind = kind;
    events.push({ type: 'telegraph', kind, polygon, hitStep: ATTACKS[kind].hit, forced });
  };

  /** Degrees between the head direction and the direction to Nezha. */
  const alignment = (nezha: V2) => {
    const h = head();
    const want = angleOf(nezha.x - h.x, nezha.z - h.z);
    return Math.abs((wrap(want - angleOf(heading.x, heading.z)) * 180) / Math.PI);
  };

  const steerTo = (tx: number, tz: number) => {
    const h = head();
    const want = angleOf(tx - h.x, tz - h.z);
    const cur = angleOf(heading.x, heading.z);
    const max = (BRAIN.turnDegPerSec * Math.PI * STEP) / 180;
    const next = cur + Math.max(-max, Math.min(max, wrap(want - cur)));
    heading = dirOf(next);
  };

  const patrolTarget = (): V2 => {
    const h = head();
    const a = angleOf(h.x, h.z);
    const forbid = (ARENA.bandForbiddenHalfAngleDeg * Math.PI) / 180;
    let next = a + patrolDir * 0.6;
    if (Math.abs(wrap(next)) < forbid || Math.abs(wrap(a)) < forbid) {
      patrolDir = -patrolDir;
      next = a + patrolDir * 0.6;
    }
    const d = dirOf(next);
    return { x: d.x * ARENA.bandPatrolRadius, z: d.z * ARENA.bandPatrolRadius };
  };

  const swimStep = () => {
    const h = head();
    let nx = h.x + heading.x * BRAIN.speed * STEP;
    let nz = h.z + heading.z * BRAIN.speed * STEP;
    const r = Math.hypot(nx, nz);
    if (r > ARENA.bandMaxHead) {
      nx *= ARENA.bandMaxHead / r;
      nz *= ARENA.bandMaxHead / r;
    }
    // The whole body floats back up to swim height (≈ 1.2 s from the floor), not just the head.
    const rise = 3.2 * STEP;
    for (const p of chain) p[1] += Math.max(-rise, Math.min(rise, SWIM_Y - p[1]));
    followChain(chain, [nx, chain[0]![1], nz]);
    phase += 2 * Math.PI * WAVE_HZ * STEP;
    amp = Math.min(1, amp + 1 / 30);
  };

  return {
    step(input: BrainInput): DragonEvent[] {
      const events: DragonEvent[] = [];
      step += 1;
      if (mode === 'dead') {
        deathK += 1;
        if (deathK === BRAIN.deathSteps) events.push({ type: 'dead-done' });
        return events;
      }
      if (mode === 'attack' && attack) {
        attack.k += 1;
        const A = ATTACKS[attack.kind];
        if (attack.k === A.hit) {
          const pivot = attack.kind === 'lash' ? attack.pivot : attack.origin;
          const knockDir = { x: input.nezha.x - pivot.x, z: input.nezha.z - pivot.z };
          const n = Math.hypot(knockDir.x, knockDir.z) || 1;
          events.push({
            type: 'hit',
            kind: attack.kind,
            polygon: attack.polygon,
            damage: A.damage,
            ...(A.knock > 0 ? { knock: { dir: { x: knockDir.x / n, z: knockDir.z / n }, distance: A.knock } } : {}),
          });
        }
        if (attack.k >= A.hit + OPENING) {
          // Back to swimming from the opening pose: the trail starts where the body lies.
          const f = attackFrame(attack, attack.k);
          chain = clone(f.raw);
          phase = f.phase;
          amp = f.amp;
          const dx = chain[0]![0] - chain[1]![0], dz = chain[0]![2] - chain[1]![2];
          const n = Math.hypot(dx, dz) || 1;
          heading = { x: dx / n, z: dz / n };
          mode = 'swim';
          attack = undefined;
          since = 0;
          lastOpeningEnd = step;
          events.push({ type: 'opening-end' });
        }
        return events;
      }

      // --- Swimming -----------------------------------------------------------------------
      since += 1;
      const h = head();
      const nz = input.nezha;
      const dN = Math.hypot(nz.x - h.x, nz.z - h.z);
      const inVortex = Math.hypot(h.x, h.z) <= ARENA.radius;
      if (input.engaged) {
        if (since >= BRAIN.maxGap) {
          // Forced: never more than 3 s without a threat (charge if far and there is room).
          const dir = { x: (nz.x - h.x) / (dN || 1), z: (nz.z - h.z) / (dN || 1) };
          const kind: AttackKind = dN > BRAIN.biteRange && chargeLength(h, dir) >= CHARGE_MIN ? 'charge' : 'bite';
          startAttack(kind, nz, true, events);
          return events;
        }
        if (since >= BRAIN.minGap && inVortex && dN <= BRAIN.attackRange) {
          // Priority: tail lash > bite > charge.
          let rear = Infinity, nearestIndex = 0, nearest = Infinity;
          for (let i = 0; i < POINTS; i += 1) {
            const p = chain[i]!;
            const d = Math.hypot(p[0] - nz.x, p[2] - nz.z);
            if (i >= WAIST - 5) rear = Math.min(rear, d);
            if (d < nearest) {
              nearest = d;
              nearestIndex = i;
            }
          }
          const wantLash = allowed('lash') && rear <= BRAIN.lashRange && nearestIndex >= WAIST - 5;
          if (wantLash) {
            startAttack('lash', nz, false, events);
            return events;
          }
          const dir = { x: (nz.x - h.x) / (dN || 1), z: (nz.z - h.z) / (dN || 1) };
          const candidate: AttackKind | undefined =
            allowed('bite') && dN <= BRAIN.biteRange ? 'bite'
            : allowed('charge') && dN > BRAIN.chargeMinDistance && chargeLength(h, dir) >= CHARGE_MIN ? 'charge'
            : undefined;
          if (candidate && (!intent || intent.kind !== candidate)) intent = { kind: candidate, age: 0 };
          if (!candidate) intent = undefined;
        }
        if (intent) {
          intent.age += 1;
          if (alignment(nz) <= BRAIN.alignDeg) {
            startAttack(intent.kind, nz, false, events);
            return events;
          }
          if (intent.age > BRAIN.intentTimeout) intent = undefined;
        }
        if (since < BRAIN.returnAt && !intent) {
          const t = patrolTarget();
          steerTo(t.x, t.z);
        } else steerTo(nz.x, nz.z);
      } else {
        const t = patrolTarget();
        steerTo(t.x, t.z);
      }
      swimStep();
      return events;
    },
    /** Rendered / hurt / lock points (with the travelling wave). */
    points(): P3[] {
      if (mode === 'attack' && attack) return attackFrame(attack, attack.k).points;
      if (mode === 'dead') {
        // Falls: the body sinks onto the vortex over 120 steps and lies still.
        const t = Math.min(1, deathK / 120);
        const e = t * t * (3 - 2 * t);
        return deathFrom.map((p, i): P3 => [p[0], p[1] + (radius(i) + 0.05 - p[1]) * e, p[2]]);
      }
      return withWave(chain, phase, amp);
    },
    damage(amount: number): boolean {
      if (mode === 'dead') return false;
      hp = Math.max(0, hp - amount);
      if (hp === 0) {
        deathFrom = this.points();
        mode = 'dead';
        deathK = 0;
        attack = undefined;
        return true;
      }
      return false;
    },
    snapshot() {
      return {
        step,
        mode,
        hp,
        since,
        lastOpeningEnd,
        kind: attack?.kind ?? null,
        k: attack?.k ?? null,
        forced: attack?.forced ?? false,
        opening: mode === 'attack' && !!attack && attack.k > ATTACKS[attack.kind].hit,
        telegraph: mode === 'attack' && !!attack && attack.k <= ATTACKS[attack.kind].hit,
        polygon: attack?.polygon ?? null,
        hitStep: attack ? ATTACKS[attack.kind].hit : null,
        intent: intent?.kind ?? null,
        repeat,
        lastKind: lastKind ?? null,
        deathK,
        amp,
        heading,
        log,
      };
    },
  };
}

export type Brain = ReturnType<typeof createBrain>;
