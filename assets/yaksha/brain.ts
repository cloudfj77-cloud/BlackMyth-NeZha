/**
 * 巡海夜叉 (v1.4.0 `Mobs`, ported to fixed 60 Hz steps and the 0.86 level scale). Pure logic, no engine.
 *
 *   patrol (breathing) → alert (roar, 0.7 s) → approach (keep 2.1–3.6 m, circle) →
 *   attack (0.75 s wind-up with a red fan on the ground → 0.18 s lunge-stab → 0.7 s recovery, punishable)
 *   → hurt (stagger + knock-back) → dead (topples, shrinks away)
 *
 * Group rule — the attack token: at most one yaksha strikes at a time; the others circle further out,
 * so Nezha is never hit from two sides in the same instant.
 *
 * Numbers: v1.4.0 distances × 0.86; damage and health rescaled to our tables (v1.4.0 light hit 28 → ours 8,
 * so its 150 HP → 45; its 24-damage stab against a boss smash of 42 → ours 10 against the dragon's ~20).
 */
import { LEVEL_SCALE as S } from '../shared/sea-layout.ts';

export const YAKSHA = Object.freeze({
  hp: 45,
  radius: 0.55 * S,
  alertRange: 13 * S,
  /** Distance kept while holding the token / while waiting for it. */
  wantNear: 2.4 * S,
  wantFar: 4.2 * S,
  speedFar: 4.2 * S,
  speedNear: 3.0 * S,
  backOff: 2.0 * S,
  orbit: 1.6 * S,
  separation: 1.6 * S,
  /** Takes the token and attacks within this distance once its cooldown is over. */
  attackRange: 3.2 * S,
  alertSteps: 42,
  windup: 45,
  active: 11,
  recover: 42,
  lunge: 7 * S,
  /** The stab connects within this distance and ±0.6 rad of its facing, Nezha not jumping above 1.4 m. */
  hitRange: 3.3 * S,
  hitArc: 0.6,
  hitMaxAir: 1.4 * S,
  damage: 10,
  /** Poise: a wind-up survives light hits until 25 poise (v1.4.0 units); heavy hits always stagger. */
  poiseBreak: 25,
  hurtSteps: 27,
  knockLight: 3.5 * S,
  knockHeavy: 7 * S,
  deadSteps: 120,
  /** Cooldown after an attack (steps, random range) and after a stagger. */
  cdAttack: [84, 156] as const,
  cdHurt: [36, 96] as const,
  /** The warning fan (v1.4.0 RingGeometry 0.3–3.0, 0.9 rad). */
  fanInner: 0.3 * S,
  fanOuter: 3.0 * S,
  fanArc: 0.9,
});

export type MobState = 'patrol' | 'alert' | 'approach' | 'attack' | 'hurt' | 'dead';

export interface Mob {
  readonly id: number;
  x: number;
  z: number;
  facing: number;
  hp: number;
  state: MobState;
  /** Steps in the current state. */
  t: number;
  cd: number;
  poise: number;
  orbit: 1 | -1;
  knockX: number;
  knockZ: number;
  hitDone: boolean;
  homeX: number;
  homeZ: number;
  /** Walk speed this step (m/s), for the leg cycle. */
  walk: number;
  /** Hit flash 1 → 0. */
  flash: number;
}

export interface MobWorld {
  /** Nezha's root and jump height; `ok` = alive and in play. */
  readonly nezha: { readonly x: number; readonly z: number; readonly air: number; readonly ok: boolean };
  /** Keep a mob on walkable ground (boardwalk / platform). */
  readonly constrain: (x: number, z: number, r: number) => { x: number; z: number };
}

export type MobEvent =
  | { readonly type: 'alert'; readonly id: number }
  | { readonly type: 'windup'; readonly id: number }
  | { readonly type: 'stab'; readonly id: number; readonly hit: boolean; readonly damage: number; readonly fromX: number; readonly fromZ: number }
  | { readonly type: 'hurt'; readonly id: number; readonly heavy: boolean }
  | { readonly type: 'dead'; readonly id: number };

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Our yaw convention: facing f looks along (−sin f, −cos f) (same as Nezha's root). */
const fwd = (f: number) => ({ x: -Math.sin(f), z: -Math.cos(f) });
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const turnTo = (from: number, to: number, maxStep: number) => {
  const d = angDiff(to, from);
  return from + Math.max(-maxStep, Math.min(maxStep, d));
};

export function createMobs(seed = 1) {
  const list: Mob[] = [];
  let token: Mob | null = null;
  let nextId = 1;
  let rnd = seed >>> 0;
  const random = () => {
    rnd = (rnd + 0x6d2b79f5) >>> 0;
    let t = Math.imul(rnd ^ (rnd >>> 15), rnd | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (r: readonly [number, number]) => Math.round(r[0] + random() * (r[1] - r[0]));
  const DT = 1 / 60;

  return {
    spawn(x: number, z: number, alerted = true): Mob {
      const m: Mob = {
        id: nextId++, x, z, facing: 0, hp: YAKSHA.hp, state: alerted ? 'alert' : 'patrol', t: 0,
        cd: 60 + Math.round(random() * 60), poise: 0, orbit: random() < 0.5 ? 1 : -1,
        knockX: 0, knockZ: 0, hitDone: false, homeX: x, homeZ: z, walk: 0, flash: 0,
      };
      list.push(m);
      return m;
    },
    clear() {
      list.length = 0;
      token = null;
    },
    list: (): readonly Mob[] => list,
    alive: () => list.filter((m) => m.state !== 'dead').length,
    token: () => token?.id ?? null,

    /** A landed hit from Nezha. `heavy` = heavy / plunge (always staggers). Returns the mob's state after. */
    damage(id: number, amount: number, heavy: boolean, fromX: number, fromZ: number, events: MobEvent[]): MobState | undefined {
      const m = list.find((q) => q.id === id);
      if (!m || m.state === 'dead') return m?.state;
      m.hp = Math.max(0, m.hp - (m.state === 'hurt' ? amount * 1.2 : amount));
      m.flash = 1;
      // v1.4.0 light poise 10 / 10 / 16 against our 8 / 9 / 14 damage → × 1.25; heavy always staggers.
      m.poise += heavy ? 26 : amount * 1.25;
      if (m.state !== 'attack' || m.poise > YAKSHA.poiseBreak || heavy) {
        m.state = 'hurt';
        m.t = 0;
        m.poise = 0;
        if (token === m) token = null;
        const dx = m.x - fromX, dz = m.z - fromZ, l = Math.hypot(dx, dz) || 1;
        const k = heavy ? YAKSHA.knockHeavy : YAKSHA.knockLight;
        m.knockX = (dx / l) * k;
        m.knockZ = (dz / l) * k;
        events.push({ type: 'hurt', id, heavy });
      }
      if (m.hp <= 0) {
        m.state = 'dead';
        m.t = 0;
        if (token === m) token = null;
        events.push({ type: 'dead', id });
      }
      return m.state;
    },

    step(w: MobWorld): MobEvent[] {
      const events: MobEvent[] = [];
      const n = w.nezha;
      for (const m of list) {
        m.t += 1;
        m.flash = Math.max(0, m.flash - DT * 6);
        m.walk = 0;
        const tx = n.x - m.x, tz = n.z - m.z;
        const dist = Math.hypot(tx, tz);
        const ang = yawTo(tx, tz);
        switch (m.state) {
          case 'patrol':
            m.facing = turnTo(m.facing, yawTo(m.homeX - m.x + Math.sin(m.t * DT * 0.4) * 2, m.homeZ - m.z - 3), DT);
            if (n.ok && dist < YAKSHA.alertRange) { m.state = 'alert'; m.t = 0; events.push({ type: 'alert', id: m.id }); }
            break;
          case 'alert':
            m.facing = turnTo(m.facing, ang, 8 * DT);
            if (m.t > YAKSHA.alertSteps) { m.state = 'approach'; m.t = 0; }
            break;
          case 'approach': {
            if (!n.ok) { m.state = 'patrol'; m.t = 0; break; }
            m.facing = turnTo(m.facing, ang, 5 * DT);
            m.cd -= 1;
            const want = token === null || token === m ? YAKSHA.wantNear : YAKSHA.wantFar;
            let vx = 0, vz = 0;
            const ux = dist > 1e-4 ? tx / dist : 0, uz = dist > 1e-4 ? tz / dist : 0;
            if (dist > want + 0.4 * S) { const sp = dist > 8 * S ? YAKSHA.speedFar : YAKSHA.speedNear; vx += ux * sp; vz += uz * sp; }
            else if (dist < want - 0.6 * S) { vx -= ux * YAKSHA.backOff; vz -= uz * YAKSHA.backOff; }
            // Circle round her (v1.4.0 orbit), and keep apart from the others.
            vx += uz * m.orbit * YAKSHA.orbit;
            vz += -ux * m.orbit * YAKSHA.orbit;
            for (const o of list) {
              if (o === m || o.state === 'dead') continue;
              const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz);
              if (d < YAKSHA.separation && d > 1e-4) { vx += (dx / d) * 2.5 * S; vz += (dz / d) * 2.5 * S; }
            }
            m.x += vx * DT;
            m.z += vz * DT;
            m.walk = Math.hypot(vx, vz);
            if (m.cd <= 0 && dist < YAKSHA.attackRange && (token === null || token === m)) {
              token = m;
              m.state = 'attack';
              m.t = 0;
              m.hitDone = false;
              events.push({ type: 'windup', id: m.id });
            }
            if (random() < DT * 0.3) m.orbit = m.orbit === 1 ? -1 : 1;
            break;
          }
          case 'attack': {
            const W = YAKSHA.windup, A = YAKSHA.active, R = YAKSHA.recover;
            if (m.t < W - 12) m.facing = turnTo(m.facing, ang, 5 * DT);
            if (m.t > W && m.t <= W + A) {
              const f = fwd(m.facing);
              m.x += f.x * YAKSHA.lunge * DT;
              m.z += f.z * YAKSHA.lunge * DT;
              if (!m.hitDone) {
                m.hitDone = true;
                const hit = n.ok && dist < YAKSHA.hitRange && n.air < YAKSHA.hitMaxAir && Math.abs(angDiff(m.facing, ang)) < YAKSHA.hitArc;
                events.push({ type: 'stab', id: m.id, hit, damage: YAKSHA.damage, fromX: m.x, fromZ: m.z });
              }
            }
            if (m.t > W + A + R) {
              m.state = 'approach';
              m.t = 0;
              m.cd = range(YAKSHA.cdAttack);
              token = null;
            }
            break;
          }
          case 'hurt':
            m.x += m.knockX * DT;
            m.z += m.knockZ * DT;
            m.knockX *= Math.exp(-DT * 8);
            m.knockZ *= Math.exp(-DT * 8);
            if (m.t > YAKSHA.hurtSteps) { m.state = 'approach'; m.t = 0; m.cd = range(YAKSHA.cdHurt); }
            break;
          case 'dead':
            break;
        }
        if (m.state !== 'dead') {
          const c = w.constrain(m.x, m.z, YAKSHA.radius);
          m.x = c.x;
          m.z = c.z;
        }
      }
      return events;
    },

    /** Telegraph strength 0..1 while winding up (fan opacity / eye glow), else 0. */
    windup(m: Mob): number {
      return m.state === 'attack' && m.t <= YAKSHA.windup ? Math.min(1, m.t / YAKSHA.windup) : 0;
    },
  };
}

export type Mobs = ReturnType<typeof createMobs>;
