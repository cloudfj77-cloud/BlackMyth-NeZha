/**
 * Placeholder combat audio (M2): synthesised with Web Audio in the presentation realm, no
 * asset files. Started by the first player gesture (Start / resume click). Swings, hits,
 * charge-full, perfect dodge, Sash Bind ready and a few extras. A whiff has no hit sound.
 */
export interface CombatAudio {
  readonly unlock: () => void;
  readonly play: (event: string) => void;
  /** How many times each cue actually played (QA mirror). */
  readonly counts: () => Readonly<Record<string, number>>;
  readonly dispose: () => void;
}

export function createCombatAudio(view: Window): CombatAudio {
  const Ctor = (view as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  let context: AudioContext | undefined;
  let noise: AudioBuffer | undefined;
  const counts: Record<string, number> = {};

  const ensure = () => {
    if (!Ctor) return undefined;
    if (!context) {
      context = new Ctor();
      const length = Math.floor(context.sampleRate * 0.5);
      noise = context.createBuffer(1, length, context.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 7;
      for (let i = 0; i < length; i += 1) {
        seed = (seed * 16807) % 2147483647;
        data[i] = (seed / 2147483647) * 2 - 1;
      }
    }
    if (context.state === 'suspended') void context.resume();
    return context;
  };

  const out = (ctx: AudioContext, gain: number, at: number, attack: number, release: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    g.connect(ctx.destination);
    return g;
  };
  const whoosh = (ctx: AudioContext, from: number, to: number, seconds: number, gain: number) => {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise!;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(from, t);
    band.frequency.exponentialRampToValueAtTime(to, t + seconds);
    src.connect(band).connect(out(ctx, gain, t, 0.015, seconds));
    src.start(t);
    src.stop(t + seconds + 0.05);
  };
  const tone = (ctx: AudioContext, type: OscillatorType, from: number, to: number, seconds: number, gain: number, delay = 0) => {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + seconds);
    osc.connect(out(ctx, gain, t, 0.005, seconds));
    osc.start(t);
    osc.stop(t + seconds + 0.05);
  };

  const cues: Record<string, (ctx: AudioContext) => void> = {
    'swing-light': (ctx) => whoosh(ctx, 2400, 900, 0.12, 0.25),
    'swing-heavy': (ctx) => {
      whoosh(ctx, 1400, 300, 0.28, 0.4);
      tone(ctx, 'sawtooth', 160, 70, 0.2, 0.08);
    },
    hit: (ctx) => {
      tone(ctx, 'sine', 150, 55, 0.16, 0.6);
      whoosh(ctx, 3200, 1800, 0.06, 0.35);
    },
    'charge-full': (ctx) => {
      tone(ctx, 'sine', 880, 880, 0.35, 0.2);
      tone(ctx, 'sine', 1320, 1320, 0.3, 0.12, 0.02);
    },
    perfect: (ctx) => {
      tone(ctx, 'triangle', 520, 1560, 0.3, 0.25);
      whoosh(ctx, 500, 4000, 0.3, 0.3);
    },
    'sash-ready': (ctx) => tone(ctx, 'sine', 1046, 1046, 0.25, 0.18),
    'sash-bind': (ctx) => {
      whoosh(ctx, 600, 2400, 0.2, 0.25);
      tone(ctx, 'triangle', 330, 660, 0.2, 0.12);
    },
    roll: (ctx) => whoosh(ctx, 700, 1600, 0.2, 0.18),
    hurt: (ctx) => tone(ctx, 'sine', 110, 50, 0.25, 0.5),
    // M4 telegraph cues (placeholder, one per attack, at telegraph step 0): tell the attack off screen.
    'tell-bite': (ctx) => {
      tone(ctx, 'sawtooth', 180, 240, 0.35, 0.08);
      tone(ctx, 'sine', 360, 480, 0.3, 0.06, 0.05);
    },
    'tell-lash': (ctx) => whoosh(ctx, 300, 1400, 0.6, 0.2),
    'tell-charge': (ctx) => {
      tone(ctx, 'sine', 70, 120, 0.7, 0.4);
      whoosh(ctx, 400, 900, 0.7, 0.1);
    },
    'tell-coil': (ctx) => {
      tone(ctx, 'triangle', 110, 220, 0.9, 0.2);
      tone(ctx, 'sine', 55, 110, 1.0, 0.3, 0.1);
    },
    // Phase change roar (2 s), the coil's water burst, the intro wall breach.
    roar: (ctx) => {
      tone(ctx, 'sawtooth', 90, 60, 1.8, 0.16);
      tone(ctx, 'sine', 45, 38, 2.0, 0.4);
    },
    'coil-burst': (ctx) => whoosh(ctx, 2000, 300, 0.8, 0.3),
    breach: (ctx) => {
      whoosh(ctx, 2600, 400, 0.9, 0.35);
      tone(ctx, 'sine', 60, 40, 0.8, 0.4);
    },
    // M3: defeat (「败」) — a low, dull drop; the dragon falling — a long descending sigh.
    defeat: (ctx) => {
      tone(ctx, 'sine', 70, 38, 0.9, 0.55);
      tone(ctx, 'triangle', 140, 70, 0.6, 0.15, 0.05);
    },
    'boss-dead': (ctx) => {
      tone(ctx, 'sine', 220, 55, 2.2, 0.35);
      tone(ctx, 'sine', 330, 82, 2.0, 0.12, 0.1);
    },
    lotus: (ctx) => {
      tone(ctx, 'sine', 660, 990, 0.3, 0.15);
      tone(ctx, 'sine', 990, 1320, 0.3, 0.1, 0.12);
    },
  };

  return {
    unlock: () => {
      ensure();
    },
    play: (event) => {
      const cue = cues[event];
      if (!cue) return;
      counts[event] = (counts[event] ?? 0) + 1;
      const ctx = ensure();
      if (ctx && noise) cue(ctx);
    },
    counts: () => counts,
    dispose: () => {
      void context?.close();
      context = undefined;
    },
  };
}
