/**
 * 东海三太子 · 敖丙 — the v1.4.0 boss AI (`chooseAttack` / `attackSteps` / `updateBossAttack` /
 * `damageBoss` / `iceSpikes` / `spawnFireRing`), ported to fixed 60 Hz steps and driving the long
 * dragon body (boss ruling 11-06 17:11: the dragon model, 敖丙's moves and effects).
 *
 * The head is 敖丙's "body position": it chases, faces, slashes, spins, thrusts and leaps; the rest of
 * the 18 m body trails behind it, floating low over the stage with a slow travelling bob — the same
 * height band as Nezha's hover (both close to the ground).
 *
 * Phase 1: 三段连斩 (two slashes + a smash), 回旋横扫 (a full spin), 突进 (one line thrust).
 * Phase 2 「龙化 · 万龙甲」 at half health: the combo gains an ice slam (冰棱震地 — ice spikes erupt
 * round it), the spin a second, wider spin with spikes, the thrust becomes three (寒潮连突), and the
 * 龙跃 leap lands on Nezha and sends out an expanding ice ring (冰环) that she must jump.
 * 「破势」: hits build poise; a full bar staggers it for 2.1 s (damage × 1.35 while staggered).
 *
 * Numbers: v1.4.0 seconds × 60, distances × LEVEL_SCALE (the stage is 0.86 ×), damage ÷ 3 (its Nezha has
 * 300 HP, ours 100), poise from our damage (light × 1.2, heavy × 1.8 ≈ its 10 / 28+ per hit).
 * Jump checks use its heights unscaled (our jump is its jump: 9.8 m/s, g 24).
 */
import { ARENA } from '../shared/layout.ts';
import { LEVEL_SCALE as S } from '../shared/sea-layout.ts';
import {
  angleOf,
  clone,
  dirOf,
  discHull,
  followChain,
  lerp,
  POINTS,
  radius,
  smooth,
  STEP,
  WAVE_HZ,
  withWave,
  wrap,
  type P3,
  type V2,
  type Zone,
} from './body.ts';
import { INTRO, introHead } from './brain.ts';

export const AOBING = Object.freeze({
  hpMax: 600,
  /** Underside of the body above the stage = Nezha's idle hover (v1.4.0 0.58 × 0.86). */
  hover: 0.5,
  bobAmp: 0.09,
  bobHz: 0.5,
  /** Chase (v1.4.0 speed [4.0, 5.2] m/s, ×1.25 beyond 10 m; strafes 1.3 m/s inside 3.8 m). */
  speed1: 4.0 * S,
  speed2: 5.2 * S,
  near: 3.8 * S,
  strafe: 1.3 * S,
  turn1: 2.8,
  turn2: 3.6,
  /** Cooldown after an attack (s, random range) per phase. */
  cd1: [0.8, 1.7] as const,
  cd2: [0.35, 0.95] as const,
  /** 破势: poise bar per phase, stagger length, damage multiplier while staggered, decay. */
  poise1: 130,
  poise2: 160,
  staggerSteps: 126,
  staggerMult: 1.35,
  poiseDecayAfter: 180,
  poiseDecayPerStep: 20 / 60,
  /** Phase 2 deals 12 % more (v1.4.0 resolvePlayerHit). */
  p2Damage: 1.12,
  /** Phase change: first time this session 570 steps (lines), later 240; the roar lands at 48 (v1.4.0 0.8 s). */
  transitionFirst: 570,
  transitionRepeat: 240,
  roarAt: 48,
  roarSteps: 120,
  roarWave: 12 * S,
  deathSteps: 180,
  deathEyesClose: 150,
  /** The head may roam this far from the centre (the platform edge, its radius kept inside). */
  roam: ARENA.boundary - 0.6,
  /** Nezha's body points that block her (the head and neck, like v1.4.0's boss radius); the tail is passable. */
  blockPoints: 9,
  /** Nezha above these heights dodges (v1.4.0 inArea, unscaled): the spin, the leap, anything. */
  airSpin: 0.75,
  airLeap: 1.3,
  airAny: 2.2,
  airSpike: 1.2,
  airRing: 0.7,
});

export type AnimName = 'slashR' | 'slashL' | 'smash' | 'spin' | 'thrust' | 'leap';
export type MoveName = 'combo' | 'sweep' | 'lunge' | 'leap';
/** Telegraph / hit kinds (audio cue `tell-<kind>`, logs). */
export type AobingKind = 'slash' | 'smash' | 'sweep' | 'thrust' | 'leap' | 'spike' | 'icering';

export interface StepDef {
  readonly anim: AnimName;
  readonly kind: AobingKind;
  readonly wind: number;
  readonly act: number;
  readonly rec: number;
  readonly air?: number;
  readonly shape: 'cone' | 'circle' | 'line' | 'leap';
  readonly range?: number;
  readonly arc?: number;
  readonly radius?: number;
  readonly front?: number;
  readonly width?: number;
  readonly damage: number;
  /** Turn rate toward Nezha in the wind-up (rad/s). */
  readonly track: number;
  /** Forward drift over the strike (m). */
  readonly adv?: number;
  readonly slam?: boolean;
  /** Ice: spikes erupt round the impact (冰棱震地). */
  readonly ice?: boolean;
}

const sec = (s: number) => Math.round(s * 60);
const dmg = (d: number) => Math.round(d / 3);

/** v1.4.0 `attackSteps`, in steps / metres / our damage. */
export function moveSteps(name: MoveName, p2: boolean): StepDef[] {
  const k = p2 ? 0.78 : 1;
  switch (name) {
    case 'combo': {
      const s: StepDef[] = [
        { anim: 'slashR', kind: 'slash', wind: sec(0.72 * k), act: sec(0.16), rec: sec(0.16), shape: 'cone', range: 5.6 * S, arc: 120, damage: dmg(30), track: 5, adv: 3.2 * S },
        { anim: 'slashL', kind: 'slash', wind: sec(0.46 * k), act: sec(0.16), rec: sec(0.18), shape: 'cone', range: 5.6 * S, arc: 120, damage: dmg(30), track: 4.5, adv: 3.2 * S },
        { anim: 'smash', kind: 'smash', wind: sec(0.62 * k), act: sec(0.16), rec: sec(p2 ? 0.3 : 0.95), shape: 'cone', range: 6.3 * S, arc: 44, damage: dmg(42), track: 3.5, adv: 2.4 * S, slam: true },
      ];
      if (p2) s.push({ anim: 'smash', kind: 'smash', wind: sec(0.6), act: sec(0.16), rec: sec(1.0), shape: 'circle', radius: 4.4 * S, front: 3.2 * S, damage: dmg(46), track: 3, adv: 1.5 * S, slam: true, ice: true });
      return s;
    }
    case 'sweep': {
      const s: StepDef[] = [{ anim: 'spin', kind: 'sweep', wind: sec(1.1 * k), act: sec(0.45), rec: sec(p2 ? 0.25 : 1.0), shape: 'circle', radius: 6.6 * S, damage: dmg(48), track: 1.5 }];
      if (p2) s.push({ anim: 'spin', kind: 'sweep', wind: sec(0.62), act: sec(0.45), rec: sec(1.0), shape: 'circle', radius: 8.4 * S, damage: dmg(52), track: 1, ice: true });
      return s;
    }
    case 'lunge': {
      const n = p2 ? 3 : 1;
      return Array.from({ length: n }, (_, i): StepDef => ({ anim: 'thrust', kind: 'thrust', wind: sec(i === 0 ? 0.95 * k : 0.55), act: sec(0.38), rec: sec(i === n - 1 ? 0.95 : 0.1), shape: 'line', width: 3.0 * S, damage: dmg(52), track: 6 }));
    }
    case 'leap':
      return [{ anim: 'leap', kind: 'leap', wind: sec(0.55), air: sec(0.95), act: sec(0.12), rec: sec(1.25), shape: 'leap', radius: 4.6 * S, damage: dmg(62), track: 4 }];
  }
}

/** Ice spikes (v1.4.0 iceSpikes): 0.55 s ring warning, erupt, stand 1.1 s; 0.8 m, 26 dmg. */
export const SPIKE = Object.freeze({ warn: 33, stand: 66, fade: 18, radius: 0.8 * S, damage: dmg(26) });
/** Ice ring (v1.4.0 spawnFireRing on the phase-2 leap): grows 10.5 m/s to 17 m; ±0.55 m band, 34 dmg. */
export const ICE_RING = Object.freeze({ maxR: 17 * S, speed: 10.5 * S, band: 0.55, damage: dmg(34) });

/** Head offsets per animation (forward, lateral right, up), wind-up end W, strike end S. */
type Off = readonly [number, number, number];
const ANIM: Record<AnimName, { readonly W: Off; readonly S: Off; readonly AIR?: Off }> = {
  slashR: { W: [-0.8, 1.9, 1.3], S: [2.4, -2.2, 0.2] },
  slashL: { W: [-0.8, -1.9, 1.3], S: [2.4, 2.2, 0.2] },
  smash: { W: [-1.3, 0, 3.2], S: [3.0, 0, -0.45] },
  spin: { W: [-0.6, 1.6, 0.6], S: [0, 2.6, 0.2] },
  thrust: { W: [-1.7, 0, -0.25], S: [0.8, 0, 0] },
  leap: { W: [-0.9, 0, -0.35], AIR: [0.6, 0, 1.0], S: [1.2, 0, -0.4] },
};
const ROAR: Off = [-0.6, 0, 2.8];
const STAG: Off = [-0.3, 0, -0.45];
const ZERO: Off = [0, 0, 0];

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mixOff = (a: Off, b: Off, u: number): Off => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const turnTo = (from: number, to: number, max: number) => from + clamp(wrap(to - from), -max, max);

/** Warning / damage shapes as convex polygons (the existing warning meshes and zone tests take them). */
export function coneZone(c: V2, facing: number, range: number, arcDeg: number): Zone {
  const half = (arcDeg * Math.PI) / 360;
  const pts = [{ x: c.x, z: c.z, r: 0 }];
  for (let i = 0; i <= 16; i += 1) {
    const d = dirOf(facing - half + (2 * half * i) / 16);
    pts.push({ x: c.x + d.x * range, z: c.z + d.z * range, r: 0 });
  }
  return { kind: 'poly', poly: discHull(pts, 1) };
}
export function circleZone(c: V2, r: number): Zone {
  return { kind: 'poly', poly: discHull([{ x: c.x, z: c.z, r }], 40) };
}
export function lineZone(from: V2, dir: V2, len: number, width: number): Zone {
  const rx = dir.z * (width / 2), rz = -dir.x * (width / 2);
  const e = { x: from.x + dir.x * len, z: from.z + dir.z * len };
  return { kind: 'poly', poly: discHull([{ x: from.x + rx, z: from.z + rz, r: 0 }, { x: from.x - rx, z: from.z - rz, r: 0 }, { x: e.x + rx, z: e.z + rz, r: 0 }, { x: e.x - rx, z: e.z - rz, r: 0 }], 1) };
}

export type AobingMode = 'lurk' | 'intro' | 'chase' | 'attack' | 'stagger' | 'roar' | 'dead';
export type Phase = 'wind' | 'air' | 'act' | 'rec';

export type AobingEvent =
  | { readonly type: 'telegraph'; readonly kind: AobingKind; readonly zone: Zone; readonly hitStep: number; readonly forced: boolean; readonly second: boolean }
  | { readonly type: 'hit'; readonly kind: AobingKind; readonly zone: Zone; readonly damage: number; readonly maxAir: number; readonly knock?: { readonly dir: V2; readonly distance: number } }
  | { readonly type: 'fx'; readonly fx: 'slam' | 'spikes' | 'icering' | 'roar' | 'swing' | 'dash' | 'leap'; readonly at: V2; readonly radius: number }
  | { readonly type: 'spikes'; readonly spikes: readonly { readonly x: number; readonly z: number; readonly delay: number }[] }
  | { readonly type: 'break' }
  | { readonly type: 'opening-end' }
  | { readonly type: 'phase'; readonly steps: number }
  | { readonly type: 'transition-end' }
  | { readonly type: 'breach'; readonly at: V2 }
  | { readonly type: 'intro-end' }
  | { readonly type: 'dead' }
  | { readonly type: 'dead-done' };

export interface AobingInput {
  readonly nezha: V2;
  readonly engaged: boolean;
}

export interface AobingOptions {
  readonly hpMax?: number;
  /** Difficulty knob: the attack gap scales the cooldown (60 = v1.4.0). */
  readonly minGap?: number;
  readonly start?: 'fight' | 'lurk';
  readonly phase2?: boolean;
  readonly hp?: number;
  readonly transitionSeen?: boolean;
  readonly seed?: number;
}

export type DamageResult = 'ignored' | 'hurt' | 'phase' | 'dead';

interface Spike { x: number; z: number; t: number; done: boolean }
interface Ring { c: V2; r: number; done: boolean }

export function createAobing(options: AobingOptions = {}) {
  const hpMax = options.hpMax ?? AOBING.hpMax;
  const gapScale = (options.minGap ?? 60) / 60;
  let seed = (options.seed ?? 1106) >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const lurking = options.start === 'lurk';
  let mode: AobingMode = lurking ? 'lurk' : 'chase';
  let step = 0;
  let time = 0;
  let hp = options.hp ?? hpMax;
  let phase2 = options.phase2 === true;
  let transitionSeen = options.transitionSeen === true;
  let transitionLen = 0;
  let roarK = 0;
  let introK = 0;
  let breached = false;
  let deathK = 0;
  let deathFrom: P3[] = [];
  let staggerK = 0;
  let poise = 0;
  let poiseIdle = 0;
  let breaks = 0;
  let cd = 36;
  let strafe: 1 | -1 = 1, strafeT = 0;
  const last: MoveName[] = [];
  let since = 0;
  // Ground state (v1.4.0 B.pos / B.facing / B.lift): the head.
  let pos: V2 = { x: 0, z: -12 * S };
  let facing = 0;
  let lift = 0;
  let wavePhase = 0;
  let amp = 1;
  const spikes: Spike[] = [];
  const rings: Ring[] = [];
  let atk: {
    name: MoveName; steps: StepDef[]; i: number; sp: Phase; st: number; hitDone: boolean;
    zone: Zone | null; target: V2; from: V2; dir: V2; len: number; zoneSerial: number; forced: boolean;
  } | undefined;
  let zoneSerial = 0;
  const log: { step: number; move: MoveName; kind: AobingKind; i: number; distance: number; phase: 1 | 2 }[] = [];

  const base = (i: number, t: number) => AOBING.hover + radius(i) + AOBING.bobAmp * Math.sin(2 * Math.PI * AOBING.bobHz * t - i * 0.35);
  const straight = (head: V2, dir: V2): P3[] => Array.from({ length: POINTS }, (_, i): P3 => [head.x - dir.x * 0.45 * i, base(i, 0), head.z - dir.z * 0.45 * i]);
  let chain: P3[] = straight(pos, dirOf(facing));
  /** Lurk / intro body: trailing the scripted head path (the M4 intro, now in the sky round the stage). */
  const introChain = (k: number): P3[] => {
    const pts: P3[] = Array.from({ length: POINTS }, (_, i): P3 => {
      const q = dirOf(INTRO.orbitFrom - (0.45 * i) / INTRO.orbitRadius);
      return [q.x * INTRO.orbitRadius, INTRO.orbitY, q.z * INTRO.orbitRadius];
    });
    for (let s = 1; s <= Math.min(k, INTRO.breachEnd); s += 1) followChain(pts, introHead(s));
    return pts;
  };
  if (lurking) chain = introChain(0);
  else {
    pos = { x: 0, z: -12 * S };
    facing = 0;
    chain = straight(pos, dirOf(facing));
  }

  const p2 = () => phase2;
  const constrainPos = (p: V2): V2 => {
    const r = Math.hypot(p.x, p.z);
    return r <= AOBING.roam ? p : { x: (p.x / r) * AOBING.roam, z: (p.z / r) * AOBING.roam };
  };

  const chooseMove = (d: number): MoveName | null => {
    const opts: [MoveName, number][] = [];
    if (d < 6.8 * S) opts.push(['combo', 3], ['sweep', d < 4.8 * S ? 2.2 : 1]);
    if (d >= 5.5 * S) opts.push(['lunge', d > 9 * S ? 3.5 : 1.0]);
    if (phase2 && d > 4 * S) opts.push(['leap', d > 8 * S ? 2.6 : 1.4]);
    if (!opts.length) return null;
    for (const o of opts) o[1] *= Math.pow(0.35, last.filter((n) => n === o[0]).length);
    const sum = opts.reduce((s, o) => s + o[1], 0);
    let r = random() * sum;
    for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
    return opts[0]![0];
  };

  const zoneOf = (s: StepDef, nezha: V2): Zone => {
    const f = dirOf(facing);
    if (s.shape === 'cone') return coneZone(pos, facing, s.range!, s.arc!);
    if (s.shape === 'circle') return circleZone(s.front ? { x: pos.x + f.x * s.front, z: pos.z + f.z * s.front } : pos, s.radius!);
    if (s.shape === 'leap') return circleZone(atk!.target, s.radius!);
    // Line: from the head along its facing, 9–19 m (× 0.86) depending on how far Nezha is.
    const d = Math.hypot(nezha.x - pos.x, nezha.z - pos.z);
    atk!.len = clamp(d + 4 * S, 9 * S, 19 * S);
    return lineZone(pos, f, atk!.len, s.width!);
  };

  const startStep = (nezha: V2, events: AobingEvent[]) => {
    const a = atk!;
    const s = a.steps[a.i]!;
    a.sp = 'wind';
    a.st = 0;
    a.hitDone = false;
    if (s.shape === 'leap') { a.target = { x: nezha.x, z: nezha.z }; a.from = { ...pos }; }
    a.zone = zoneOf(s, nezha);
    a.zoneSerial = ++zoneSerial;
    log.push({ step, move: a.name, kind: s.kind, i: a.i, distance: Math.hypot(nezha.x - pos.x, nezha.z - pos.z), phase: phase2 ? 2 : 1 });
    while (log.length > 40) log.shift();
    events.push({ type: 'telegraph', kind: s.kind, zone: a.zone, hitStep: hitStepOf(s), forced: false, second: a.i > 0 });
  };
  const hitStepOf = (s: StepDef) => s.wind + (s.air ?? 0) + (s.shape === 'line' ? Math.round(s.act / 2) : Math.round(s.act * (s.anim === 'spin' ? 0.35 : 0.45)));

  const startMove = (name: MoveName, nezha: V2, events: AobingEvent[]) => {
    atk = { name, steps: moveSteps(name, phase2), i: 0, sp: 'wind', st: 0, hitDone: false, zone: null, target: { ...nezha }, from: { ...pos }, dir: dirOf(facing), len: 0, zoneSerial: 0, forced: false };
    last.unshift(name);
    last.length = Math.min(last.length, 2);
    mode = 'attack';
    since = 0;
    startStep(nezha, events);
  };

  const endMove = () => {
    atk = undefined;
    mode = 'chase';
    const [a, b] = phase2 ? AOBING.cd2 : AOBING.cd1;
    cd = Math.round((a + random() * (b - a)) * 60 * gapScale);
  };

  const hit = (s: StepDef, zone: Zone, events: AobingEvent[], knockFrom?: V2) => {
    const damage = Math.round(s.damage * (phase2 ? AOBING.p2Damage : 1));
    const maxAir = s.anim === 'spin' ? AOBING.airSpin : s.shape === 'leap' ? AOBING.airLeap : AOBING.airAny;
    events.push({ type: 'hit', kind: s.kind, zone, damage, maxAir, ...(knockFrom ? { knock: { dir: knockFrom, distance: 0.6 } } : {}) });
  };

  const spawnSpikes = (c: V2, r: number, events: AobingEvent[]) => {
    const n = 7 + Math.floor(r / S);
    const list: { x: number; z: number; delay: number }[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = random() * Math.PI * 2, d = (1.5 + random() * (r / S + 3)) * S;
      const p = constrainPos({ x: c.x + Math.sin(a) * d, z: c.z + Math.cos(a) * d });
      const delay = Math.round(random() * 9);
      spikes.push({ x: p.x, z: p.z, t: -delay, done: false });
      list.push({ x: p.x, z: p.z, delay });
    }
    events.push({ type: 'spikes', spikes: list });
  };

  const updateHazards = (nezha: V2, events: AobingEvent[]) => {
    for (let i = spikes.length - 1; i >= 0; i -= 1) {
      const s = spikes[i]!;
      s.t += 1;
      const u = s.t - SPIKE.warn;
      if (u >= 0 && u < 9 && !s.done) {
        // Erupting: Nezha within its radius is struck (centre-point test, like v1.4.0's 0.8 m).
        if (Math.hypot(nezha.x - s.x, nezha.z - s.z) < SPIKE.radius) {
          s.done = true;
          events.push({ type: 'hit', kind: 'spike', zone: { kind: 'ring', c: { x: s.x, z: s.z }, inner: 0, outer: SPIKE.radius }, damage: Math.round(SPIKE.damage * AOBING.p2Damage), maxAir: AOBING.airSpike });
        }
      }
      if (u > SPIKE.stand + SPIKE.fade) spikes.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const g = rings[i]!;
      g.r += ICE_RING.speed * STEP;
      if (!g.done) {
        const d = Math.hypot(nezha.x - g.c.x, nezha.z - g.c.z);
        if (Math.abs(d - g.r) < ICE_RING.band) {
          g.done = true;
          events.push({ type: 'hit', kind: 'icering', zone: { kind: 'ring', c: g.c, inner: g.r - ICE_RING.band, outer: g.r + ICE_RING.band }, damage: Math.round(ICE_RING.damage * AOBING.p2Damage), maxAir: AOBING.airRing });
        }
      }
      if (g.r >= ICE_RING.maxR) rings.splice(i, 1);
    }
  };

  const updateAttack = (nezha: V2, events: AobingEvent[]) => {
    const a = atk!;
    const s = a.steps[a.i]!;
    a.st += 1;
    const angTo = angleOf(nezha.x - pos.x, nezha.z - pos.z);
    const d = Math.hypot(nezha.x - pos.x, nezha.z - pos.z);
    if (a.sp === 'wind') {
      if (a.st < s.wind - 13) facing = turnTo(facing, angTo, s.track * STEP);
      if (s.shape === 'leap') {
        const k = Math.min(1, 4 * STEP);
        a.target = { x: lerp(a.target.x, nezha.x, k), z: lerp(a.target.z, nezha.z, k) };
      }
      // The warning follows the turn (v1.4.0 placeTele every frame) until the last 13 steps.
      if (a.st < s.wind - 12) { a.zone = zoneOf(s, nezha); a.zoneSerial = ++zoneSerial; }
      if (a.st >= s.wind) {
        a.st = 0;
        if (s.shape === 'leap') {
          a.sp = 'air';
          a.from = { ...pos };
          events.push({ type: 'fx', fx: 'leap', at: { ...pos }, radius: 1.5 });
        } else {
          a.sp = 'act';
          if (s.shape === 'line') {
            a.from = { ...pos };
            a.dir = dirOf(facing);
            a.zone = lineZone(a.from, a.dir, a.len, s.width!);
            a.zoneSerial = ++zoneSerial;
            events.push({ type: 'fx', fx: 'dash', at: { ...pos }, radius: 1 });
          } else events.push({ type: 'fx', fx: 'swing', at: { ...pos }, radius: 1 });
        }
      }
      return;
    }
    if (a.sp === 'air') {
      const u = a.st / s.air!;
      if (u < 0.55) {
        const tx = nezha.x - a.target.x, tz = nezha.z - a.target.z, l = Math.hypot(tx, tz);
        if (l > 0.01) { const k = Math.min(1, (6 * S * STEP) / l); a.target = { x: a.target.x + tx * k, z: a.target.z + tz * k }; }
      }
      a.target = constrainPos(a.target);
      pos = { x: lerp(a.from.x, a.target.x, ease(Math.min(1, u))), z: lerp(a.from.z, a.target.z, ease(Math.min(1, u))) };
      lift = Math.sin(Math.min(1, u) * Math.PI) * 5.5 * S;
      facing = turnTo(facing, angleOf(a.target.x - a.from.x, a.target.z - a.from.z), 6 * STEP);
      a.zone = circleZone(a.target, s.radius!);
      a.zoneSerial = ++zoneSerial;
      if (u >= 1) { lift = 0; a.sp = 'act'; a.st = 0; }
      return;
    }
    if (a.sp === 'act') {
      if (s.shape === 'line') {
        const v = a.len / s.act;
        const prev = { ...pos };
        pos = constrainPos({ x: pos.x + a.dir.x * v, z: pos.z + a.dir.z * v });
        if (!a.hitDone) {
          // Judged as the head passes her along the line (or at its end).
          const along = (pos.x - a.from.x) * a.dir.x + (pos.z - a.from.z) * a.dir.z;
          const her = (nezha.x - a.from.x) * a.dir.x + (nezha.z - a.from.z) * a.dir.z;
          const stalled = Math.hypot(pos.x - prev.x, pos.z - prev.z) < v * 0.5;
          if (along >= her - 0.3 || a.st >= s.act || stalled) {
            a.hitDone = true;
            hit(s, a.zone!, events, a.dir);
          }
        }
      } else if (!a.hitDone && a.st >= Math.round(s.act * (s.anim === 'spin' ? 0.35 : 0.45))) {
        a.hitDone = true;
        const zone = a.zone!;
        hit(s, zone, events);
        const f = dirOf(facing);
        const c = s.shape === 'leap' ? a.target : s.front ? { x: pos.x + f.x * s.front, z: pos.z + f.z * s.front } : s.slam ? { x: pos.x + f.x * (s.range ?? 3) * 0.6, z: pos.z + f.z * (s.range ?? 3) * 0.6 } : pos;
        if (s.slam || s.shape === 'leap') events.push({ type: 'fx', fx: 'slam', at: { ...c }, radius: s.radius ?? 4 * S });
        if (s.ice) {
          spawnSpikes(s.front ? c : pos, s.radius ?? 5 * S, events);
          events.push({ type: 'fx', fx: 'spikes', at: { ...(s.front ? c : pos) }, radius: s.radius ?? 5 * S });
        }
        if (s.shape === 'leap' && phase2) {
          rings.push({ c: { ...a.target }, r: 1 * S, done: false });
          events.push({ type: 'fx', fx: 'icering', at: { ...a.target }, radius: ICE_RING.maxR });
        }
      }
      if (s.adv && d > 1.4 + 0.35 + 0.8) {
        const f = dirOf(facing);
        const k = (s.adv / s.act) * (a.st < s.act * 0.6 ? 1 : 0.3);
        pos = constrainPos({ x: pos.x + f.x * k, z: pos.z + f.z * k });
      }
      if (a.st >= s.act) { a.sp = 'rec'; a.st = 0; }
      return;
    }
    // Recovery: the punish window.
    if (a.st >= s.rec) {
      if (a.i < a.steps.length - 1) { a.i += 1; startStep(nezha, events); }
      else { endMove(); events.push({ type: 'opening-end' }); }
    }
  };

  /** Head offset for the current animation (v1.4.0 bossAttackPose, as head motion). */
  const headOffset = (): { off: Off; orbit?: number } => {
    if (mode === 'roar') return { off: roarK < AOBING.roarAt ? STAG : ROAR };
    if (mode === 'stagger') return { off: [STAG[0], STAG[1] + 0.12 * Math.sin(time * 40), STAG[2]] };
    if (mode !== 'attack' || !atk) return { off: ZERO };
    const s = atk.steps[atk.i]!;
    const A = ANIM[s.anim];
    if (atk.sp === 'wind') {
      const u = ease(Math.min(1, atk.st / (s.wind * 0.7)));
      const o = mixOff(ZERO, A.W, u);
      // 蓄势颤动 (the wind-up tremble).
      return { off: atk.st > s.wind * 0.7 ? [o[0], o[1], o[2] + 0.04 * Math.sin(time * 45)] : o };
    }
    if (atk.sp === 'air') return { off: A.AIR ?? A.W };
    if (atk.sp === 'act') {
      const u = ease(Math.min(1, atk.st / (s.act * 0.6)));
      if (s.anim === 'spin') return { off: A.S, orbit: Math.PI * 2 * ease(Math.min(1, atk.st / s.act)) };
      return { off: mixOff(A.W, A.S, u) };
    }
    return { off: mixOff(A.S, ZERO, ease(Math.min(1, atk.st / Math.max(6, s.rec)))) };
  };

  /** Move the head toward its pose and let the body trail and settle into the low floating band. */
  const moveBody = () => {
    const { off, orbit } = headOffset();
    const f = dirOf(facing);
    const r = { x: f.z, z: -f.x };
    let tx = pos.x + f.x * off[0] + r.x * off[1];
    let tz = pos.z + f.z * off[0] + r.z * off[1];
    if (orbit !== undefined) {
      // 回旋横扫: the head whirls round the centre at 2.6 m, the body trailing into a ring.
      const a = facing + Math.PI / 2 + orbit;
      const d = dirOf(a);
      tx = pos.x + d.x * 2.6;
      tz = pos.z + d.z * 2.6;
    }
    const ty = Math.max(radius(0) + 0.05, base(0, time) + off[2] + lift);
    const rate = mode === 'attack' ? (atk?.sp === 'act' ? 30 : 22) : mode === 'roar' || mode === 'stagger' ? 6 : 14;
    const k = 1 - Math.exp(-rate * STEP);
    const h = chain[0]!;
    followChain(chain, [h[0] + (tx - h[0]) * k, h[1] + (ty - h[1]) * k, h[2] + (tz - h[2]) * k]);
    // The body floats back into the low band behind the head (the neck follows the head more freely).
    for (let i = 1; i < POINTS; i += 1) {
      const p = chain[i]!;
      const w = i < 6 ? 0.04 : 0.14;
      p[1] += (base(i, time) - p[1]) * w;
    }
    wavePhase += 2 * Math.PI * WAVE_HZ * STEP;
    const wantAmp = mode === 'chase' ? 1 : mode === 'attack' ? 0.3 : 0.5;
    amp += (wantAmp - amp) * 0.08;
  };

  const basePoints = (): P3[] => {
    if (mode === 'dead') {
      const up = smooth(deathK / 60), down = smooth((deathK - 60) / 90);
      return deathFrom.map((p, i): P3 => {
        const y = p[1] + (i < 8 ? (4 - p[1]) * (1 - i / 8) * up : 0);
        return [p[0], lerp(y, radius(i) + 0.05, down), p[2]];
      });
    }
    if (mode === 'lurk' || mode === 'intro') return withWave(chain, wavePhase, 1);
    return withWave(chain, wavePhase, amp);
  };

  const enterChase = () => {
    mode = 'chase';
    const h = chain[0]!;
    pos = constrainPos({ x: h[0], z: h[2] });
  };

  return {
    step(input: AobingInput): AobingEvent[] {
      const events: AobingEvent[] = [];
      step += 1;
      time += STEP;
      const nz = input.nezha;
      if (mode === 'lurk') {
        wavePhase += 2 * Math.PI * WAVE_HZ * STEP;
        // Waiting high over the sea: a slow bob so the shape breathes.
        for (let i = 0; i < POINTS; i += 1) chain[i]![1] = INTRO.orbitY + 0.25 * Math.sin(2 * Math.PI * AOBING.bobHz * time - i * 0.35);
        return events;
      }
      if (mode === 'intro') {
        introK += 1;
        wavePhase += 2 * Math.PI * WAVE_HZ * STEP;
        if (introK <= INTRO.breachEnd) followChain(chain, introHead(introK));
        else moveBody();
        if (!breached && introK > INTRO.sealEnd && Math.hypot(chain[0]![0], chain[0]![2]) <= ARENA.wallRadius) {
          breached = true;
          events.push({ type: 'breach', at: { x: chain[0]![0], z: chain[0]![2] } });
        }
        if (introK === INTRO.breachEnd) {
          const h = chain[0]!;
          pos = constrainPos({ x: h[0], z: h[2] });
          facing = angleOf(nz.x - pos.x, nz.z - pos.z);
        }
        if (introK >= INTRO.end) {
          enterChase();
          cd = 36;
          events.push({ type: 'intro-end' });
        }
        return events;
      }
      if (mode === 'dead') {
        deathK += 1;
        if (deathK === AOBING.deathSteps) events.push({ type: 'dead-done' });
        return events;
      }
      updateHazards(nz, events);
      poiseIdle += 1;
      if (poiseIdle > AOBING.poiseDecayAfter) poise = Math.max(0, poise - AOBING.poiseDecayPerStep);
      const d = Math.hypot(nz.x - pos.x, nz.z - pos.z);
      const angTo = angleOf(nz.x - pos.x, nz.z - pos.z);
      switch (mode) {
        case 'chase': {
          since += 1;
          facing = turnTo(facing, angTo, (phase2 ? AOBING.turn2 : AOBING.turn1) * STEP);
          if (!input.engaged) break;
          cd -= 1;
          strafeT -= 1;
          if (strafeT <= 0) { strafe = random() < 0.5 ? -1 : 1; strafeT = Math.round((1.5 + random() * 2) * 60); }
          const align = Math.max(0, Math.cos(wrap(facing - angTo)));
          if (d > AOBING.near) {
            const sp = (phase2 ? AOBING.speed2 : AOBING.speed1) * (d > 10 * S ? 1.25 : 1) * align;
            const f = dirOf(facing);
            pos = constrainPos({ x: pos.x + f.x * sp * STEP, z: pos.z + f.z * sp * STEP });
          } else {
            const l = d || 1;
            const side = { x: ((nz.z - pos.z) / l) * strafe, z: (-(nz.x - pos.x) / l) * strafe };
            pos = constrainPos({ x: pos.x + side.x * AOBING.strafe * STEP, z: pos.z + side.z * AOBING.strafe * STEP });
          }
          if (cd <= 0) {
            const m = chooseMove(d);
            if (m) startMove(m, nz, events);
            else cd = 18;
          }
          break;
        }
        case 'attack':
          if (!input.engaged) { endMove(); break; }
          updateAttack(nz, events);
          break;
        case 'stagger':
          staggerK += 1;
          if (staggerK >= AOBING.staggerSteps) { mode = 'chase'; cd = 18; }
          break;
        case 'roar':
          roarK += 1;
          facing = turnTo(facing, angTo, 1.5 * STEP);
          if (roarK === AOBING.roarAt) events.push({ type: 'fx', fx: 'roar', at: { ...pos }, radius: AOBING.roarWave });
          if (roarK >= transitionLen) {
            phase2 = true;
            transitionSeen = true;
            mode = 'chase';
            cd = 24;
            poise = 0;
            events.push({ type: 'transition-end' });
          }
          break;
      }
      moveBody();
      return events;
    },
    points(): P3[] {
      return basePoints();
    },
    beginIntro() {
      if (mode !== 'lurk') return;
      mode = 'intro';
      introK = 0;
      breached = false;
      chain = introChain(0);
    },
    skipIntroTo(k: number) {
      if (mode !== 'intro' || k <= introK) return;
      introK = Math.min(k, INTRO.end - 1);
      chain = introChain(introK);
      if (introK > INTRO.sealEnd) breached = true;
      if (introK >= INTRO.breachEnd) {
        const h = chain[0]!;
        pos = constrainPos({ x: h[0], z: h[2] });
      }
    },
    /** A landed hit (amount = our damage). Builds poise; half health starts the phase change. */
    damage(amount: number): DamageResult {
      if (mode === 'dead' || mode === 'roar' || mode === 'lurk' || mode === 'intro') return 'ignored';
      const v = amount * (mode === 'stagger' ? AOBING.staggerMult : 1);
      poiseIdle = 0;
      const half = Math.ceil(hpMax / 2);
      if (!phase2 && hp - v <= half) {
        hp = half;
        atk = undefined;
        spikes.length = 0;
        rings.length = 0;
        lift = 0;
        mode = 'roar';
        roarK = 0;
        poise = 0;
        transitionLen = transitionSeen ? AOBING.transitionRepeat : AOBING.transitionFirst;
        return 'phase';
      }
      hp = Math.max(0, hp - v);
      if (hp === 0) {
        deathFrom = basePoints();
        mode = 'dead';
        deathK = 0;
        atk = undefined;
        spikes.length = 0;
        rings.length = 0;
        return 'dead';
      }
      // 破势: no poise while staggered or in the strike itself (v1.4.0).
      if (mode !== 'stagger' && !(mode === 'attack' && atk?.sp === 'act')) {
        poise += amount * (amount >= 16 ? 1.8 : 1.2);
        if (poise >= (phase2 ? AOBING.poise2 : AOBING.poise1)) {
          poise = 0;
          atk = undefined;
          lift = 0;
          mode = 'stagger';
          staggerK = 0;
          breaks += 1;
        }
      }
      return 'hurt';
    },
    abort() {
      if (mode === 'attack' || mode === 'stagger') endMove();
      spikes.length = 0;
      rings.length = 0;
      lift = 0;
    },
    vulnerable(): boolean {
      return mode === 'chase' || mode === 'attack' || mode === 'stagger';
    },
    /** Active hazards for the view. */
    hazards() {
      return {
        spikes: spikes.map((s) => ({ x: s.x, z: s.z, t: s.t })),
        rings: rings.map((g) => ({ c: g.c, r: g.r })),
      };
    },
    snapshot() {
      const s = atk ? atk.steps[atk.i] : undefined;
      const kWind = atk && s ? (atk.sp === 'wind' ? atk.st : atk.sp === 'air' ? s.wind + atk.st : atk.sp === 'act' ? s.wind + (s.air ?? 0) + atk.st : null) : null;
      return {
        step,
        mode,
        hp,
        hpMax,
        phase: (phase2 ? 2 : 1) as 1 | 2,
        since,
        move: atk?.name ?? null,
        anim: s?.anim ?? null,
        kind: s?.kind ?? null,
        sp: atk?.sp ?? null,
        st: atk?.st ?? null,
        stepIndex: atk?.i ?? null,
        k: kWind,
        hitStep: s ? hitStepOf(s) : null,
        telegraph: !!atk && !!s && (atk.sp === 'wind' || atk.sp === 'air' || (atk.sp === 'act' && !atk.hitDone)),
        opening: (mode === 'attack' && atk?.sp === 'rec') || mode === 'stagger',
        zone: atk?.zone ?? null,
        zoneSerial: atk?.zoneSerial ?? 0,
        forced: false,
        second: (atk?.i ?? 0) > 0,
        roarK: mode === 'roar' ? roarK : null,
        transitionLen,
        transitionSeen,
        introK: mode === 'intro' ? introK : null,
        deathK,
        poise,
        poiseMax: phase2 ? AOBING.poise2 : AOBING.poise1,
        breaks,
        staggerK: mode === 'stagger' ? staggerK : null,
        pos,
        facing,
        lift,
        cd,
        amp,
        spikes: spikes.length,
        rings: rings.length,
        last: [...last],
        log,
      };
    },
  };
}

export type Aobing = ReturnType<typeof createAobing>;
export const cloneChain = clone;
