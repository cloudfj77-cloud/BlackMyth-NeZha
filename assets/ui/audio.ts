/**
 * Game audio (ported from WhiteMyth-NeZha v1.4.0 (three.js, see legacy/threejs-v1.4.0) `wukong/js/audio.js`, boss 11-06 batch 1):
 * everything synthesised with Web Audio in the presentation realm — no asset files.
 * - Sound effects: swing, hit, hurt, perfect dodge, spell, lotus, charge, growl, dash, slam,
 *   roar, gate, checkpoint, ice, splash, death, roll, jump, land …
 * - Music: D-yu pentatonic. Explore (68 BPM pluck melody), battle (126 BPM taiko + erhu lead),
 *   phase two (144 BPM, denser drums, higher lead), over a low drone; silent in victory.
 * Started by the first player gesture (Start / resume click). `play(event)` maps the engine's
 * one-shot events to cues; `setMusic(mode)` follows the run stage.
 */
export type MusicMode = 'none' | 'explore' | 'battle' | 'battle2' | 'victory';

export interface CombatAudio {
  readonly unlock: () => void;
  readonly play: (event: string) => void;
  readonly setMusic: (mode: MusicMode) => void;
  readonly music: () => MusicMode;
  readonly toggleMute: () => boolean;
  readonly muted: () => boolean;
  /** How many times each cue was requested (QA mirror). */
  readonly counts: () => Readonly<Record<string, number>>;
  readonly dispose: () => void;
}

interface ToneOpts {
  t?: number; f: number; f2?: number; a?: number; d?: number; hold?: number; v?: number;
  type?: OscillatorType; detune?: number; vib?: readonly [number, number, number?]; dist?: boolean;
  filter?: readonly [BiquadFilterType, number, number?, number?]; dest?: AudioNode; rv?: number;
}
interface NoiseOpts {
  t?: number; f?: number; f2?: number; a?: number; d?: number; hold?: number; v?: number; q?: number;
  type?: BiquadFilterType; rate?: number; dest?: AudioNode; rv?: number;
}

const SCALE = [0, 3, 5, 7, 10]; // D 羽调式五声
const BPM: Record<'explore' | 'battle' | 'battle2', number> = { explore: 68, battle: 126, battle2: 144 };
const EXP_MEL = [[0, 5], [4, 7], [6, 8], [8, 9], [12, 7], [16, 5], [22, 4], [24, 5], [28, 7], [32, 10], [36, 9], [38, 8], [40, 7], [44, 5], [48, 4], [52, 5], [56, 2], [60, 4]] as const;
const LEAD = [[0, 7, 6], [6, 8, 2], [8, 9, 8], [16, 10, 4], [20, 9, 4], [24, 8, 8], [32, 7, 6], [38, 5, 2], [40, 4, 8], [48, 5, 4], [52, 7, 4], [56, 5, 8]] as const;
const LEAD2 = [[0, 10, 4], [4, 9, 2], [6, 10, 2], [8, 12, 6], [14, 11, 2], [16, 10, 8], [24, 9, 4], [28, 7, 4], [32, 8, 6], [38, 9, 2], [40, 10, 4], [44, 12, 4], [48, 14, 6], [54, 12, 2], [56, 10, 8]] as const;
const BASS = [0, 0, 3, 0, 2, 0, 3, 4];

export function degFreq(deg: number): number {
  const o = Math.floor(deg / 5), i = ((deg % 5) + 5) % 5;
  return 146.83 * Math.pow(2, (SCALE[i]! + 12 * o) / 12);
}

export function createCombatAudio(view: Window): CombatAudio {
  const Ctor = (view as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  let ctx: AudioContext | undefined;
  let master!: GainNode, sfx!: GainNode, music!: GainNode, revIn!: GainNode;
  let noiseBuf!: AudioBuffer;
  let distCurve!: Float32Array<ArrayBuffer>;
  let muted = false;
  let mode: MusicMode = 'none';
  let wanted: MusicMode = 'none';
  let step = 0, nextT = 0;
  let droneNodes: { g: GainNode; oscs: OscillatorNode[] } | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const counts: Record<string, number> = {};
  const now = () => ctx!.currentTime;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const makeNoise = (sec: number) => {
    const b = ctx!.createBuffer(1, ctx!.sampleRate * sec, ctx!.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = rnd() * 2 - 1;
    return b;
  };
  const makeIR = (sec: number, decay: number) => {
    const len = ctx!.sampleRate * sec;
    const b = ctx!.createBuffer(2, len, ctx!.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i += 1) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  };
  const init = () => {
    if (!Ctor) return false;
    if (ctx) {
      if (ctx.state !== 'running') void ctx.resume();
      return true;
    }
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(master);
    music = ctx.createGain();
    music.gain.value = 0.42;
    music.connect(master);
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(3.2, 2.6);
    revIn = ctx.createGain();
    revIn.gain.value = 0.5;
    revIn.connect(conv);
    conv.connect(master);
    noiseBuf = makeNoise(3);
    distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) distCurve[i] = Math.tanh((i / 512 - 1) * 4);
    timer = setInterval(schedule, 25);
    applyMode(wanted);
    return true;
  };

  const envGain = (t: number, a: number, v: number, d: number, hold = 0) => {
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + a);
    if (hold) g.gain.setValueAtTime(Math.max(v, 0.0002), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    return g;
  };
  const route = (g: AudioNode, dest: AudioNode | undefined, rv?: number) => {
    g.connect(dest ?? sfx);
    if (rv) {
      const s = ctx!.createGain();
      s.gain.value = rv;
      g.connect(s);
      s.connect(revIn);
    }
  };
  const tone = (o: ToneOpts) => {
    const c = ctx!;
    const t = o.t ?? now(), a = o.a ?? 0.005, d = o.d ?? 0.3, hold = o.hold ?? 0;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + hold + d);
    if (o.detune) osc.detune.value = o.detune;
    let node: AudioNode = osc;
    if (o.vib) {
      const l = c.createOscillator();
      l.frequency.value = o.vib[0];
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.vib[1], t + (o.vib[2] ?? 0.1));
      l.connect(lg);
      lg.connect(osc.frequency);
      l.start(t);
      l.stop(t + a + hold + d + 0.1);
    }
    if (o.dist) {
      const ws = c.createWaveShaper();
      ws.curve = distCurve;
      node.connect(ws);
      node = ws;
    }
    if (o.filter) {
      const fl = c.createBiquadFilter();
      fl.type = o.filter[0];
      fl.Q.value = o.filter[2] ?? 0.8;
      fl.frequency.setValueAtTime(o.filter[1], t);
      if (o.filter[3]) fl.frequency.exponentialRampToValueAtTime(o.filter[3], t + a + hold + d);
      node.connect(fl);
      node = fl;
    }
    const g = envGain(t, a, o.v ?? 0.3, d, hold);
    node.connect(g);
    route(g, o.dest, o.rv);
    osc.start(t);
    osc.stop(t + a + hold + d + 0.1);
  };
  const noise = (o: NoiseOpts) => {
    const c = ctx!;
    const t = o.t ?? now(), a = o.a ?? 0.005, d = o.d ?? 0.2, hold = o.hold ?? 0;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = o.rate ?? 1;
    const fl = c.createBiquadFilter();
    fl.type = o.type ?? 'bandpass';
    fl.Q.value = o.q ?? 1;
    fl.frequency.setValueAtTime(o.f ?? 1000, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + a + hold + d);
    const g = envGain(t, a, o.v ?? 0.3, d, hold);
    s.connect(fl);
    fl.connect(g);
    route(g, o.dest, o.rv);
    s.start(t, rnd() * 1.5);
    s.stop(t + a + hold + d + 0.1);
  };
  const gong = (f: number, v = 0.4, t = now(), dur = 3) => {
    ([[1, 1], [1.48, 0.6], [2.07, 0.45], [2.6, 0.3], [3.24, 0.2], [4.1, 0.12]] as const).forEach(([m, vv], i) => {
      tone({ t, f: f * m, f2: f * m * 0.985, a: 0.004, d: dur * (1 - i * 0.12), v: v * vv, rv: 0.7 });
    });
    noise({ t, f: 600, q: 0.6, a: 0.002, d: 0.25, v: v * 0.5, type: 'lowpass' });
  };
  const pluck = (f: number, t: number, v: number, dest?: AudioNode) => {
    const c = ctx!;
    const o1 = c.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(f * 0.982, t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.003;
    const o3 = c.createOscillator();
    o3.type = 'sawtooth';
    o3.frequency.value = f;
    const g3 = c.createGain();
    g3.gain.value = 0.18;
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(4200, t);
    fl.frequency.exponentialRampToValueAtTime(700, t + 0.9);
    const g = envGain(t, 0.003, v, 1.6);
    o1.connect(fl);
    o2.connect(fl);
    o3.connect(g3);
    g3.connect(fl);
    fl.connect(g);
    route(g, dest ?? music, 0.35);
    for (const o of [o1, o2, o3]) {
      o.start(t);
      o.stop(t + 1.7);
    }
  };
  const taiko = (t: number, v: number) => {
    tone({ t, f: 105, f2: 46, a: 0.002, d: 0.5, v, dest: music, rv: 0.15 });
    noise({ t, type: 'lowpass', f: 420, a: 0.002, d: 0.1, v: v * 0.6, dest: music });
  };
  const rim = (t: number, v: number) => noise({ t, f: 2600, q: 3, a: 0.001, d: 0.05, v, dest: music });
  const bo = (t: number, v: number) => noise({ t, type: 'highpass', f: 5200, a: 0.002, d: 1.4, v, dest: music, rv: 0.4 });
  const erhu = (f: number, t: number, dur: number, v: number) =>
    tone({ t, type: 'sawtooth', f, a: 0.07, hold: Math.max(0.01, dur - 0.1), d: 0.18, v, dest: music, filter: ['bandpass', 1300, 0.7], vib: [5.6, f * 0.014, 0.25], rv: 0.45 });

  // --- Sound effects (v1.4.0 `S`) -----------------------------------------------------------
  const S = {
    swing(power = 1) {
      const t = now();
      noise({ t, f: 500, f2: 2600 + power * 600, q: 1.4, a: 0.05, d: 0.16 + power * 0.08, v: 0.32 + power * 0.1 });
      noise({ t: t + 0.03, f: 260, f2: 140, type: 'lowpass', a: 0.04, d: 0.2, v: 0.25 * power });
    },
    hit(heavy = 0) {
      const t = now();
      tone({ t, f: 170, f2: 45, a: 0.002, d: 0.22 + heavy * 0.3, v: 0.7 });
      noise({ t, type: 'highpass', f: 2200, a: 0.001, d: 0.07, v: 0.45 });
      tone({ t, type: 'triangle', f: 760, f2: 420, a: 0.001, d: 0.1, v: 0.18 });
      noise({ t, type: 'lowpass', f: 1400, f2: 300, a: 0.002, d: 0.18, v: 0.5 });
      if (heavy) {
        tone({ t, f: 85, f2: 28, a: 0.003, d: 0.7, v: 0.85, rv: 0.4 });
        noise({ t, type: 'lowpass', f: 900, f2: 90, a: 0.003, d: 0.6, v: 0.7, rv: 0.5 });
        tone({ t, type: 'square', f: 1250, f2: 900, a: 0.001, d: 0.12, v: 0.06, rv: 0.4 });
      }
    },
    hurt(heavy = 0) {
      const t = now();
      tone({ t, f: 110, f2: 38, a: 0.003, d: 0.35, v: 0.8 });
      noise({ t, type: 'lowpass', f: 1600, f2: 200, a: 0.002, d: 0.25, v: 0.7 });
      tone({ t: t + 0.02, type: 'sawtooth', f: 240, f2: 120, a: 0.02, d: 0.22, v: 0.18, filter: ['lowpass', 1100] });
      if (heavy) noise({ t, type: 'lowpass', f: 500, f2: 80, a: 0.004, d: 0.6, v: 0.6, rv: 0.3 });
    },
    perfect() {
      const t = now();
      noise({ t, f: 300, f2: 4200, q: 2, a: 0.18, d: 0.12, v: 0.3 });
      [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone({ t: t + 0.04 + i * 0.035, f, a: 0.003, d: 1.4, v: 0.11, rv: 0.9 }));
      tone({ t, f: 392, a: 0.01, d: 1.2, v: 0.15, rv: 0.6 });
    },
    spell() {
      const t = now();
      tone({ t, f: 220, f2: 1760, a: 0.02, d: 0.55, v: 0.16, rv: 0.6, type: 'triangle' });
      [880, 1047, 1175, 1319, 1568, 1760].forEach((f, i) => tone({ t: t + 0.08 + i * 0.05, type: 'triangle', f, a: 0.002, d: 0.9, v: 0.09, rv: 0.8 }));
      gong(130, 0.35, t + 0.35, 2.5);
      noise({ t: t + 0.3, f: 3000, q: 4, a: 0.01, d: 0.8, v: 0.1, rv: 0.6 });
    },
    gulp() {
      const t = now();
      for (let i = 0; i < 3; i += 1) {
        tone({ t: t + i * 0.2, f: 320, f2: 110, a: 0.008, d: 0.11, v: 0.35, filter: ['lowpass', 900] });
        noise({ t: t + i * 0.2 + 0.03, f: 380, q: 3, a: 0.004, d: 0.06, v: 0.25 });
      }
    },
    heal() {
      const t = now();
      [659, 988, 1319, 1976].forEach((f, i) => tone({ t: t + i * 0.07, f, a: 0.005, d: 1.1, v: 0.1, rv: 0.8 }));
    },
    empty() {
      const t = now();
      tone({ t, type: 'square', f: 180, f2: 120, a: 0.002, d: 0.08, v: 0.08, filter: ['lowpass', 800] });
      tone({ t: t + 0.1, type: 'square', f: 140, f2: 100, a: 0.002, d: 0.08, v: 0.08, filter: ['lowpass', 800] });
    },
    lock(on: boolean) {
      tone({ f: on ? 1400 : 900, f2: on ? 1800 : 700, a: 0.002, d: 0.06, v: 0.07, type: 'triangle' });
    },
    charge(level: number) {
      const t = now();
      tone({ t, type: 'triangle', f: 520 * Math.pow(1.335, level), a: 0.003, d: 0.45, v: 0.14, rv: 0.6 });
      tone({ t, f: 1040 * Math.pow(1.335, level), a: 0.003, d: 0.3, v: 0.05, rv: 0.6 });
    },
    growl(big = 0) {
      const t = now();
      tone({ t, type: 'sawtooth', f: 78, f2: 62, a: 0.05, d: 0.45 + big * 0.3, v: 0.22, dist: true, filter: ['lowpass', 420], vib: [9, 5, 0.05] });
      noise({ t, type: 'lowpass', f: 380, a: 0.06, d: 0.4, v: 0.25 });
    },
    dash() {
      const t = now();
      noise({ t, f: 300, f2: 1800, q: 1.2, a: 0.08, d: 0.35, v: 0.45 });
      tone({ t, f: 90, f2: 50, a: 0.05, d: 0.3, v: 0.3 });
    },
    slam(v = 1) {
      const t = now();
      tone({ t, f: 75, f2: 24, a: 0.003, d: 1.1, v: 0.95 * v, rv: 0.4 });
      noise({ t, type: 'lowpass', f: 1200, f2: 80, a: 0.003, d: 0.9, v: 0.8 * v, rv: 0.6 });
      noise({ t, type: 'highpass', f: 1800, a: 0.002, d: 0.15, v: 0.3 * v });
    },
    roar() {
      const t = now();
      tone({ t, type: 'sawtooth', f: 120, f2: 55, a: 0.25, hold: 0.8, d: 1.0, v: 0.45, dist: true, filter: ['lowpass', 900, 1, 300], vib: [7, 9, 0.3] });
      tone({ t, type: 'sawtooth', f: 81, f2: 41, a: 0.25, hold: 0.8, d: 1.0, v: 0.35, dist: true, filter: ['lowpass', 600], vib: [5.3, 6, 0.3] });
      noise({ t, type: 'lowpass', f: 700, f2: 200, a: 0.25, hold: 0.8, d: 1.0, v: 0.6, rv: 0.4 });
      gong(73, 0.55, t + 0.15, 4);
      tone({ t: t + 0.15, f: 45, f2: 30, a: 0.02, d: 2.2, v: 0.6 });
    },
    gate() {
      const t = now();
      noise({ t, type: 'lowpass', f: 300, f2: 1600, a: 0.6, d: 0.6, v: 0.4, rv: 0.6 });
      gong(98, 0.3, t + 0.3, 3);
    },
    checkpoint() {
      const t = now();
      gong(196, 0.25, t, 3);
      [587, 784, 880].forEach((f, i) => tone({ t: t + 0.2 + i * 0.12, type: 'triangle', f, a: 0.003, d: 1.2, v: 0.09, rv: 0.8 }));
    },
    /** The fallen boss (M4 rule: no celebration) — one low gong and a falling erhu note. */
    fall() {
      const t = now();
      gong(55, 0.45, t, 5);
      tone({ t: t + 0.5, type: 'sawtooth', f: degFreq(5), f2: degFreq(2), a: 0.4, hold: 0.8, d: 1.8, v: 0.06, filter: ['lowpass', 1100], vib: [5, 4, 0.5], rv: 0.8 });
    },
    death() {
      const t = now();
      gong(49, 0.5, t, 5);
      tone({ t, f: 98, f2: 49, a: 0.2, d: 3, v: 0.3, rv: 0.6 });
      tone({ t: t + 0.4, type: 'sawtooth', f: degFreq(2), f2: degFreq(0), a: 0.3, hold: 0.8, d: 1.5, v: 0.07, filter: ['lowpass', 1200], vib: [5, 4, 0.5], rv: 0.7 });
    },
    roll() {
      const t = now();
      noise({ t, f: 350, f2: 1500, q: 1.1, a: 0.06, d: 0.28, v: 0.32 });
      noise({ t: t + 0.18, type: 'lowpass', f: 500, a: 0.004, d: 0.12, v: 0.18 });
      tone({ t: t + 0.05, type: 'triangle', f: 180, f2: 120, a: 0.01, d: 0.1, v: 0.06 });
    },
    jump() {
      const t = now();
      noise({ t, f: 600, f2: 2200, q: 1.3, a: 0.03, d: 0.18, v: 0.22 });
      tone({ t, f: 140, f2: 90, a: 0.004, d: 0.09, v: 0.14 });
    },
    land(v = 0.5) {
      const t = now();
      tone({ t, f: 120, f2: 50, a: 0.002, d: 0.14 + v * 0.1, v: 0.25 + v * 0.3 });
      noise({ t, type: 'lowpass', f: 700, f2: 200, a: 0.002, d: 0.12, v: 0.2 + v * 0.2 });
    },
    ice() {
      const t = now();
      [2637, 3136, 3951, 4699].forEach((f, i) => tone({ t: t + i * 0.03, type: 'triangle', f, f2: f * 0.97, a: 0.001, d: 0.6, v: 0.07, rv: 0.8 }));
      noise({ t, type: 'highpass', f: 4000, a: 0.002, d: 0.35, v: 0.35, rv: 0.5 });
      noise({ t, type: 'lowpass', f: 900, f2: 120, a: 0.003, d: 0.5, v: 0.4 });
    },
    splash() {
      const t = now();
      noise({ t, type: 'lowpass', f: 2500, f2: 300, a: 0.01, d: 0.8, v: 0.55, rv: 0.4 });
      noise({ t: t + 0.05, f: 900, q: 0.5, a: 0.02, d: 0.6, v: 0.3 });
      for (let i = 0; i < 8; i += 1) noise({ t: t + 0.1 + rnd() * 0.5, type: 'highpass', f: 2500 + rnd() * 2000, a: 0.001, d: 0.05, v: 0.12 });
    },
  };

  /** Engine event → cue (unknown events are silent). */
  const CUES: Record<string, () => void> = {
    'swing-light': () => S.swing(0.7),
    'swing-heavy': () => S.swing(1.5),
    hit: () => S.hit(0),
    'hit-heavy': () => S.hit(1),
    'charge-full': () => S.charge(2),
    perfect: () => S.perfect(),
    'sash-bind': () => S.spell(),
    'sash-ready': () => S.charge(1),
    roll: () => S.roll(),
    jump: () => S.jump(),
    land: () => S.land(0.5),
    hurt: () => S.hurt(0),
    lotus: () => {
      S.gulp();
      setTimeout(() => ctx && !muted && S.heal(), 600);
    },
    'no-stamina': () => S.empty(),
    lock: () => S.lock(true),
    unlock: () => S.lock(false),
    defeat: () => S.death(),
    'boss-dead': () => S.fall(),
    // Telegraphs (one cue per attack, at telegraph step 0): tell attacks off screen.
    growl: () => S.growl(0),
    'boss-swing': () => S.swing(1.6),
    break: () => S.slam(0.6),
    'tell-smash': () => S.growl(1),
    'tell-icering': () => S.ice(),
    'mob-swing': () => S.swing(0.9),
    'tell-bite': () => S.growl(0),
    'tell-lash': () => S.growl(1),
    'tell-charge': () => S.dash(),
    'tell-coil': () => S.growl(1),
    'tell-slash': () => S.growl(0),
    'tell-sweep': () => S.growl(1),
    'tell-thrust': () => S.dash(),
    'tell-leap': () => S.growl(1),
    'tell-spikes': () => S.ice(),
    roar: () => S.roar(),
    'coil-burst': () => S.splash(),
    breach: () => {
      S.splash();
      S.slam(0.6);
    },
    ice: () => S.ice(),
    slam: () => S.slam(1),
    splash: () => S.splash(),
    gate: () => S.gate(),
    checkpoint: () => S.checkpoint(),
    intro: () => S.gate(),
  };

  // --- Music ----------------------------------------------------------------------------------
  const drone = (on: boolean) => {
    if (droneNodes) {
      const dn = droneNodes;
      droneNodes = null;
      dn.g.gain.setTargetAtTime(0.0001, now(), 0.5);
      setTimeout(() => dn.oscs.forEach((o) => o.stop()), 2500);
    }
    if (!on) return;
    const c = ctx!;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.07, now(), 1.0);
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 320;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = c.createGain();
    lg.gain.value = 140;
    lfo.connect(lg);
    lg.connect(fl.frequency);
    const oscs = [73.42, 110, 73.6].map((f, i) => {
      const o = c.createOscillator();
      o.type = i === 1 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.connect(fl);
      o.start();
      return o;
    });
    oscs.push(lfo);
    lfo.start();
    fl.connect(g);
    route(g, music, 0.3);
    droneNodes = { g, oscs };
  };
  function applyMode(m: MusicMode) {
    if (!ctx || m === mode) return;
    const prev = mode;
    mode = m;
    step = 0;
    nextT = now() + 0.15;
    if (m === 'none' || m === 'victory') drone(false);
    else if (prev === 'none' || prev === 'victory') drone(true);
    if (m === 'battle' || m === 'battle2') bo(nextT, 0.12);
  }
  const playStep = (s: number, t: number) => {
    const s16 = s % 16, bar = Math.floor(s / 16);
    if (mode === 'explore') {
      for (const [st, d] of EXP_MEL) if (st === s) pluck(degFreq(d), t, 0.16);
      if (s === 0 || s === 32) pluck(degFreq(-5), t, 0.2);
      if (s === 16 || s === 48) pluck(degFreq(-3), t, 0.16);
      if (s === 0) taiko(t, 0.12);
      if (s === 40 && rnd() < 0.5) pluck(degFreq(12), t, 0.07);
    } else if (mode === 'battle' || mode === 'battle2') {
      const p2 = mode === 'battle2';
      if (s16 === 0 || s16 === 8) taiko(t, 0.42);
      if ([3, 6, 11, 14].includes(s16)) taiko(t, 0.24);
      if (p2 && [10, 15, 13].includes(s16)) taiko(t, 0.2);
      if (s16 === 4 || s16 === 12) rim(t, 0.16);
      if (p2 && (s16 === 2 || s16 === 7)) rim(t, 0.1);
      if (s16 % 2 === 0) pluck(degFreq(BASS[(s16 / 2) | 0]! - 5 + (bar === 3 ? 1 : 0)), t, 0.12);
      if (p2 && s16 % 2 === 1) pluck(degFreq(BASS[(s16 / 2) | 0]! + 5), t, 0.05);
      const spb = 60 / BPM[mode] / 4;
      for (const [st, d, len] of p2 ? LEAD2 : LEAD) if (st === s) erhu(degFreq(d), t, len * spb, p2 ? 0.075 : 0.065);
      if (s === 0) bo(t, 0.08);
    }
  };
  function schedule() {
    if (!ctx || mode === 'none' || mode === 'victory') return;
    const spb = 60 / BPM[mode] / 4;
    if (nextT < now() - 0.5) nextT = now() + 0.05;
    while (nextT < now() + 0.15) {
      playStep(step, nextT);
      nextT += spb;
      step = (step + 1) % 64;
    }
  }

  return {
    unlock: () => {
      init();
    },
    play: (event) => {
      const cue = CUES[event];
      if (!cue) return;
      counts[event] = (counts[event] ?? 0) + 1;
      if (!ctx || muted) return;
      try {
        cue();
      } catch {
        /* a cue must never break the frame */
      }
    },
    setMusic: (m) => {
      wanted = m;
      applyMode(m);
    },
    music: () => mode,
    toggleMute: () => {
      muted = !muted;
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.85, now(), 0.05);
      return muted;
    },
    muted: () => muted,
    counts: () => counts,
    dispose: () => {
      if (timer) clearInterval(timer);
      if (ctx) drone(false);
      void ctx?.close();
      ctx = undefined;
    },
  };
}
