/**
 * Nezha's combat state machine (pure, step-driven: 60 steps per second of Nezha time).
 * Timing convention: every action occupies exactly N steps counting its press step. Attacks,
 * seeds and the sash count the press step as frame 0 (frame N is already free); the roll counts
 * its press step as frame 1 so displacement and invulnerability start on the press (≤ 1 step).
 * The Engine plugin feeds one StepInput per un-frozen fixed step; hitstop is applied
 * outside (the machine simply is not stepped), so every timing below is exact in steps
 * and unit-testable. Spec: game-spec 4.2 + design/milestones/M2-combat.md.
 */
export interface V2 {
  readonly x: number;
  readonly z: number;
}

export const STEP = 1 / 60;

export interface CombatConfig {
  readonly hpMax: number;
  readonly staminaMax: number;
  readonly light: readonly { readonly hit: number; readonly recover: number; readonly damage: number; readonly hitstop: number; readonly shake: number; readonly lunge: number; readonly range?: number; readonly arc?: number }[];
  /** Frames after a light hit frame from which the next light press chains straight in. */
  readonly chainFrom: number;
  /** Hurt frames before a roll can cancel the stun (0 = immediately, boss 21:55). */
  readonly hurtRollFrom: number;
  readonly lightRange: number;
  readonly heavyRange: number;
  readonly arcDeg: number;
  readonly chargeMin: number;
  readonly chargeMax: number;
  readonly heavyDamage: readonly [number, number];
  readonly heavyHitstop: readonly [number, number];
  readonly heavyShake: readonly [number, number];
  readonly lungeSteps: number;
  readonly lungeDistance: number;
  readonly heavyRecover: number;
  readonly comboWindow: number;
  readonly buffer: number;
  readonly breakHold: number;
  readonly roll: { readonly steps: number; readonly invuln: number; readonly moveSteps: number; readonly distance: number; readonly perfect: number };
  readonly slowmoSteps: number;
  readonly perfectRefund: number;
  /** v1.4.0 P.invuln 0.6 s after being hurt: a second hit inside it does nothing. */
  readonly hurtInvuln: number;
  /** v1.4.0 perfectDodge: 0.45 s untouchable after it, 混天绫 cooldown −2 s; a roll within 0.2 s of the last one is never perfect. */
  readonly perfectInvuln: number;
  readonly perfectSashRefund: number;
  readonly spamGuard: number;
  readonly hurtSteps: number;
  readonly cost: { readonly light: number; readonly heavy: number; readonly roll: number; readonly sprintPerSecond: number };
  readonly regenDelay: number;
  readonly regenPerSecond: number;
  readonly lotus: { readonly count: number; readonly steps: number; readonly heal: number; readonly speedScale: number };
  readonly sash: { readonly castHold: number; readonly steps: number; readonly cooldown: number; readonly holdSteps: number };
  /** Jump (v1.4.0 port): take-off speed (m/s), gravity (m/s²), stamina cost, plunging air attack. */
  readonly jump: {
    readonly velocity: number; readonly gravity: number; readonly cost: number; readonly slamHang: number; readonly airSpeed: number;
    /** Plunge (v1.4.0 跳劈): extra stamina, landing strike (range m, arc °, damage, hitstop, shake), landing lag. */
    readonly slamCost: number; readonly slamRange: number; readonly slamArc: number; readonly slamDamage: number;
    readonly slamHitstop: number; readonly slamShake: number; readonly slamRecover: number;
  };
  /** 灵息 after a perfect dodge (v1.4.0): steps of no regen delay and double regen. */
  readonly boostSteps: number;
}

export const DEFAULT_COMBAT: CombatConfig = {
  hpMax: 100,
  staminaMax: 100,
  light: [
    { hit: 7, recover: 14, damage: 8, hitstop: 3, shake: 0, lunge: 0.45 },
    { hit: 7, recover: 16, damage: 9, hitstop: 3, shake: 0, lunge: 0.45 },
    { hit: 11, recover: 22, damage: 14, hitstop: 5, shake: 0.02, lunge: 0.9 },
    /** v1.4.0 LIGHT[3] 回旋枪 (boss 11-06 20:57): a full spin, 360°, 3 m; 0.8 s (hit at 0.2 s… swept to 0.5 s). */
    { hit: 18, recover: 30, damage: 14, hitstop: 6, shake: 0.04, lunge: 0.2, range: 3.6, arc: 360 },
  ],
  chainFrom: 4,
  hurtRollFrom: 0,
  // The doubled spear (asset v2, 11-06): reach follows the blade so a visible hit is a real hit.
  lightRange: 3.6,
  heavyRange: 4,
  arcDeg: 60,
  chargeMin: 18,
  chargeMax: 72,
  heavyDamage: [20, 45],
  heavyHitstop: [5, 8],
  heavyShake: [0.03, 0.06],
  lungeSteps: 8,
  lungeDistance: 0.5,
  heavyRecover: 24,
  comboWindow: 36,
  buffer: 9,
  breakHold: 9,
  // v1.4.0 PERFECT_WIN 0.25 s: a roll started 0..14 steps before the hit is perfect.
  roll: { steps: 27, invuln: 18, moveSteps: 12, distance: 3, perfect: 14 },
  slowmoSteps: 18,
  perfectRefund: 30,
  hurtInvuln: 36,
  perfectInvuln: 27,
  perfectSashRefund: 120,
  spamGuard: 12,
  hurtSteps: 24,
  // Boss 22:12: attacks cost no stamina (17:46 had halved them; design 4.2 had light 12 / heavy 30).
  cost: { light: 0, heavy: 0, roll: 20, sprintPerSecond: 15 },
  regenDelay: 48,
  regenPerSecond: 25,
  lotus: { count: 3, steps: 60, heal: 40, speedScale: 0.4 },
  sash: { castHold: 12, steps: 22, cooldown: 1200, holdSteps: 180 },
  // v1.4.0: 14 stamina, 3.1 m / 150°, 46 dmg (scaled to our table: between light 3 = 14 and heavy min = 20), 0.18 s lag.
  jump: { velocity: 9.8, gravity: 24, cost: 10, slamHang: 12, airSpeed: 3, slamCost: 14, slamRange: 3.1, slamArc: 150, slamDamage: 16, slamHitstop: 6, slamShake: 0.045, slamRecover: 11 },
  boostSteps: 150,
};

export interface StepInput {
  /** Edges since the previous machine step. */
  readonly light: boolean;
  readonly roll: boolean;
  readonly lotus: boolean;
  readonly sash: boolean;
  /** Ctrl / F (v1.4.0 port). */
  readonly jump?: boolean;
  /** Levels. */
  readonly heavyHeld: boolean;
  readonly sprint: boolean;
  /** World-space desired move direction (unit length, or zero). */
  readonly move: V2;
}

export interface StrikeResult {
  readonly hit: boolean;
  readonly distance: number;
  readonly angleDeg: number;
  readonly point: V2;
  /** Hurt capsule index on the target (dragon), when known. */
  readonly segment?: number;
  /** The tail (11–18 m) was hit: ×0.3 damage and a lighter hit feel (boss 1B). */
  readonly tail?: boolean;
}

/** Tail hits (boss 17:48, 1B): damage ×0.3 (rounded, at least 1), hitstop light 1/1/2, heavy 2, no shake. */
export const TAIL = Object.freeze({ damageMultiplier: 0.3, lightHitstop: [1, 1, 2, 2] as const, heavyHitstop: 2 });

/** What the machine needs to know about the world this step. */
export interface CombatEnv {
  readonly root: V2;
  readonly facing: number;
  readonly strike: (root: V2, facing: number, range: number, arcDeg: number) => StrikeResult;
  /** Yaw toward the target when it is within 3 m and ±90° (unlocked auto-turn). */
  readonly autoTarget: (root: V2, facing: number) => number | undefined;
  /** Yaw toward the locked target, if locked. */
  readonly lockedFacing: () => number | undefined;
  readonly sashInRange: () => boolean;
  /** Body contact: the heavy lunge stops here. */
  readonly touching: (root: V2) => boolean;
}

export type CombatEvent =
  | { readonly type: 'swing-light'; readonly stage: number }
  | { readonly type: 'swing-heavy'; readonly charge: number }
  | { readonly type: 'charge-full' }
  | { readonly type: 'hit'; readonly kind: 'light' | 'heavy'; readonly stage: number; readonly damage: number; readonly hitstop: number; readonly shake: number; readonly strike: StrikeResult; readonly judgeLine: V2; readonly tail: boolean }
  | { readonly type: 'whiff'; readonly kind: 'light' | 'heavy'; readonly strike: StrikeResult; readonly judgeLine: V2 }
  | { readonly type: 'roll'; readonly dir: V2 }
  | { readonly type: 'jump' }
  | { readonly type: 'land'; readonly slam: boolean }
  | { readonly type: 'perfect'; readonly frame: number }
  | { readonly type: 'dodged'; readonly frame: number }
  | { readonly type: 'hurt'; readonly damage: number }
  | { readonly type: 'dead' }
  | { readonly type: 'lotus-heal'; readonly hp: number }
  | { readonly type: 'sash-bind' }
  | { readonly type: 'sash-ready' }
  | { readonly type: 'hint'; readonly key: 'noStamina' | 'noLotusSeeds' | 'sashCooldown' | 'noTarget' };

const KNOCK_STEPS = 10;

export type ActionKind = 'free' | 'light' | 'charge' | 'heavy' | 'roll' | 'hurt' | 'lotus' | 'sash' | 'dead' | 'airatk';

export interface CombatState {
  readonly kind: ActionKind;
  /** 1-based frame within the action. */
  readonly frame: number;
  readonly stage: number;
  readonly charge: number;
  readonly rollDir: V2;
}

export interface StepOutput {
  /** Velocity override in m/s (undefined = normal stick movement). */
  readonly velocity: V2 | undefined;
  /** Facing override (yaw), applied instantly. */
  readonly facing: number | undefined;
  readonly speedScale: number;
  readonly allowSprint: boolean;
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
}

const ZERO: V2 = Object.freeze({ x: 0, z: 0 });
const forward = (yaw: number): V2 => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const yawOf = (d: V2) => Math.atan2(-d.x, -d.z);
const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;

export function createCombat(initial: CombatConfig = DEFAULT_COMBAT) {
  let config = initial;
  let step = 0;
  let hp = config.hpMax;
  let stamina = config.staminaMax;
  let lotus = config.lotus.count;
  let sashCd = 0;
  let idle = config.regenDelay;
  let state: { kind: ActionKind; frame: number; stage: number; charge: number; rollDir: V2; rollStart: number; released: boolean; lunged: number; healed: boolean; landed: number } = {
    kind: 'free', frame: 0, stage: 0, charge: 0, rollDir: ZERO, rollStart: -1000, released: false, lunged: 0, healed: false, landed: -1,
  };
  let comboStage = 0;
  let comboWindow = 0;
  let moveHeld = 0;
  let prevHeavy = false;
  let buffered: { kind: 'light' | 'roll'; ttl: number } | undefined;
  let flashSerial = 0;
  let lastJudge: V2 | undefined;
  let lastStrike: StrikeResult | undefined;
  let events: CombatEvent[] = [];
  let knock: { readonly dir: V2; readonly distance: number } | undefined;
  /** Airborne height above the hover line (m) and vertical speed; 灵息 steps left. */
  let airY = 0, airVy = 0, boost = 0;
  let lastHurt = -1000;
  let immuneUntil = -1;
  let noPerfect = false;

  const enter = (kind: ActionKind, extra: Partial<typeof state> = {}) => {
    state = { ...state, kind, frame: 0, charge: 0, released: false, lunged: 0, healed: false, landed: -1, ...extra };
  };
  const spend = (amount: number): boolean => {
    if (stamina < amount) {
      flashSerial += 1;
      events.push({ type: 'hint', key: 'noStamina' });
      return false;
    }
    stamina -= amount;
    idle = 0;
    return true;
  };
  /** Last combo stage (4: the v1.4.0 spin). */
  const LAST = config.light.length;
  const faceForStage = (input: StepInput, env: CombatEnv): number | undefined => {
    if (Math.hypot(input.move.x, input.move.z) > 0.1) return yawOf(input.move);
    return env.lockedFacing() ?? env.autoTarget(env.root, env.facing);
  };
  let facingOverride: number | undefined;

  const startLight = (input: StepInput, env: CombatEnv): boolean => {
    const stage = comboWindow > 0 && comboStage < LAST ? comboStage + 1 : 1;
    if (!spend(config.cost.light)) {
      comboStage = 0;
      comboWindow = 0;
      return false;
    }
    facingOverride = faceForStage(input, env);
    enter('light', { stage });
    comboStage = stage;
    comboWindow = 0;
    events.push({ type: 'swing-light', stage });
    return true;
  };
  const startRoll = (input: StepInput, env: CombatEnv): boolean => {
    if (!spend(config.cost.roll)) return false;
    const moving = Math.hypot(input.move.x, input.move.z) > 0.1;
    const f = forward(env.facing);
    const dir = moving ? input.move : { x: -f.x, z: -f.z };
    // v1.4.0 anti-mash: rolling again within 0.2 s of the last roll's start never counts as perfect.
    noPerfect = state.kind === 'roll' && step - state.rollStart < config.spamGuard;
    // The press step is roll frame 1 (displacement and invulnerability start immediately).
    enter('roll', { rollDir: dir, rollStart: step, frame: 1 });
    comboStage = 0;
    comboWindow = 0;
    events.push({ type: 'roll', dir });
    return true;
  };

  const resolveStrike = (kind: 'light' | 'heavy', env: CombatEnv, root: V2, facing: number, slam = false) => {
    const J = config.jump;
    const ls = kind === 'light' ? config.light[state.stage - 1] : undefined;
    const range = slam ? J.slamRange : kind === 'light' ? (ls?.range ?? config.lightRange) : config.heavyRange;
    const strike = env.strike(root, facing, range, slam ? J.slamArc : (ls?.arc ?? config.arcDeg));
    const f = forward(facing);
    const judgeLine = { x: root.x + f.x * range, z: root.z + f.z * range };
    lastJudge = judgeLine;
    lastStrike = strike;
    if (!strike.hit) {
      events.push({ type: 'whiff', kind, strike, judgeLine });
      return;
    }
    const tail = strike.tail === true;
    const tailDamage = (d: number) => Math.max(1, Math.round(d * TAIL.damageMultiplier));
    if (slam) {
      // Plunge landing: its own numbers (not the charge curve — charge 0 would extrapolate below the minimum).
      events.push({
        type: 'hit', kind: 'heavy', stage: 0, strike, judgeLine, tail,
        damage: tail ? tailDamage(J.slamDamage) : J.slamDamage,
        hitstop: tail ? TAIL.heavyHitstop : J.slamHitstop,
        shake: tail ? 0 : J.slamShake,
      });
    } else if (kind === 'light') {
      const s = config.light[state.stage - 1]!;
      events.push({
        type: 'hit', kind, stage: state.stage, strike, judgeLine, tail,
        damage: tail ? tailDamage(s.damage) : s.damage,
        hitstop: tail ? TAIL.lightHitstop[state.stage - 1]! : s.hitstop,
        shake: tail ? 0 : s.shake,
      });
    } else {
      const t = (state.charge - config.chargeMin) / (config.chargeMax - config.chargeMin);
      const lerp = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * t;
      const damage = Math.round(lerp(config.heavyDamage) * 100) / 100;
      events.push({
        type: 'hit', kind, stage: 0, strike, judgeLine, tail,
        damage: tail ? tailDamage(damage) : damage,
        hitstop: tail ? TAIL.heavyHitstop : Math.round(lerp(config.heavyHitstop)),
        shake: tail ? 0 : lerp(config.heavyShake),
      });
    }
  };

  const rollVelocity = (frame: number, dir: V2): V2 => {
    const r = config.roll;
    if (frame > r.moveSteps) return ZERO;
    // Softer burst than a pure ease-out: still moves on the press frame, peaks early, glides out.
    const p = (t: number) => { const c = Math.min(1, Math.max(0, t)); return 0.6 * easeOut(c) + 0.4 * c * c * (3 - 2 * c); };
    const d = r.distance * (p(frame / r.moveSteps) - p((frame - 1) / r.moveSteps));
    return { x: (dir.x * d) / STEP, z: (dir.z * d) / STEP };
  };

  /** Inputs that arrive while the machine is frozen (hitstop) still enter the buffer. */
  const record = (input: StepInput) => {
    if (input.roll) buffered = { kind: 'roll', ttl: config.buffer };
    else if (input.light) buffered = { kind: 'light', ttl: config.buffer };
  };

  return {
    /** Advance one Nezha step. */
    step(input: StepInput, env: CombatEnv): StepOutput {
      events = [];
      facingOverride = undefined;
      step += 1;
      // Edges of this step become buffered intents; consumed below when allowed.
      record(input);
      const heavyPressed = input.heavyHeld && !prevHeavy;
      prevHeavy = input.heavyHeld;
      if (buffered) {
        buffered.ttl -= 1;
        if (buffered.ttl < 0) buffered = undefined;
      }
      if (sashCd > 0) {
        sashCd -= 1;
        if (sashCd === 0) events.push({ type: 'sash-ready' });
      }

      let velocity: V2 | undefined = ZERO;
      let speedScale = 1;
      let allowSprint = false;
      const s = state;
      s.frame += 1;
      const take = (kind: 'light' | 'roll') => {
        if (buffered?.kind !== kind) return false;
        buffered = undefined;
        return true;
      };

      // Boss 21:55: a roll cancels ANY action at once (own actions, the hurt stun, and a roll past frame 1).
      const rollCancellable =
        (s.kind !== 'free' && s.kind !== 'roll' && s.kind !== 'hurt' && s.kind !== 'dead') ||
        (s.kind === 'hurt' && s.frame > config.hurtRollFrom) ||
        (s.kind === 'roll' && s.frame >= 2);
      if (rollCancellable && buffered?.kind === 'roll' && stamina >= config.cost.roll) {
        if (s.kind === 'lotus') lotus += 1; // the seed was not eaten
        buffered = undefined;
        startRoll(input, env);
      }
      // Jump (v1.4.0): from free, a roll past frame 1, or the recovery of an attack; keeps the speed.
      if (input.jump && airY <= 0 && state === s) {
        const lightSpec = s.kind === 'light' ? config.light[s.stage - 1] : undefined;
        const can = s.kind === 'free' || (s.kind === 'roll' && s.frame >= 2) || (lightSpec !== undefined && s.frame > lightSpec.hit) || (s.kind === 'heavy' && s.frame > config.lungeSteps + 1);
        if (can && spend(config.jump.cost)) {
          airVy = config.jump.velocity;
          airY = 0.001;
          if (s.kind === 'light' || s.kind === 'heavy') enter('free');
          events.push({ type: 'jump' });
        }
      }
      let runFreeAfter = false;
      const runFree = () => {
            const moving = Math.hypot(input.move.x, input.move.z) > 0.1;
            if (comboWindow > 0) {
              comboWindow -= 1;
              moveHeld = moving ? moveHeld + 1 : 0;
              if (moveHeld >= config.breakHold || comboWindow === 0) {
                comboWindow = 0;
                comboStage = 0;
              }
            }
            if (take('roll') && startRoll(input, env)) return;
            // In the air a light press is the plunging attack (v1.4.0 跳劈): hang, then slam down.
            if (airY > 0 && take('light') && spend(config.jump.slamCost)) {
              enter('airatk');
              airVy = Math.max(airVy, 2);
              facingOverride = env.lockedFacing() ?? env.autoTarget(env.root, env.facing);
              events.push({ type: 'swing-heavy', charge: 0 });
              return;
            }
            if (airY > 0) {
              // Airborne: steer only (no heavy, seeds or spell until landing).
              velocity = undefined;
              return;
            }
            if (take('light') && startLight(input, env)) return;
            if (heavyPressed) {
              if (stamina >= config.cost.heavy) {
                enter('charge');
                facingOverride = env.lockedFacing() ?? env.autoTarget(env.root, env.facing);
                comboStage = 0;
                comboWindow = 0;
                return;
              }
              flashSerial += 1;
              events.push({ type: 'hint', key: 'noStamina' });
            }
            if (input.lotus) {
              if (lotus <= 0) events.push({ type: 'hint', key: 'noLotusSeeds' });
              else {
                lotus -= 1;
                enter('lotus');
                comboStage = 0;
                comboWindow = 0;
                return;
              }
            }
            if (input.sash) {
              if (sashCd > 0) events.push({ type: 'hint', key: 'sashCooldown' });
              else if (!env.sashInRange()) events.push({ type: 'hint', key: 'noTarget' });
              else {
                enter('sash');
                facingOverride = env.lockedFacing() ?? env.autoTarget(env.root, env.facing);
                comboStage = 0;
                comboWindow = 0;
                return;
              }
            }
            // In a combo gap the stick only re-aims the next stage (until held long enough to break).
            velocity = comboWindow > 0 ? ZERO : undefined;
            allowSprint = comboWindow === 0 && stamina > 0;
            if (allowSprint && input.sprint && moving) {
              stamina = Math.max(0, stamina - config.cost.sprintPerSecond * STEP);
              idle = 0;
            }

      };

      if (state !== s) {
        // Rolled out this step: frame 1 displacement below.
      } else switch (s.kind) {
        case 'free':
          runFree();
          break;
        case 'light': {
          const spec = config.light[s.stage - 1]!;
          if (env.lockedFacing() !== undefined) facingOverride = env.lockedFacing();
          // Step into the strike: root lunge before the hit frame, stopped by body contact.
          if (s.frame < spec.hit && spec.lunge > 0 && !env.touching(env.root)) {
            const n = spec.hit - 1;
            const d = spec.lunge * (easeOut(s.frame / n) - easeOut((s.frame - 1) / n));
            const f = forward(env.facing);
            velocity = { x: (f.x * d) / STEP, z: (f.z * d) / STEP };
          }
          if (s.frame === spec.hit) resolveStrike('light', env, env.root, env.facing);
          // Chain: shortly after the hit, the next press goes straight into the next stage.
          if (s.frame >= spec.hit + config.chainFrom && buffered?.kind === 'light') {
            comboStage = s.stage < LAST ? s.stage : 0;
            comboWindow = s.stage < LAST ? 1 : 0;
            buffered = undefined;
            if (startLight(input, env)) break;
          }
          if (s.frame >= spec.hit + spec.recover) {
            const stage = s.stage;
            enter('free');
            comboStage = stage < LAST ? stage : 0;
            comboWindow = stage < LAST ? config.comboWindow : 0;
            moveHeld = 0;
          }
          break;
        }
        case 'charge': {
          if (env.lockedFacing() !== undefined) facingOverride = env.lockedFacing();
          s.charge = Math.min(config.chargeMax, s.frame);
          if (s.frame === config.chargeMax) events.push({ type: 'charge-full' });
          if (!input.heavyHeld) s.released = true;
          if (s.released && s.charge >= config.chargeMin) {
            const charge = s.charge;
            stamina -= Math.min(stamina, config.cost.heavy);
            idle = 0;
            enter('heavy', { charge });
            events.push({ type: 'swing-heavy', charge });
          }
          break;
        }
        case 'heavy': {
          if (env.lockedFacing() !== undefined) facingOverride = env.lockedFacing();
          const lunge = config.lungeSteps;
          if (s.frame <= lunge && !env.touching(env.root)) {
            const d = config.lungeDistance * (easeOut(s.frame / lunge) - easeOut((s.frame - 1) / lunge));
            const f = forward(env.facing);
            velocity = { x: (f.x * d) / STEP, z: (f.z * d) / STEP };
            s.lunged += d;
          }
          if (s.frame === lunge + 1) resolveStrike('heavy', env, env.root, env.facing);
          if (s.frame >= lunge + 1 + config.heavyRecover) enter('free');
          break;
        }
        case 'roll': {
          const r = config.roll;
          // The press step is frame 1, so the roll occupies exactly `steps` steps.
          if (s.frame <= r.moveSteps) velocity = rollVelocity(s.frame, s.rollDir);
          else {
            // Displacement done: no stiffness. The stick moves again (still invulnerable to frame 18),
            // and any action press leaves the roll at once.
            velocity = undefined;
            allowSprint = stamina > 0;
            if (buffered?.kind === 'light' || heavyPressed || input.lotus || input.sash || s.frame > r.steps) {
              enter('free');
              runFreeAfter = true;
            }
          }
          break;
        }
        case 'hurt': {
          // Knockback (tail lash: 3 m) plays over the first steps of the stun.
          if (knock && s.frame <= KNOCK_STEPS) {
            const d = knock.distance * (easeOut(s.frame / KNOCK_STEPS) - easeOut((s.frame - 1) / KNOCK_STEPS));
            velocity = { x: (knock.dir.x * d) / STEP, z: (knock.dir.z * d) / STEP };
          }
          if (s.frame >= config.hurtSteps) {
            knock = undefined;
            enter('free');
          }
          break;
        }
        case 'dead':
          // Defeated: no input until the fight resets.
          buffered = undefined;
          break;
        case 'airatk': {
          if (env.lockedFacing() !== undefined) facingOverride = env.lockedFacing();
          const f = forward(env.facing);
          velocity = s.landed < 0 && s.frame <= config.jump.slamHang ? { x: f.x * config.jump.airSpeed, z: f.z * config.jump.airSpeed } : ZERO;
          // Landing lag (v1.4.0 land t = -0.18 s): the spear stays driven down, then free.
          if (s.landed >= 0 && s.frame - s.landed >= config.jump.slamRecover) enter('free');
          break;
        }
        case 'lotus': {
          velocity = undefined;
          speedScale = config.lotus.speedScale;
          if (s.frame >= config.lotus.steps) {
            hp = Math.min(config.hpMax, hp + config.lotus.heal);
            events.push({ type: 'lotus-heal', hp });
            enter('free');
          }
          break;
        }
        case 'sash': {
          if (s.frame === config.sash.castHold) {
            sashCd = config.sash.cooldown;
            events.push({ type: 'sash-bind' });
          }
          if (s.frame >= config.sash.steps) enter('free');
          break;
        }
      }

      if (runFreeAfter) runFree();
      if (state !== s && state.kind === 'roll') velocity = rollVelocity(1, state.rollDir);

      // Air (v1.4.0 gravity): the plunging attack hangs, then drops fast; landing ends it with a slam.
      if (airY > 0 || airVy > 0) {
        const J = config.jump;
        const g = state.kind === 'airatk' ? (state.frame < J.slamHang ? J.gravity * 0.25 : J.gravity * 2.5) : J.gravity;
        airVy -= g * STEP;
        airY += airVy * STEP;
        if (airY <= 0) {
          airY = 0;
          airVy = 0;
          const slam = state.kind === 'airatk';
          events.push({ type: 'land', slam });
          if (slam) {
            resolveStrike('heavy', env, env.root, env.facing, true);
            state = { ...state, landed: state.frame };
          }
        }
      }
      if (boost > 0) {
        // 灵息: no regen delay, double regen.
        boost -= 1;
        idle = Math.max(idle, config.regenDelay);
        stamina = Math.min(config.staminaMax, stamina + config.regenPerSecond * STEP);
      }

      if (state.kind === 'free' || state.kind === 'lotus') {
        if (!(state.kind === 'free' && input.sprint && allowSprint && Math.hypot(input.move.x, input.move.z) > 0.1)) idle += 1;
      } else idle = 0;
      if (idle >= config.regenDelay) stamina = Math.min(config.staminaMax, stamina + config.regenPerSecond * STEP);

      return {
        velocity,
        facing: facingOverride,
        speedScale,
        allowSprint,
        state: { kind: state.kind, frame: state.frame, stage: state.stage, charge: state.charge, rollDir: state.rollDir },
        events,
      };
    },
    /** Called while frozen by hitstop: only buffer the edges. */
    hold(input: StepInput) {
      record(input);
      prevHeavy = input.heavyHeld;
    },
    /**
     * An enemy hit lands this step (after `step`). Roll frames 1..invuln are immune;
     * a roll that started 0..perfect steps before the hit is a perfect dodge.
     */
    incoming(damage: number, knockback?: { readonly dir: V2; readonly distance: number }): CombatEvent {
      if (state.kind === 'dead') return { type: 'dodged', frame: 0 };
      if (step < immuneUntil) return { type: 'dodged', frame: 0 };
      if (state.kind === 'roll') {
        const frame = step - state.rollStart + 1;
        if (frame >= 1 && frame <= config.roll.invuln) {
          if (frame - 1 <= config.roll.perfect && !noPerfect) {
            stamina = Math.min(config.staminaMax, stamina + config.perfectRefund);
            boost = config.boostSteps;
            immuneUntil = step + config.perfectInvuln;
            sashCd = Math.max(0, sashCd - config.perfectSashRefund);
            return { type: 'perfect', frame };
          }
          return { type: 'dodged', frame };
        }
      }
      if (step - lastHurt < config.hurtInvuln) return { type: 'dodged', frame: 0 };
      lastHurt = step;
      hp = Math.max(0, hp - damage);
      comboStage = 0;
      comboWindow = 0;
      buffered = undefined;
      if (hp <= 0) {
        // M3: defeat (the fight plugin shows「败」and resets everything).
        enter('dead');
        knock = undefined;
        return { type: 'dead' };
      }
      enter('hurt');
      knock = knockback;
      return { type: 'hurt', damage };
    },
    /** Back to a fresh fight (defeat / victory reset). */
    reset() {
      hp = config.hpMax;
      lastHurt = -1000;
      immuneUntil = -1;
      noPerfect = false;
      stamina = config.staminaMax;
      lotus = config.lotus.count;
      sashCd = 0;
      idle = config.regenDelay;
      comboStage = 0;
      comboWindow = 0;
      buffered = undefined;
      knock = undefined;
      airY = 0;
      airVy = 0;
      boost = 0;
      enter('free');
    },
    /** Live tuning: replace the configuration (timings already running keep their frame counters). */
    setConfig(next: CombatConfig) {
      config = next;
    },
    snapshot() {
      const invuln = state.kind === 'roll' && state.frame >= 1 && state.frame <= config.roll.invuln;
      return {
        step, hp, stamina, lotus, sashCd, comboStage, comboWindow, flashSerial,
        invuln,
        action: state.kind, frame: state.frame, stage: state.stage, charge: state.charge,
        judgeLine: lastJudge, lastStrike, buffered: buffered?.kind ?? null,
        airY, airVy, boost,
      };
    },
  };
}

export type Combat = ReturnType<typeof createCombat>;

/** Build the machine configuration from the live tuning `combat` group (feel knobs only). */
export function configFromTuning(t: {
  readonly hitstopLight1: number; readonly hitstopLight2: number; readonly hitstopLight3: number;
  readonly hitstopHeavyMin: number; readonly hitstopHeavyMax: number;
  readonly shakeLight3: number; readonly shakeHeavyMin: number; readonly shakeHeavyMax: number;
  readonly slowmoSteps: number; readonly rollDistance: number; readonly lungeDistance: number;
  readonly costLight: number; readonly costHeavy: number;
}): CombatConfig {
  const d = DEFAULT_COMBAT;
  return {
    ...d,
    light: [
      { ...d.light[0]!, hitstop: t.hitstopLight1 },
      { ...d.light[1]!, hitstop: t.hitstopLight2 },
      { ...d.light[2]!, hitstop: t.hitstopLight3, shake: t.shakeLight3 },
      d.light[3]!,
    ],
    heavyHitstop: [t.hitstopHeavyMin, t.hitstopHeavyMax],
    heavyShake: [t.shakeHeavyMin, t.shakeHeavyMax],
    slowmoSteps: t.slowmoSteps,
    lungeDistance: t.lungeDistance,
    roll: { ...d.roll, distance: t.rollDistance },
    cost: { ...d.cost, light: t.costLight, heavy: t.costHeavy },
  };
}
