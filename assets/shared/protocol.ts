/**
 * Engine <-> frontend protocol over the borrowed GameHost.port.
 * The Engine owns the game; the frontend owns DOM, language, pointer state and
 * the development panel. No player-visible text crosses this boundary: only
 * keys resolved by the frontend's language table.
 */

export const CONTROL_CHANNEL = 'nezha/control';
export const STATE_CHANNEL = 'nezha/state';
export const TUNING_CHANNEL = 'nezha/tuning';
export const FRONTEND_CHANNEL = 'nezha/frontend';

export type GamePhase = 'title' | 'playing' | 'paused';
export type GameLanguage = 'zh' | 'en' | 'pseudo';

/** Frontend -> Engine: phase requests. */
export interface ControlMessage {
  readonly channel: typeof CONTROL_CHANNEL;
  readonly kind: 'start' | 'pause' | 'resume' | 'inspect';
}

/** Frontend -> Engine: development panel edits (clamped by the Engine). */
export type TuningMessage =
  | { readonly channel: typeof TUNING_CHANNEL; readonly kind: 'set'; readonly path: string; readonly value: number }
  | { readonly channel: typeof TUNING_CHANNEL; readonly kind: 'reset' };

/** Frontend -> Engine: presentation facts that QA reads through the Engine projection. */
export interface FrontendStatus {
  readonly lang: GameLanguage;
  /** Where the language came from: first visit follows the browser, later visits the saved choice. */
  readonly langSource: 'browser' | 'saved' | 'manual' | 'dev';
  /** Incremented on every language change; non-UI modules receive the same event. */
  readonly langEvents: number;
  readonly dev: boolean;
  /** `?qa=1` (or dev): mirror the read projection into the DOM for static-preview acceptance. */
  readonly qa: boolean;
  readonly debugOpen: boolean;
  /** Browser pointer-lock state as seen by the presentation realm. */
  readonly pointerLocked: boolean;
  readonly grey: boolean;
  readonly platformInitialized: boolean;
  /** Pillar fade route under review (dev): Alpha Hash, quantised steps, or blended glass. */
  readonly fade: 'hash' | 'steps' | 'glass';
  /** Dev lab switches, e.g. `force` (fade the canyon pillar regardless of occlusion). */
  readonly lab: string;
}

export interface FrontendMessage {
  readonly channel: typeof FRONTEND_CHANNEL;
  readonly kind: 'status';
  readonly status: FrontendStatus;
}

/** Hint keys shown by the HUD; each one is a language-table key under `hud.hint.*`. */
export type HintKey = 'noTarget' | 'targetLost' | 'locked' | 'unlocked';

/** Normalised screen position (0..1, top-left origin) and whether it is in front of the camera. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

/** Engine -> Frontend, once per frame. */
export interface HudState {
  readonly phase: GamePhase;
  readonly lock: { readonly active: boolean; readonly marker: ScreenPoint };
  /** Monotonic counter per newly raised hint, so repeated hints re-animate. */
  readonly hint?: { readonly key: HintKey; readonly serial: number };
  /** Live tuning values, mirrored for the development panel. */
  readonly tuning?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * The `nezha` read projection (QA builds only, ~12 Hz). The static preview host has no
   * game inspection bridge, so acceptance reads this DOM mirror of the same data.
   */
  readonly projection?: unknown;
}

export interface StateMessage {
  readonly channel: typeof STATE_CHANNEL;
  readonly kind: 'state';
  readonly state: HudState;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

export function isControlMessage(value: unknown): value is ControlMessage {
  return (
    record(value) &&
    value.channel === CONTROL_CHANNEL &&
    (value.kind === 'start' || value.kind === 'pause' || value.kind === 'resume' || value.kind === 'inspect')
  );
}

export function isTuningMessage(value: unknown): value is TuningMessage {
  if (!record(value) || value.channel !== TUNING_CHANNEL) return false;
  if (value.kind === 'reset') return true;
  return value.kind === 'set' && typeof value.path === 'string' && typeof value.value === 'number';
}

export function isFrontendMessage(value: unknown): value is FrontendMessage {
  return record(value) && value.channel === FRONTEND_CHANNEL && value.kind === 'status' && record(value.status);
}

export function isStateMessage(value: unknown): value is StateMessage {
  return record(value) && value.channel === STATE_CHANNEL && value.kind === 'state' && record(value.state);
}
