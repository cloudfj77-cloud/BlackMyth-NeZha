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
  readonly light: readonly { readonly hit: number; readonly recover: number; readonly damage: number; readonly hitstop: number; readonly shake: number }[];
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
  readonly hurtSteps: number;
  readonly cost: { readonly light: number; readonly heavy: number; readonly roll: number; readonly sprintPerSecond: number };
  readonly regenDelay: number;
  readonly regenPerSecond: number;
  readonly lotus: { readonly count: number; readonly steps: number; readonly heal: number; readonly speedScale: number };
  readonly sash: { readonly castHold: number; readonly steps: number; readonly cooldown: number; readonly holdSteps: number };
}

export const DEFAULT_COMBAT: CombatConfig = {
  hpMax: 100,
  staminaMax: 100,
  light: [
    { hit: 7, recover: 14, damage: 8, hitstop: 3, shake: 0 },
    { hit: 7, recover: 16, damage: 9, hitstop: 3, shake: 0 },
    { hit: 11, recover: 22, damage: 14, hitstop: 5, shake: 0.02 },
  ],
  lightRange: 2.5,
  heavyRange: 3,
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
  roll: { steps: 27, invuln: 18, moveSteps: 12, distance: 3, perfect: 12 },
  slowmoSteps: 18,
  perfectRefund: 20,
  hurtSteps: 24,
  // Boss ruling 17:46: attack stamina halved (design 4.2 had light 12 / heavy 30).
  cost: { light: 6, heavy: 15, roll: 20, sprintPerSecond: 15 },
  regenDelay: 48,
  regenPerSecond: 25,
  lotus: { count: 3, steps: 60, heal: 40, speedScale: 0.4 },
  sash: { castHold: 12, steps: 22, cooldown: 1200, holdSteps: 180 },
};

export interface StepInput {
  /** Edges since the previous machine step. */
  readonly light: boolean;
  readonly roll: boolean;
  readonly lotus: boolean;
  readonly sash: boolean;
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
}

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
  | { readonly type: 'hit'; readonly kind: 'light' | 'heavy'; readonly stage: number; readonly damage: number; readonly hitstop: number; readonly shake: number; readonly strike: StrikeResult; readonly judgeLine: V2 }
  | { readonly type: 'whiff'; readonly kind: 'light' | 'heavy'; readonly strike: StrikeResult; readonly judgeLine: V2 }
  | { readonly type: 'roll'; readonly dir: V2 }
  | { readonly type: 'perfect'; readonly frame: number }
  | { readonly type: 'dodged'; readonly frame: number }
  | { readonly type: 'hurt'; readonly damage: number }
  | { readonly type: 'refill' }
  | { readonly type: 'lotus-heal'; readonly hp: number }
  | { readonly type: 'sash-bind' }
  | { readonly type: 'sash-ready' }
  | { readonly type: 'hint'; readonly key: 'noStamina' | 'noLotusSeeds' | 'sashCooldown' | 'noTarget' };

export type ActionKind = 'free' | 'light' | 'charge' | 'heavy' | 'roll' | 'hurt' | 'lotus' | 'sash';

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
  let state: { kind: ActionKind; frame: number; stage: number; charge: number; rollDir: V2; rollStart: number; released: boolean; lunged: number; healed: boolean } = {
    kind: 'free', frame: 0, stage: 0, charge: 0, rollDir: ZERO, rollStart: -1000, released: false, lunged: 0, healed: false,
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

  const enter = (kind: ActionKind, extra: Partial<typeof state> = {}) => {
    state = { ...state, kind, frame: 0, charge: 0, released: false, lunged: 0, healed: false, ...extra };
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
  const faceForStage = (input: StepInput, env: CombatEnv): number | undefined => {
    if (Math.hypot(input.move.x, input.move.z) > 0.1) return yawOf(input.move);
    return env.lockedFacing() ?? env.autoTarget(env.root, env.facing);
  };
  let facingOverride: number | undefined;

  const startLight = (input: StepInput, env: CombatEnv): boolean => {
    const stage = comboWindow > 0 && comboStage < 3 ? comboStage + 1 : 1;
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
    // The press step is roll frame 1 (displacement and invulnerability start immediately).
    enter('roll', { rollDir: dir, rollStart: step, frame: 1 });
    comboStage = 0;
    comboWindow = 0;
    events.push({ type: 'roll', dir });
    return true;
  };

  const resolveStrike = (kind: 'light' | 'heavy', env: CombatEnv, root: V2, facing: number) => {
    const range = kind === 'light' ? config.lightRange : config.heavyRange;
    const strike = env.strike(root, facing, range, config.arcDeg);
    const f = forward(facing);
    const judgeLine = { x: root.x + f.x * range, z: root.z + f.z * range };
    lastJudge = judgeLine;
    lastStrike = strike;
    if (!strike.hit) {
      events.push({ type: 'whiff', kind, strike, judgeLine });
      return;
    }
    if (kind === 'light') {
      const s = config.light[state.stage - 1]!;
      events.push({ type: 'hit', kind, stage: state.stage, damage: s.damage, hitstop: s.hitstop, shake: s.shake, strike, judgeLine });
    } else {
      const t = (state.charge - config.chargeMin) / (config.chargeMax - config.chargeMin);
      const lerp = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * t;
      events.push({ type: 'hit', kind, stage: 0, damage: Math.round(lerp(config.heavyDamage) * 100) / 100, hitstop: Math.round(lerp(config.heavyHitstop)), shake: lerp(config.heavyShake), strike, judgeLine });
    }
  };

  const rollVelocity = (frame: number, dir: V2): V2 => {
    const r = config.roll;
    if (frame > r.moveSteps) return ZERO;
    const d = r.distance * (easeOut(frame / r.moveSteps) - easeOut((frame - 1) / r.moveSteps));
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

      switch (s.kind) {
        case 'free': {
          const moving = Math.hypot(input.move.x, input.move.z) > 0.1;
          if (comboWindow > 0) {
            comboWindow -= 1;
            moveHeld = moving ? moveHeld + 1 : 0;
            if (moveHeld >= config.breakHold || comboWindow === 0) {
              comboWindow = 0;
              comboStage = 0;
            }
          }
          if (take('roll') && startRoll(input, env)) break;
          if (take('light') && startLight(input, env)) break;
          if (heavyPressed) {
            if (stamina >= config.cost.heavy) {
              enter('charge');
              facingOverride = env.lockedFacing() ?? env.autoTarget(env.root, env.facing);
              comboStage = 0;
              comboWindow = 0;
              break;
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
              break;
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
              break;
            }
          }
          // In a combo gap the stick only re-aims the next stage (until held long enough to break).
          velocity = comboWindow > 0 ? ZERO : undefined;
          allowSprint = comboWindow === 0 && stamina > 0;
          if (allowSprint && input.sprint && moving) {
            stamina = Math.max(0, stamina - config.cost.sprintPerSecond * STEP);
            idle = 0;
          }
          break;
        }
        case 'light': {
          const spec = config.light[s.stage - 1]!;
          if (env.lockedFacing() !== undefined) facingOverride = env.lockedFacing();
          if (s.frame === spec.hit) resolveStrike('light', env, env.root, env.facing);
          if (s.frame > spec.hit && take('roll') && startRoll(input, env)) break;
          if (s.frame >= spec.hit + spec.recover) {
            const stage = s.stage;
            enter('free');
            comboStage = stage < 3 ? stage : 0;
            comboWindow = stage < 3 ? config.comboWindow : 0;
            moveHeld = 0;
          }
          break;
        }
        case 'charge': {
          if (env.lockedFacing() !== undefined) facingOverride = env.lockedFacing();
          if (take('roll') && startRoll(input, env)) break;
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
          if (s.frame > lunge + 1 && take('roll') && startRoll(input, env)) break;
          if (s.frame >= lunge + 1 + config.heavyRecover) enter('free');
          break;
        }
        case 'roll': {
          const r = config.roll;
          velocity = rollVelocity(s.frame, s.rollDir);
          // The press step is frame 1, so the roll occupies exactly `steps` steps.
          if (s.frame > r.steps) {
            enter('free');
            if (take('roll')) startRoll(input, env);
            else if (take('light')) startLight(input, env);
          }
          break;
        }
        case 'hurt': {
          if (s.frame >= config.hurtSteps) enter('free');
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

      if (state !== s && state.kind === 'roll') velocity = rollVelocity(1, state.rollDir);

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
    incoming(damage: number): CombatEvent {
      if (state.kind === 'roll') {
        const frame = step - state.rollStart + 1;
        if (frame >= 1 && frame <= config.roll.invuln) {
          if (frame - 1 <= config.roll.perfect) {
            stamina = Math.min(config.staminaMax, stamina + config.perfectRefund);
            return { type: 'perfect', frame };
          }
          return { type: 'dodged', frame };
        }
      }
      hp -= damage;
      enter('hurt');
      comboStage = 0;
      comboWindow = 0;
      buffered = undefined;
      if (hp <= 0) {
        hp = config.hpMax;
        return { type: 'refill' };
      }
      return { type: 'hurt', damage };
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
    ],
    heavyHitstop: [t.hitstopHeavyMin, t.hitstopHeavyMax],
    heavyShake: [t.shakeHeavyMin, t.shakeHeavyMax],
    slowmoSteps: t.slowmoSteps,
    lungeDistance: t.lungeDistance,
    roll: { ...d.roll, distance: t.rollDistance },
    cost: { ...d.cost, light: t.costLight, heavy: t.costHeavy },
  };
}
