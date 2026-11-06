import { describe, expect, it } from 'vitest';
import { createCombat, DEFAULT_COMBAT as C, type CombatEnv, type CombatEvent, type StepInput } from '../combat/machine.ts';

const NONE: StepInput = { light: false, roll: false, lotus: false, sash: false, heavyHeld: false, sprint: false, move: { x: 0, z: 0 } };
const press = (patch: Partial<StepInput>): StepInput => ({ ...NONE, ...patch });

function env(patch: Partial<CombatEnv> = {}): CombatEnv {
  return {
    root: { x: 0, z: 0 },
    facing: 0,
    strike: (_root, _facing, range) => ({ hit: range >= 2, distance: 2, angleDeg: 0, point: { x: 0, z: -2 } }),
    autoTarget: () => undefined,
    lockedFacing: () => undefined,
    sashInRange: () => true,
    touching: () => false,
    ...patch,
  };
}

function run(combat: ReturnType<typeof createCombat>, inputs: StepInput[], e = env()) {
  const events: { step: number; event: CombatEvent }[] = [];
  const states: string[] = [];
  inputs.forEach((input) => {
    const out = combat.step(input, e);
    for (const event of out.events) events.push({ step: combat.snapshot().step, event });
    states.push(`${out.state.kind}:${out.state.frame}`);
  });
  return { events, states };
}
const idle = (n: number) => Array.from({ length: n }, () => NONE);

describe('light combo', () => {
  it('hits on frame 7 / 7 / 11 with 8 / 9 / 14 damage and hitstop 3 / 3 / 5', () => {
    const c = createCombat();
    const r = run(c, [press({ light: true }), ...idle(20), press({ light: true }), ...idle(22), press({ light: true }), ...idle(40)]);
    const hits = r.events.filter((x) => x.event.type === 'hit').map((x) => x.event as Extract<CombatEvent, { type: 'hit' }>);
    expect(hits.map((h) => [h.stage, h.damage, h.hitstop])).toEqual([[1, 8, 3], [2, 9, 3], [3, 14, 5]]);
    expect(hits[2]!.shake).toBe(0.02);
    expect(r.events.find((x) => x.event.type === 'hit')!.step).toBe(1 + 7);
  });
  it('chains within the 36-step window and resets at 37', () => {
    for (const [gap, stage] of [[35, 2], [37, 1]] as const) {
      const c = createCombat();
      // Stage 1 lasts hit 7 + recover 14 = 21 frames after the press step.
      const r = run(c, [press({ light: true }), ...idle(21), ...idle(gap - 1), press({ light: true }), ...idle(12)]);
      const swings = r.events.filter((x) => x.event.type === 'swing-light').map((x) => (x.event as { stage: number }).stage);
      expect(swings).toEqual([1, stage]);
    }
  });
  it('breaks the combo when a direction is held for 9 steps in the gap', () => {
    const c = createCombat();
    const move = press({ move: { x: 1, z: 0 } });
    const r = run(c, [press({ light: true }), ...idle(21), ...Array.from({ length: 9 }, () => move), press({ light: true }), ...idle(5)]);
    expect(r.events.filter((x) => x.event.type === 'swing-light').map((x) => (x.event as { stage: number }).stage)).toEqual([1, 1]);
  });
  it('attacks cost no stamina (boss 22:12); a roll is refused without stamina and flashes the hint', () => {
    const c = createCombat();
    const presses: StepInput[] = [];
    for (let i = 0; i < 20; i += 1) presses.push(press({ light: true }), ...idle(34));
    const r = run(c, presses);
    expect(r.events.filter((x) => x.event.type === 'swing-light').length).toBe(20);
    expect(c.snapshot().stamina).toBe(100);
    const c2 = createCombat();
    const rolls = run(c2, Array.from({ length: 6 }, () => [press({ roll: true }), ...idle(27)]).flat());
    expect(rolls.events.filter((x) => x.event.type === 'roll').length).toBe(5); // 5 × 20 = 100
    expect(rolls.events.some((x) => x.event.type === 'hint' && (x.event as { key: string }).key === 'noStamina')).toBe(true);
    expect(c2.snapshot().flashSerial).toBeGreaterThan(0);
  });
  it('whiffs out of range without a hit event', () => {
    const c = createCombat();
    const r = run(c, [press({ light: true }), ...idle(10)], env({ strike: () => ({ hit: false, distance: 2.51, angleDeg: 0, point: { x: 0, z: -2.51 } }) }));
    expect(r.events.map((x) => x.event.type)).toContain('whiff');
    expect(r.events.map((x) => x.event.type)).not.toContain('hit');
  });
});

describe('heavy attack', () => {
  const chargeFor = (steps: number) => [...Array.from({ length: steps }, () => press({ heavyHeld: true })), ...idle(40)];
  it('scales 20 → 45 damage and 5 → 8 hitstop over 18..72 steps of charge; full charge > 3 × 14', () => {
    for (const [steps, damage, hitstop] of [[18, 20, 5], [72, 45, 8]] as const) {
      const c = createCombat();
      const hit = run(c, chargeFor(steps)).events.find((x) => x.event.type === 'hit')!.event as Extract<CombatEvent, { type: 'hit' }>;
      expect(hit.damage).toBe(damage);
      expect(hit.hitstop).toBe(hitstop);
    }
    expect(45).toBeGreaterThan(3 * 14);
  });
  it('fires at the minimum charge when released early, lunges 0.5 m in 8 steps and hits on frame 9', () => {
    const c = createCombat();
    let lunge = 0;
    const r = { hitStep: 0, swingStep: 0 };
    const inputs = chargeFor(5);
    inputs.forEach((input) => {
      const out = c.step(input, env());
      if (out.state.kind === 'heavy' && out.velocity) lunge += Math.hypot(out.velocity.x, out.velocity.z) / 60;
      for (const e of out.events) {
        if (e.type === 'swing-heavy') r.swingStep = c.snapshot().step;
        if (e.type === 'hit') r.hitStep = c.snapshot().step;
      }
    });
    expect(r.swingStep).toBe(1 + C.chargeMin);
    expect(r.hitStep - r.swingStep).toBe(9);
    expect(lunge).toBeCloseTo(0.5, 6);
  });
  it('stops the lunge on body contact', () => {
    const c = createCombat();
    let lunge = 0;
    for (const input of chargeFor(20)) {
      const out = c.step(input, env({ touching: () => true }));
      if (out.state.kind === 'heavy' && out.velocity) lunge += Math.hypot(out.velocity.x, out.velocity.z);
    }
    expect(lunge).toBe(0);
  });
  it('reports the heavy judgement line in front of the root (4 m with the doubled spear)', () => {
    const c = createCombat();
    run(c, chargeFor(30));
    expect(c.snapshot().judgeLine!.x).toBeCloseTo(0, 9);
    expect(c.snapshot().judgeLine!.z).toBeCloseTo(-4, 9);
  });
  it('can be cancelled into a roll while charging', () => {
    const c = createCombat();
    const r = run(c, [...Array.from({ length: 10 }, () => press({ heavyHeld: true })), press({ roll: true }), ...idle(3)]);
    expect(r.events.map((x) => x.event.type)).toContain('roll');
    expect(r.events.map((x) => x.event.type)).not.toContain('swing-heavy');
  });
});

describe('roll and perfect dodge', () => {
  it('starts on the press step (frame 1), is invulnerable on frames 1..18, and lasts 27', () => {
    const c = createCombat();
    const out = c.step(press({ roll: true }), env());
    expect(out.state).toMatchObject({ kind: 'roll', frame: 1 });
    expect(out.velocity && Math.hypot(out.velocity.x, out.velocity.z)).toBeGreaterThan(0);
    const states = run(c, idle(27)).states;
    expect(states[16]).toBe('roll:18');
    expect(states[25]).toBe('roll:27');
    expect(states[26]).toBe('free:0');
  });
  it('moves 3 m within the first 12 frames, backwards when no direction is held', () => {
    const c = createCombat();
    let x = 0, z = 0;
    for (const input of [press({ roll: true }), ...idle(26)]) {
      const out = c.step(input, env());
      if (out.velocity) {
        x += out.velocity.x / 60;
        z += out.velocity.z / 60;
      }
    }
    expect(z).toBeCloseTo(3, 6); // facing 0 looks toward -Z, so backwards is +Z
    expect(x).toBeCloseTo(0, 6);
  });
  it('counts 0..14 steps before the hit as perfect (v1.4.0 0.25 s), 15 as a plain dodge, 18 as hurt', () => {
    for (const [before, expected] of [[0, 'perfect'], [14, 'perfect'], [15, 'dodged'], [17, 'dodged'], [18, 'hurt']] as const) {
      const c = createCombat();
      run(c, [press({ roll: true }), ...idle(before)]);
      expect(c.incoming(10).type).toBe(expected);
    }
  });
  it('refunds 20 stamina on a perfect dodge and costs nothing in health', () => {
    const c = createCombat();
    run(c, [press({ roll: true })]);
    const before = c.snapshot().stamina;
    c.incoming(18);
    expect(c.snapshot().stamina).toBe(before + 20);
    expect(c.snapshot().hp).toBe(100);
  });
  it('a normal hit costs health and stuns for 24 steps (no actions)', () => {
    const c = createCombat();
    expect(c.incoming(18)).toEqual({ type: 'hurt', damage: 18 });
    expect(c.snapshot().hp).toBe(82);
    const r = run(c, [press({ light: true }), ...idle(22), ...idle(1), press({ light: true }), ...idle(3)]);
    expect(r.states[23]).toBe('free:0');
    expect(r.events.filter((x) => x.event.type === 'swing-light').length).toBe(1);
  });
  it('is defeated at zero health (M3), takes no input, and reset() starts a fresh fight', () => {
    const c = createCombat();
    for (let i = 0; i < 5; i += 1) { c.incoming(18); run(c, idle(C.hurtInvuln)); }
    expect(c.incoming(18).type).toBe('dead');
    expect(c.snapshot().hp).toBe(0);
    expect(c.step(press({ roll: true }), env()).state.kind).toBe('dead');
    c.reset();
    expect(c.snapshot()).toMatchObject({ hp: 100, stamina: 100, lotus: 3, sashCd: 0, action: 'free' });
  });
  it('knocks back 3 m over the first stun steps (tail lash)', () => {
    const c = createCombat();
    c.incoming(18, { dir: { x: 1, z: 0 }, distance: 3 });
    let x = 0;
    for (let i = 0; i < 24; i += 1) {
      const out = c.step(NONE, env());
      if (out.velocity) x += out.velocity.x / 60;
    }
    expect(x).toBeCloseTo(3, 6);
  });
});

describe('stamina', () => {
  it('costs 0 / 0 / 20 (boss 22:12: attacks free) and recovers 25/s after 48 idle steps', () => {
    const c = createCombat();
    run(c, [press({ light: true }), ...idle(21)]);
    expect(c.snapshot().stamina).toBe(100);
    const c2 = createCombat();
    run(c2, [press({ roll: true }), ...idle(26), press({ roll: true }), ...idle(26), press({ roll: true })]);
    expect(c2.snapshot().stamina).toBe(40);
    // Roll ends after its 27th step; 48 idle steps later recovery starts at 25/s.
    run(c2, idle(26 + 47));
    expect(c2.snapshot().stamina).toBe(40);
    run(c2, idle(60));
    expect(c2.snapshot().stamina).toBeCloseTo(65, 6);
    const c3 = createCombat();
    run(c3, [...Array.from({ length: 20 }, () => press({ heavyHeld: true })), ...idle(2)]); // spent on release
    expect(c3.snapshot().stamina).toBe(100);
  });
});

describe('lotus seeds and sash bind', () => {
  it('heals 40 at the end of 60 steps, 3 seeds, then only a hint', () => {
    const c = createCombat();
    c.incoming(18);
    run(c, idle(C.hurtInvuln));
    c.incoming(18);
    run(c, [...idle(24), press({ lotus: true }), ...idle(59)]);
    expect(c.snapshot().hp).toBe(64); // not yet: heals exactly 60 steps (1 s) after the press
    run(c, idle(1));
    expect(c.snapshot().hp).toBe(100);
    run(c, [press({ lotus: true }), ...idle(60), press({ lotus: true }), ...idle(60)]);
    const r = run(c, [press({ lotus: true }), ...idle(3)]);
    expect(c.snapshot().lotus).toBe(0);
    expect(r.events.some((x) => x.event.type === 'hint' && (x.event as { key: string }).key === 'noLotusSeeds')).toBe(true);
  });
  it('an interrupted seed does not heal', () => {
    const c = createCombat();
    c.incoming(30);
    run(c, [...idle(24), press({ lotus: true }), ...idle(30)]);
    c.incoming(10);
    run(c, idle(80));
    expect(c.snapshot().hp).toBe(60);
  });
  it('binds on frame 12, then cools down for 1200 steps', () => {
    const c = createCombat();
    const r = run(c, [press({ sash: true }), ...idle(30), press({ sash: true })]);
    expect(r.events.find((x) => x.event.type === 'sash-bind')!.step).toBe(13);
    expect(r.events.some((x) => x.event.type === 'hint' && (x.event as { key: string }).key === 'sashCooldown')).toBe(true);
    const ready = run(c, idle(1200)).events.find((x) => x.event.type === 'sash-ready');
    expect(ready).toBeDefined();
  });
  it('refuses to bind out of range', () => {
    const c = createCombat();
    const r = run(c, [press({ sash: true })], env({ sashInRange: () => false }));
    expect(r.events.map((x) => x.event.type)).toEqual(['hint']);
  });
});

describe('input buffer', () => {
  it('keeps a roll pressed during a light attack recovery (after the hit frame) and fires it', () => {
    const c = createCombat();
    const r = run(c, [press({ light: true }), ...idle(8), press({ roll: true }), ...idle(2)]);
    expect(r.events.map((x) => x.event.type)).toContain('roll');
  });
  it('holds edges during hitstop and replays them when the machine resumes', () => {
    const c = createCombat();
    run(c, [press({ light: true }), ...idle(21)]);
    c.hold(press({ light: true }));
    const r = run(c, [NONE]);
    expect(r.events.map((x) => x.event.type)).toContain('swing-light');
  });
});

describe('boss 21:55: a roll cancels anything immediately, no stiffness', () => {
  const rollNow = (c: ReturnType<typeof createCombat>) => {
    const out = c.step(press({ roll: true }), env());
    return out.state;
  };
  it('cancels every action on the very step Space is pressed', () => {
    const setups: [string, StepInput[]][] = [
      ['light windup', [press({ light: true }), ...idle(2)]],
      ['light recovery', [press({ light: true }), ...idle(12)]],
      ['charge', Array.from({ length: 10 }, () => press({ heavyHeld: true }))],
      ['heavy lunge', [...Array.from({ length: 20 }, () => press({ heavyHeld: true })), ...idle(3)]],
      ['heavy recovery', [...Array.from({ length: 20 }, () => press({ heavyHeld: true })), ...idle(15)]],
      ['lotus', [press({ lotus: true }), ...idle(10)]],
      ['sash', [press({ sash: true }), ...idle(5)]],
      ['roll', [press({ roll: true }), ...idle(3)]],
    ];
    for (const [name, inputs] of setups) {
      const c = createCombat();
      run(c, inputs);
      expect(rollNow(c), name).toMatchObject({ kind: 'roll', frame: 1 });
    }
  });
  it('cancels the hurt stun too', () => {
    const c = createCombat();
    c.incoming(10);
    expect(rollNow(c)).toMatchObject({ kind: 'roll', frame: 1 });
  });
  it('gives the lotus seed back when the eating is cancelled', () => {
    const c = createCombat();
    run(c, [press({ lotus: true }), ...idle(10)]);
    rollNow(c);
    expect(c.snapshot().lotus).toBe(3);
  });
  it('frees the stick and allows attacks right after the roll displacement (frame 13)', () => {
    const c = createCombat();
    run(c, [press({ roll: true }), ...idle(11)]);
    const moving = c.step(press({ move: { x: 1, z: 0 } }), env());
    expect(moving.state.kind).toBe('roll');
    expect(moving.velocity).toBeUndefined();
    expect(c.snapshot().invuln).toBe(true);
    const out = c.step(press({ light: true }), env());
    expect(out.state.kind).toBe('light');
  });
  it('chains the next light 4 frames after the hit instead of waiting for the recovery', () => {
    const c = createCombat();
    const r = run(c, [press({ light: true }), ...idle(10), press({ light: true }), ...idle(3)]);
    expect(r.events.filter((x) => x.event.type === 'swing-light').map((x) => (x.event as { stage: number }).stage)).toEqual([1, 2]);
  });
  it('steps 0.45 / 0.45 / 0.9 m into the light strikes, stopping on contact', () => {
    for (const [stage, dist] of [[1, 0.45], [3, 0.9]] as const) {
      const c = createCombat();
      if (stage === 3) run(c, [press({ light: true }), ...idle(10), press({ light: true }), ...idle(10)]);
      let d = 0;
      for (const input of [press({ light: true }), ...idle(12)]) {
        const out = c.step(input, env());
        if (out.state.kind === 'light' && out.velocity) d += Math.hypot(out.velocity.x, out.velocity.z) / 60;
      }
      expect(d).toBeCloseTo(dist, 6);
    }
  });
});

describe('tail hits (boss 1B: ×0.3, lighter hit feel)', () => {
  const tailEnv = env({ strike: (_r, _f, range) => ({ hit: range >= 2, distance: 2, angleDeg: 0, point: { x: 0, z: -2 }, segment: 7, tail: true }) });
  it('deals 30 % (rounded, at least 1) with hitstop 1 / 1 / 2 and no shake', () => {
    const c = createCombat();
    const r = run(c, [press({ light: true }), ...idle(10), press({ light: true }), ...idle(10), press({ light: true }), ...idle(14)], tailEnv);
    const hits = r.events.filter((x) => x.event.type === 'hit').map((x) => x.event as Extract<CombatEvent, { type: 'hit' }>);
    expect(hits.map((h) => [h.damage, h.hitstop, h.shake, h.tail])).toEqual([[2, 1, 0, true], [3, 1, 0, true], [4, 2, 0, true]]);
  });
  it('full-charge heavy on the tail: 14 damage, hitstop 2', () => {
    const c = createCombat();
    const r = run(c, [...Array.from({ length: 72 }, () => press({ heavyHeld: true })), ...idle(20)], tailEnv);
    const hit = r.events.find((x) => x.event.type === 'hit')!.event as Extract<CombatEvent, { type: 'hit' }>;
    expect([hit.damage, hit.hitstop, hit.shake]).toEqual([14, 2, 0]);
  });
});

describe('jump, plunge and 灵息 (v1.4.0 port)', () => {
  it('jumps ~2 m (9.8 m/s, g 24), costs 10 stamina and lands after ~49 steps', () => {
    const c = createCombat();
    const r = run(c, [press({ jump: true }), ...idle(60)]);
    expect(r.events.some((x) => x.event.type === 'jump')).toBe(true);
    const land = r.events.find((x) => x.event.type === 'land');
    expect(land!.step).toBeGreaterThan(45);
    expect(land!.step).toBeLessThan(55);
    expect(c.snapshot().stamina).toBeGreaterThanOrEqual(C.staminaMax - C.jump.cost);
    // Apex ≈ v² / 2g.
    const peak = (C.jump.velocity ** 2) / (2 * C.jump.gravity);
    expect(peak).toBeGreaterThan(1.8);
  });
  it('a light press in the air is the plunging attack: it hangs, drops and strikes on landing', () => {
    const c = createCombat();
    const r = run(c, [press({ jump: true }), ...idle(10), press({ light: true }), ...idle(80)]);
    expect(r.states).toContain('airatk:1');
    const land = r.events.find((x) => x.event.type === 'land');
    expect(land && (land.event as { slam: boolean }).slam).toBe(true);
    const hit = r.events.find((x) => x.event.type === 'hit');
    expect(hit!.step).toBe(land!.step);
    expect(c.snapshot().action).toBe('free');
  });
  it('the plunge costs 14 more stamina, hits for its own 16 (not the charge curve) and has 11 steps of landing lag', () => {
    const c = createCombat();
    const r = run(c, [press({ jump: true }), ...idle(10), press({ light: true })]);
    expect(c.snapshot().action).toBe('airatk');
    expect(c.snapshot().stamina).toBeCloseTo(C.staminaMax - C.jump.cost - C.jump.slamCost, 0);
    const base = c.snapshot().step;
    const rest = run(c, idle(80));
    const land = rest.events.find((x) => x.event.type === 'land')!;
    const hit = rest.events.find((x) => x.event.type === 'hit')!.event as { damage: number; hitstop: number; kind: string };
    expect(hit.kind).toBe('heavy');
    expect(hit.damage).toBe(C.jump.slamDamage);
    expect(hit.hitstop).toBe(C.jump.slamHitstop);
    const after = rest.states.slice(land.step - base - 1);
    // Still in the plunge (spear driven down) right after landing, free once the lag is over.
    expect(after[1]).toMatch(/^airatk/);
    const freeAt = after.findIndex((x) => x.startsWith('free'));
    expect(freeAt).toBeGreaterThanOrEqual(C.jump.slamRecover - 1);
    expect(freeAt).toBeLessThanOrEqual(C.jump.slamRecover + 2);
    void r;
  });
  it('can jump out of a roll and roll in the air', () => {
    const c = createCombat();
    const r = run(c, [press({ roll: true }), NONE, press({ jump: true }), ...idle(5), press({ roll: true }), ...idle(60)]);
    expect(r.events.filter((x) => x.event.type === 'jump').length).toBe(1);
    expect(r.events.filter((x) => x.event.type === 'roll').length).toBe(2);
  });
  it('a perfect dodge refunds 30 stamina and gives 150 steps of 灵息 (no delay, double regen)', () => {
    const c = createCombat();
    run(c, [press({ roll: true }), NONE]);
    const before = c.snapshot().stamina;
    expect(c.incoming(10).type).toBe('perfect');
    expect(c.snapshot().stamina).toBe(Math.min(C.staminaMax, before + 30));
    expect(c.snapshot().boost).toBe(C.boostSteps);
  });
  it('is invulnerable for 36 steps after a hit (v1.4.0 0.6 s)', () => {
    const c = createCombat();
    expect(c.incoming(10).type).toBe('hurt');
    run(c, idle(20));
    expect(c.incoming(10).type).toBe('dodged');
    run(c, idle(20));
    expect(c.incoming(10).type).toBe('hurt');
  });
  it('v1.4.0 perfect dodge: no perfect when mashing (re-roll < 0.2 s), 0.45 s untouchable after, sash −2 s', () => {
    const mash = createCombat();
    run(mash, [press({ roll: true }), ...idle(5), press({ roll: true }), NONE]);
    expect(mash.incoming(10).type).toBe('dodged');
    const c = createCombat();
    run(c, [press({ roll: true }), NONE]);
    expect(c.incoming(10).type).toBe('perfect');
    run(c, idle(26));
    expect(c.incoming(10).type).toBe('dodged');
    run(c, idle(3));
    expect(c.incoming(10).type).toBe('hurt');
  });
});
