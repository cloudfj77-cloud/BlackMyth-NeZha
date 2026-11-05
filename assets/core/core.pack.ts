import { definePack } from '@forgeax/engine/pack/source';
import { Time, Update } from '@forgeax/engine/ecs';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';
import type {} from '@forgeax/engine/app';
import { PACKAGE_IDS } from '../shared/asset-refs.ts';
import {
  isControlMessage,
  isFrontendMessage,
  isTuningMessage,
  STATE_CHANNEL,
  type FrontendStatus,
  type GamePhase,
  type HintKey,
  type HudState,
  type StateMessage,
} from '../shared/protocol.ts';
import { defaultTuning, overrides, writePath, type Tuning } from '../shared/tuning.ts';

/**
 * Core services shared by every gameplay plugin:
 * - session: the game phase authority (the frontend only requests transitions);
 * - tuning: the live, clamped copy of `data/tuning.json` edited by the dev panel;
 * - telemetry: the single QA read projection `nezha`, assembled from sections.
 */
export interface SessionService {
  readonly phase: () => GamePhase;
  /** True when gameplay input should drive the player and camera. */
  readonly playing: () => boolean;
  /** Game-time seconds (World Time.elapsed). */
  readonly time: () => number;
  readonly frontend: () => FrontendStatus;
  readonly raiseHint: (key: HintKey) => void;
  /** Merge one plugin's slice of the per-frame HUD message (sent once per Update). */
  readonly contribute: (patch: Partial<HudState>) => void;
}

export interface TuningService {
  /** Live values; plugins read fields each frame and never cache them. */
  readonly current: Tuning;
  /** Serial bumped on every accepted edit, so plugins can rebuild derived data. */
  readonly revision: () => number;
}

export interface TelemetryService {
  /** Adds one named section to the `nezha` projection; returns its removal. */
  readonly section: (name: string, read: () => unknown) => () => void;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    nezhaSession: SessionService;
    nezhaTuning: TuningService;
    nezhaTelemetry: TelemetryService;
  }
}

export function nextPhase(current: GamePhase, request: 'start' | 'pause' | 'resume' | 'inspect'): GamePhase {
  switch (request) {
    case 'start':
      return current === 'title' ? 'playing' : current;
    case 'pause':
      return current === 'playing' ? 'paused' : current;
    case 'resume':
      return current === 'paused' ? 'playing' : current;
    default:
      return current;
  }
}

const INITIAL_FRONTEND: FrontendStatus = Object.freeze({
  lang: 'en',
  langSource: 'browser',
  langEvents: 0,
  dev: false,
  qa: false,
  debugOpen: false,
  pointerLocked: false,
  grey: false,
  platformInitialized: false,
  fade: 'hash',
  lab: '',
});

export const core: Plugin = {
  name: 'nezha/core',
  provide: ['nezhaSession', 'nezhaTuning', 'nezhaTelemetry'],
  inject: ['world', 'gameHost'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    if (host === undefined) throw new Error('nezha/core requires the App-owned GameHost');
    const port = host.port;
    ctx.effect(function* () {
      let phase: GamePhase = 'title';
      let frontend: FrontendStatus = INITIAL_FRONTEND;
      let hintSerial = 0;
      let hint: HudState['hint'];
      let revision = 0;
      let frame = 0;
      let pending: Partial<HudState> = {};
      const tuning = defaultTuning();
      const sections = new Map<string, () => unknown>();
      const readProjection = () => {
        const out: Record<string, unknown> = { t: world.getResource(Time).elapsed, frame };
        for (const [name, read] of sections) out[name] = read();
        return out;
      };

      const receive = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (isControlMessage(data)) phase = nextPhase(phase, data.kind);
        else if (isTuningMessage(data)) {
          if (data.kind === 'reset') Object.assign(tuning, defaultTuning());
          else if (!writePath(tuning, data.path, data.value)) return;
          revision += 1;
        } else if (isFrontendMessage(data)) frontend = { ...INITIAL_FRONTEND, ...data.status };
      };
      port?.addEventListener('message', receive);
      port?.start();
      yield () => port?.removeEventListener('message', receive);

      const session: SessionService = {
        phase: () => phase,
        playing: () => phase === 'playing',
        time: () => world.getResource(Time).elapsed,
        frontend: () => frontend,
        raiseHint: (key) => {
          hintSerial += 1;
          hint = { key, serial: hintSerial };
        },
        contribute: (patch) => {
          pending = { ...pending, ...patch };
        },
      };

      // Publish one HUD message per frame after every gameplay system has contributed.
      world.addSystem(Update, {
        name: 'nezha-core-publish',
        after: ['nezha-camera'],
        queries: [],
        fn: () => {
          frame += 1;
          const state: HudState = {
            phase,
            lock: { active: false, marker: { x: 0, y: 0, visible: false } },
            ...pending,
            ...(hint ? { hint } : {}),
            ...(frontend.debugOpen ? { tuning: tuning as unknown as HudState['tuning'] } : {}),
            ...((frontend.qa || frontend.dev) && frame % 5 === 0 ? { projection: readProjection() } : {}),
          };
          port?.postMessage({ channel: STATE_CHANNEL, kind: 'state', state } satisfies StateMessage);
          pending = {};
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'nezha-core-publish').unwrap();

      sections.set('ui', () => ({ phase, pointerLocked: frontend.pointerLocked, debugOpen: frontend.debugOpen, dev: frontend.dev, grey: frontend.grey }));
      sections.set('i18n', () => ({ lang: frontend.lang, source: frontend.langSource, pseudo: frontend.lang === 'pseudo', events: frontend.langEvents }));
      sections.set('platform', () => ({ initialized: frontend.platformInitialized }));
      sections.set('tuning', () => ({ revision, overrides: overrides(tuning) }));
      const unregister = host.gameProjection?.registerRead({
        id: 'nezha',
        title: 'White Myth: Nezha',
        description: 'All QA-facing state: phase, player, camera, float, lock-on, occlusion, ambience, language, perf.',
        // Sections only hold JSON-compatible numbers, strings, booleans, arrays and records.
        read: () => readProjection() as never,
      });
      if (unregister !== undefined) yield unregister;

      yield ctx.provide('nezhaSession', session);
      yield ctx.provide('nezhaTuning', { current: tuning, revision: () => revision } satisfies TuningService);
      yield ctx.provide('nezhaTelemetry', {
        section: (name, read) => {
          sections.set(name, read);
          return () => {
            if (sections.get(name) === read) sections.delete(name);
          };
        },
      } satisfies TelemetryService);
    }, 'nezha/core');
  },
};

export default definePack({
  schemaVersion: '2.0.0', plugins: true,
  packageId: PACKAGE_IDS.corePlugin,
  build: () => ok({
    'plugin/core': { kind: 'plugin', module: { specifier: './core.pack.ts', export: 'core' } },
  }),
});
