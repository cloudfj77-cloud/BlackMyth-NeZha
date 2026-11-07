/**
 * Dragon King AI (pure, step-driven at 60 steps/s of the dragon's own clock; tested).
 * Swims at height in the band and over the vortex, attacks only inside the vortex, gives an
 * opening after every attack. Rules: design/milestones/M3-dragon.md §4–6 and M4-one-run.md §1–5
 * (intro script, phase change at 50 %, phase 2: Coiled Tide Roar, double charge).
 */
import { ARENA, CHECKPOINT } from '../shared/layout.ts';
import {
  angleOf,
  ATTACKS,
  attackFrame,
  attackZone,
  CHARGE_MIN,
  chargeLength,
  clone,
  createAttack,
  dirOf,
  followChain,
  lerp,
  OPENING,
  POINTS,
  radius,
  smooth,
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
  type V2,
  type Zone,
} from './body.ts';

/** Nezha off the vortex: nothing to arch over. */
const FAR: V2 = { x: 1e6, z: 1e6 };

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
  /** Passing over Nezha: underside ≥ 3.5 m; parts arch up at ≤ 10 m/s, fully within r + 1 m, easing from r + 4 m. */
  overheadClear: 3.5,
  archSpeed: 10,
  archNear: 1,
  archFar: 4,
  // --- M4 phase 2 ---------------------------------------------------------------------
  /** Swim speed in phase 2 (+20 %); telegraphs keep their length. */
  speed2: 4.8,
  /** Opening in phase 2 (0.8 s, includes the 12-step recovery). */
  opening2: 48,
  roarSteps: 120,
  /** Phase change: first time this session 570 steps (lines), later 240 (no lines). */
  transitionFirst: 570,
  transitionRepeat: 240,
  /** Last steps of the phase change: back onto the vortex toward Nezha. */
  returnSteps: 90,
  /** After the phase change the coil must start within this many steps. */
  coilWindow: 30,
  coilMin: 4,
  coilMax: 12,
  coilCooldown: 720,
  /** Double charge: turn-round between the two charges. */
  chargeTurn: 24,
  chargeTurnDegPerSec: 540,
});

/** The intro script (M4 §1), in steps from Nezha entering the arena. */
export const INTRO = Object.freeze({
  flyIn: 60,
  orbitEnd: 300,
  sealEnd: 330,
  breachEnd: 390,
  turnFrom: 648,
  turnTo: 688,
  end: 852,
  /** The long shadow orbits just behind the water wall, high up where the wall thins (M4 §1). */
  orbitRadius: 27.2,
  orbitY: 8,
  orbitFrom: 1.77,
  orbitTo: 2 * Math.PI + 0.62,
  /** Where the head comes to rest: 8 m in front of the checkpoint, 2.2 m up. */
  headRest: [0, 2.2, CHECKPOINT[2] - 8] as P3,
  /** The head swings in from the right and arrives facing Nezha (+Z). */
  breachControl: [0, 3.5, 2] as P3,
});

export type Mode = 'lurk' | 'intro' | 'swim' | 'attack' | 'turn' | 'roar' | 'dead';

export type DragonEvent =
  | { readonly type: 'telegraph'; readonly kind: AttackKind; readonly zone: Zone; readonly hitStep: number; readonly forced: boolean; readonly second: boolean }
  | { readonly type: 'hit'; readonly kind: AttackKind; readonly zone: Zone; readonly damage: number; readonly knock?: { readonly dir: V2; readonly distance: number } }
  | { readonly type: 'opening-end' }
  | { readonly type: 'phase'; readonly steps: number }
  | { readonly type: 'transition-end' }
  | { readonly type: 'breach'; readonly at: V2 }
  | { readonly type: 'intro-end' }
  | { readonly type: 'dead' }
  | { readonly type: 'dead-done' };

export interface BrainInput {
  readonly nezha: V2;
  /** Nezha is on the vortex (the fight is on). */
  readonly engaged: boolean;
}

export interface BrainOptions {
  readonly hpMax?: number;
  readonly minGap?: number;
  /** 'fight' (default): swimming in the band, ready to fight. 'lurk': waiting behind the wall for the intro. */
  readonly start?: 'fight' | 'lurk';
  /** Start in phase 2 (labs). */
  readonly phase2?: boolean;
  readonly hp?: number;
  /** The phase-change lines were already played this session (240-step change). */
  readonly transitionSeen?: boolean;
}

export type DamageResult = 'ignored' | 'hurt' | 'phase' | 'dead';

/** Head path of the intro (no wave), k in steps; constant after the breach. */
export function introHead(k: number): P3 {
  const I = INTRO;
  if (k <= I.flyIn) {
    const d = dirOf(I.orbitFrom);
    return [d.x * I.orbitRadius, I.orbitY, d.z * I.orbitRadius];
  }
  if (k <= I.sealEnd) {
    const a = lerp(I.orbitFrom, I.orbitTo, (k - I.flyIn) / (I.sealEnd - I.flyIn));
    const d = dirOf(a);
    return [d.x * I.orbitRadius, I.orbitY, d.z * I.orbitRadius];
  }
  const t = Math.min(1, (k - I.sealEnd) / (I.breachEnd - I.sealEnd));
  const d = dirOf(I.orbitTo);
  const e: P3 = [d.x * I.orbitRadius, I.orbitY, d.z * I.orbitRadius];
  const c = I.breachControl, r = I.headRest;
  const u = 1 - t;
  // Quadratic curve round Nezha's right side; height eases down (no overshoot).
  return [u * u * e[0] + 2 * u * t * c[0] + t * t * r[0], lerp(I.orbitY, r[1], smooth(t)), u * u * e[2] + 2 * u * t * c[2] + t * t * r[2]];
}

export function createBrain(options: BrainOptions = {}) {
  const hpMax = options.hpMax ?? BRAIN.hpMax;
  const minGap = options.minGap ?? BRAIN.minGap;
  const lurking = options.start === 'lurk';
  const startHead: V2 = { x: -ARENA.bandPatrolRadius, z: 0 };
  const startDir: V2 = { x: 0, z: -1 };
  let chain: P3[] = straightBody(startHead, startDir);
  let heading: V2 = startDir;
  let phase = 0;
  let amp = 1;
  let mode: Mode = lurking ? 'lurk' : 'swim';
  let since = 0;
  let step = 0;
  let hp: number = options.hp ?? hpMax;
  let phase2 = options.phase2 === true;
  let transitionSeen = options.transitionSeen === true;
  let transitionLen = 0;
  let roarK = 0;
  let patrolDir = 1;
  let intent: { kind: AttackKind; age: number } | undefined;
  let lastKind: AttackKind | undefined;
  let repeat = 0;
  let attack: (Attack & { k: number; zone: Zone | null; forced: boolean; second: boolean }) | undefined;
  let deathK = 0;
  let deathFrom: P3[] = [];
  let lastOpeningEnd = 0;
  let coilCd = 0;
  let coilPending = false;
  let coilWait = 0;
  let turnK = 0;
  let introK = 0;
  let breached = false;
  const log: { step: number; kind: AttackKind; forced: boolean; sinceOpening: number; distance: number; aligned: number; phase: 1 | 2; second: boolean; afterChange: boolean }[] = [];

  const head = (): V2 => ({ x: chain[0]![0], z: chain[0]![2] });
  const allowed = (kind: AttackKind) => !(lastKind === kind && repeat >= BRAIN.maxRepeat);
  const opening = () => (phase2 ? BRAIN.opening2 : OPENING);
  const speed = () => (phase2 ? BRAIN.speed2 : BRAIN.speed);

  /** The lurk / intro body: the trail of the scripted head path up to step k. */
  const introChain = (k: number): P3[] => {
    // Lying along the orbit behind the head (it swims counter-clockwise).
    const pts: P3[] = Array.from({ length: POINTS }, (_, i): P3 => {
      const a = INTRO.orbitFrom - (0.45 * i) / INTRO.orbitRadius;
      const q = dirOf(a);
      return [q.x * INTRO.orbitRadius, INTRO.orbitY, q.z * INTRO.orbitRadius];
    });
    for (let s = 1; s <= Math.min(k, INTRO.breachEnd); s += 1) followChain(pts, introHead(s));
    return pts;
  };
  if (lurking) chain = introChain(0);

  const startAttack = (kind: AttackKind, nezha: V2, forced: boolean, events: DragonEvent[], second = false) => {
    const a = createAttack(kind, chain, phase, amp, nezha);
    const zone = attackZone(a);
    const h = head();
    log.push({ step, kind, forced, sinceOpening: since, distance: Math.hypot(nezha.x - h.x, nezha.z - h.z), aligned: alignment(nezha), phase: phase2 ? 2 : 1, second, afterChange: kind === 'coil' && coilPending });
    while (log.length > 40) log.shift();
    attack = { ...a, k: 0, zone, forced, second };
    mode = 'attack';
    intent = undefined;
    coilPending = false;
    repeat = lastKind === kind ? repeat + 1 : 1;
    lastKind = kind;
    events.push({ type: 'telegraph', kind, zone, hitStep: ATTACKS[kind].hit, forced, second });
  };

  /** Degrees between the head direction and the direction to Nezha. */
  const alignment = (nezha: V2) => {
    const h = head();
    const want = angleOf(nezha.x - h.x, nezha.z - h.z);
    return Math.abs((wrap(want - angleOf(heading.x, heading.z)) * 180) / Math.PI);
  };

  const steerTo = (tx: number, tz: number, degPerSec: number = BRAIN.turnDegPerSec) => {
    const h = head();
    const want = angleOf(tx - h.x, tz - h.z);
    const cur = angleOf(heading.x, heading.z);
    const max = (degPerSec * Math.PI * STEP) / 180;
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

  const swimStep = (nezha: V2, v: number = speed(), keepY = false) => {
    const h = head();
    let nx = h.x + heading.x * v * STEP;
    let nz = h.z + heading.z * v * STEP;
    const r = Math.hypot(nx, nz);
    if (r > ARENA.bandMaxHead) {
      nx *= ARENA.bandMaxHead / r;
      nz *= ARENA.bandMaxHead / r;
    }
    // The whole body floats back up to swim height (≈ 1.2 s from the floor), not just the head.
    if (!keepY) {
      const rise = 3.2 * STEP;
      for (const p of chain) p[1] += Math.max(-rise, Math.min(rise, SWIM_Y - p[1]));
    }
    followChain(chain, [nx, chain[0]![1], nz]);
    // Passing over Nezha (M3 §4): any part heading over her arches up early so its underside clears
    // 3.5 m. Full lift within r + 1 m (covers the 0.6 m lateral wave), easing out by r + 4 m.
    const archRate = BRAIN.archSpeed * STEP;
    for (let i = 0; i < POINTS; i += 1) {
      const p = chain[i]!;
      const d = Math.hypot(p[0] - nezha.x, p[2] - nezha.z) - radius(i);
      if (d >= BRAIN.archFar) continue;
      const t = Math.min(1, Math.max(0, (BRAIN.archFar - d) / (BRAIN.archFar - BRAIN.archNear)));
      const want = (BRAIN.overheadClear + radius(i) + 0.1) * (t * t * (3 - 2 * t)) + p[1] * (1 - t * t * (3 - 2 * t));
      if (want > p[1]) p[1] += Math.min(archRate, want - p[1]);
    }
    phase += 2 * Math.PI * WAVE_HZ * STEP;
    amp = Math.min(1, amp + 1 / 30);
  };

  /** Leave an attack / turn: the swim chain resumes from the pose the body is in. */
  const settle = () => {
    if (mode === 'attack' && attack) {
      const f = attackFrame(attack, attack.k);
      chain = clone(f.raw);
      phase = f.phase;
      amp = f.amp;
    }
    const dx = chain[0]![0] - chain[1]![0], dz = chain[0]![2] - chain[1]![2];
    const n = Math.hypot(dx, dz) || 1;
    heading = { x: dx / n, z: dz / n };
    attack = undefined;
    intent = undefined;
  };

  /** Points of the current pose before the head lift of the roar. */
  const basePoints = (): P3[] => {
    if (mode === 'attack' && attack) return attackFrame(attack, attack.k).points;
    if (mode === 'dead') {
      // Falls (M4 §8): 0–60 rears back, head up to 4 m; 60–150 lies down on the vortex.
      const up = smooth(deathK / 60);
      const down = smooth((deathK - 60) / 90);
      return deathFrom.map((p, i): P3 => {
        const lift = i < 8 ? (4 - p[1]) * (1 - i / 8) * up : 0;
        const y = p[1] + lift;
        return [p[0], lerp(y, radius(i) + 0.05, down), p[2]];
      });
    }
    return withWave(chain, phase, amp);
  };

  return {
    step(input: BrainInput): DragonEvent[] {
      const events: DragonEvent[] = [];
      step += 1;
      if (mode === 'lurk') {
        phase += 2 * Math.PI * WAVE_HZ * STEP;
        return events;
      }
      if (mode === 'intro') {
        introK += 1;
        phase += 2 * Math.PI * WAVE_HZ * STEP;
        if (introK <= INTRO.breachEnd) followChain(chain, introHead(introK));
        if (!breached && introK > INTRO.sealEnd && Math.hypot(chain[0]![0], chain[0]![2]) <= ARENA.wallRadius) {
          breached = true;
          events.push({ type: 'breach', at: head() });
        }
        if (introK >= INTRO.end) {
          mode = 'swim';
          since = 0;
          settle();
          events.push({ type: 'intro-end' });
        }
        return events;
      }
      if (mode === 'dead') {
        deathK += 1;
        if (deathK === BRAIN.deathSteps) events.push({ type: 'dead-done' });
        return events;
      }
      if (coilCd > 0) coilCd -= 1;
      if (mode === 'roar') {
        // Phase change (M4 §2): roar, then a fast lap of the band, then back onto the vortex.
        roarK += 1;
        const nz = input.nezha;
        if (roarK < transitionLen - BRAIN.returnSteps) {
          const t = patrolTarget();
          steerTo(t.x, t.z);
          swimStep(FAR, roarK < BRAIN.roarSteps ? 2 : BRAIN.speed2);
        } else {
          const h = head();
          const dx = h.x - nz.x, dz = h.z - nz.z, n = Math.hypot(dx, dz) || 1;
          steerTo(nz.x + (dx / n) * 8, nz.z + (dz / n) * 8, 180);
          swimStep(nz, BRAIN.speed2);
        }
        if (roarK >= transitionLen) {
          mode = 'swim';
          phase2 = true;
          transitionSeen = true;
          since = 0;
          coilPending = true;
          coilWait = 0;
          events.push({ type: 'transition-end' });
        }
        return events;
      }
      if (mode === 'turn') {
        // Double charge (M4 §5): brake and swing the head round toward Nezha, then charge again.
        turnK += 1;
        steerTo(input.nezha.x, input.nezha.z, BRAIN.chargeTurnDegPerSec);
        swimStep(FAR, turnK <= 6 ? BRAIN.speed2 * (1 - turnK / 6) : BRAIN.speed2, true);
        if (turnK >= BRAIN.chargeTurn) {
          const h = head();
          const dir = { x: input.nezha.x - h.x, z: input.nezha.z - h.z };
          const n = Math.hypot(dir.x, dir.z) || 1;
          if (chargeLength(h, { x: dir.x / n, z: dir.z / n }) >= CHARGE_MIN) startAttack('charge', input.nezha, false, events, true);
          else {
            // No room for the second charge: rest where the turn ended and give the opening.
            const a = createAttack('charge', chain, phase, amp, input.nezha);
            attack = { ...a, rest: clone(chain), k: ATTACKS.charge.hit, zone: null, forced: false, second: true };
            mode = 'attack';
          }
        }
        return events;
      }
      if (mode === 'attack' && attack) {
        attack.k += 1;
        const A = ATTACKS[attack.kind];
        if (attack.k === A.hit && attack.zone) {
          const pivot = attack.kind === 'lash' ? attack.pivot : attack.origin;
          const knockDir = { x: input.nezha.x - pivot.x, z: input.nezha.z - pivot.z };
          const n = Math.hypot(knockDir.x, knockDir.z) || 1;
          events.push({
            type: 'hit',
            kind: attack.kind,
            zone: attack.zone,
            damage: A.damage,
            ...(A.knock > 0 ? { knock: { dir: { x: knockDir.x / n, z: knockDir.z / n }, distance: A.knock } } : {}),
          });
          if (attack.kind === 'coil') coilCd = BRAIN.coilCooldown;
        }
        if (phase2 && attack.kind === 'charge' && !attack.second && attack.k === A.hit + 1) {
          // The first charge of the pair gives no opening: it turns round for the second one.
          const f = attackFrame(attack, A.hit);
          chain = clone(f.raw);
          phase = f.phase;
          amp = f.amp;
          heading = attack.dir;
          attack = undefined;
          mode = 'turn';
          turnK = 0;
          return events;
        }
        if (attack.k >= A.hit + opening()) {
          settle();
          mode = 'swim';
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
        if (coilPending) {
          // Right after the phase change the first attack is the coil (within 30 steps).
          coilWait += 1;
          if ((dN >= BRAIN.coilMin && dN <= BRAIN.coilMax) || coilWait >= BRAIN.coilWindow) {
            startAttack('coil', nz, coilWait >= BRAIN.coilWindow, events);
            return events;
          }
          steerTo(nz.x, nz.z, 180);
          swimStep(nz);
          return events;
        }
        if (since >= BRAIN.maxGap) {
          // Forced: never more than 3 s without a threat (charge if far and there is room).
          const dir = { x: (nz.x - h.x) / (dN || 1), z: (nz.z - h.z) / (dN || 1) };
          const canCharge = chargeLength(h, dir) >= CHARGE_MIN;
          let kind: AttackKind = dN > BRAIN.biteRange && canCharge ? 'charge' : 'bite';
          // Forced attacks keep the "same attack ≤ 2 in a row" rule too.
          if (!allowed(kind)) kind = kind === 'charge' ? 'bite' : canCharge ? 'charge' : 'lash';
          startAttack(kind, nz, true, events);
          return events;
        }
        if (since >= minGap && inVortex && dN <= BRAIN.attackRange) {
          // Priority: tail lash > (phase 2) coil > bite > charge.
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
          if (phase2 && coilCd === 0 && allowed('coil') && dN >= BRAIN.coilMin && dN <= BRAIN.coilMax) {
            startAttack('coil', nz, false, events);
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
        // Nezha off the vortex: the gap clock waits (the first threat comes 0–2 s after she enters).
        since = Math.min(since, minGap);
        const t = patrolTarget();
        steerTo(t.x, t.z);
      }
      swimStep(input.engaged ? input.nezha : FAR);
      return events;
    },
    /** Rendered / hurt / lock points (with the travelling wave, and the head lifted while roaring). */
    points(): P3[] {
      const pts = basePoints();
      if (mode === 'roar' && roarK < BRAIN.roarSteps) {
        const lift = 2.0 * (roarK < 12 ? smooth(roarK / 12) : roarK > 108 ? 1 - smooth((roarK - 108) / 12) : 1);
        for (let i = 0; i < 8; i += 1) pts[i]![1] += lift * (1 - i / 8);
      }
      return pts;
    },
    /** Start the intro (from the lurk); `transitionSeen` carries the session's played-lines flag. */
    beginIntro() {
      if (mode !== 'lurk') return;
      mode = 'intro';
      introK = 0;
      breached = false;
      chain = introChain(0);
    },
    /** Jump the intro forward (skip): the body takes the trail it would have had. */
    skipIntroTo(k: number) {
      if (mode !== 'intro' || k <= introK) return;
      introK = Math.min(k, INTRO.end - 1);
      chain = introChain(introK);
      if (introK > INTRO.sealEnd) breached = true;
    },
    /**
     * A landed hit. Phase 1 stops at half health and starts the phase change (the attack in progress
     * is cancelled, its hit never settles). No damage while lurking, in the intro, roaring or dead.
     */
    damage(amount: number): DamageResult {
      if (mode === 'dead' || mode === 'roar' || mode === 'lurk' || mode === 'intro') return 'ignored';
      const half = Math.ceil(hpMax / 2);
      if (!phase2 && hp - amount <= half) {
        hp = half;
        settle();
        mode = 'roar';
        roarK = 0;
        transitionLen = transitionSeen ? BRAIN.transitionRepeat : BRAIN.transitionFirst;
        coilPending = false;
        return 'phase';
      }
      hp = Math.max(0, hp - amount);
      if (hp === 0) {
        deathFrom = basePoints();
        mode = 'dead';
        deathK = 0;
        attack = undefined;
        return 'dead';
      }
      return 'hurt';
    },
    /** Defeat (M4 §7): the attack in progress is dropped and the dragon swims off (no new attack while not engaged). */
    abort() {
      if (mode === 'attack' || mode === 'turn') {
        settle();
        mode = 'swim';
        since = 0;
      }
    },
    /** Can Nezha's strikes land now? */
    vulnerable(): boolean {
      return mode === 'swim' || mode === 'attack' || mode === 'turn';
    },
    snapshot() {
      const A = attack ? ATTACKS[attack.kind] : undefined;
      return {
        step,
        mode,
        hp,
        hpMax,
        phase: (phase2 ? 2 : 1) as 1 | 2,
        since,
        lastOpeningEnd,
        kind: attack?.kind ?? null,
        k: attack?.k ?? null,
        forced: attack?.forced ?? false,
        second: attack?.second ?? false,
        opening: mode === 'attack' && !!attack && !!A && attack.k > A.hit,
        telegraph: mode === 'attack' && !!attack && !!A && !!attack.zone && attack.k <= A.hit,
        zone: attack?.zone ?? null,
        hitStep: A ? A.hit : null,
        openingSteps: opening(),
        intent: intent?.kind ?? null,
        repeat,
        lastKind: lastKind ?? null,
        deathK,
        amp,
        heading,
        roarK: mode === 'roar' ? roarK : null,
        transitionLen,
        transitionSeen,
        coilCd,
        coilPending,
        introK: mode === 'intro' ? introK : null,
        log,
      };
    },
  };
}

export type Brain = ReturnType<typeof createBrain>;
