import type { GameHost } from '@forgeax/engine/app';
import { mountUi, type UiAsset, type UiInstance } from '@forgeax/engine/ui';
import { bindUiLocalization, createUiLocalization } from '@forgeax/engine/ui/localization';
import { initialLanguage, LANGUAGE_EVENT, pseudoBundle, STORAGE_KEY } from '../i18n/language.ts';
import {
  CONTROL_CHANNEL,
  FRONTEND_CHANNEL,
  isStateMessage,
  TUNING_CHANNEL,
  type ControlMessage,
  type FrontendMessage,
  type FrontendStatus,
  type GameLanguage,
  type HudState,
  type TuningMessage,
} from '../shared/protocol.ts';
import { createDebugPanel, type DebugPanel } from './debug-panel.ts';

type Host = Pick<GameHost, 'uiRoot' | 'controlMode' | 'port' | 'presentationPort'>;

/** Control rows: key caps are language-neutral; `soon` rows belong to later milestones. */
const CONTROL_ROWS: readonly { readonly keys: readonly string[]; readonly action: string; readonly soon?: boolean }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: 'menu.controls.move' },
  { keys: ['Shift'], action: 'menu.controls.sprint' },
  { keys: ['@menu.controls.keyMouse'], action: 'menu.controls.camera' },
  { keys: ['R'], action: 'menu.controls.lock' },
  { keys: ['Shift'], action: 'menu.controls.dodge', soon: true },
  { keys: ['@menu.controls.keyLmb'], action: 'menu.controls.attack', soon: true },
  { keys: ['Esc'], action: 'menu.controls.pause' },
];

/**
 * The frontend owns every player-visible word: start / pause screens, HUD
 * hints, language choice (remembered), the dev panel, and pointer-lock driven
 * pause. Engine state arrives once per frame over the port.
 */
export async function createMenu(asset: UiAsset, host: Host): Promise<UiInstance> {
  const root = host.uiRoot;
  if (!root) throw new Error('Nezha menu requires GameHost.uiRoot in the presentation realm');
  const document = root.ownerDocument;
  const view = document.defaultView!;
  const params = new view.URLSearchParams(view.location.search);
  const dev = params.get('dev') === '1';
  const storage = (() => {
    try {
      return view.localStorage;
    } catch {
      return undefined;
    }
  })();
  const browserLanguages = [...(view.navigator.languages ?? []), view.navigator.language];
  const first = initialLanguage({ saved: storage?.getItem(STORAGE_KEY) ?? null, browser: browserLanguages, devOverride: params.get('lang'), dev });

  const localized = await createUiLocalization(asset, { lng: first.lang });
  if (!localized.ok) throw localized.error;
  const i18n = localized.value;
  // Development pseudo-locale: every English bundle, accented, +30% and bracketed.
  for (const ns of Object.keys(i18n.store.data.en ?? {})) {
    i18n.addResourceBundle('pseudo', ns, pseudoBundle(i18n.getResourceBundle('en', ns)) as object, true, true);
  }
  if (first.lang === 'pseudo') await i18n.changeLanguage('pseudo');

  const port = host.presentationPort ?? host.port;
  const send = (kind: ControlMessage['kind']) => port?.postMessage({ channel: CONTROL_CHANNEL, kind } satisfies ControlMessage);
  const tune = (message: { readonly kind: 'set'; readonly path: string; readonly value: number } | { readonly kind: 'reset' }) => port?.postMessage({ channel: TUNING_CHANNEL, ...message } as TuningMessage);

  let state: HudState | undefined;
  let lastHintSerial = 0;
  let hintKey: string | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let wasLocked = false;
  let status: FrontendStatus = {
    lang: first.lang,
    langSource: first.source,
    langEvents: 0,
    dev,
    qa: dev || params.get('qa') === '1',
    debugOpen: false,
    pointerLocked: false,
    grey: dev && params.get('grey') === '1',
    fade: dev && (params.get('fade') === 'steps' || params.get('fade') === 'glass') ? (params.get('fade') as 'steps' | 'glass') : 'hash',
    lab: dev ? (params.get('lab') ?? '') : '',
    platformInitialized: (globalThis as { __nezhaPlatform?: { initialized?: boolean } }).__nezhaPlatform?.initialized === true,
  };
  const publishStatus = (patch: Partial<FrontendStatus> = {}) => {
    status = { ...status, ...patch };
    port?.postMessage({ channel: FRONTEND_CHANNEL, kind: 'status', status } satisfies FrontendMessage);
    panel?.setFlags({ lang: status.lang, grey: status.grey });
  };

  const setLanguage = async (lang: GameLanguage, source: 'manual' | 'dev') => {
    if (lang !== 'pseudo') storage?.setItem(STORAGE_KEY, lang);
    await i18n.changeLanguage(lang);
    // Non-UI modules (cover, engine plugins) subscribe to this event; the Engine gets it via the status message.
    view.dispatchEvent(new view.CustomEvent(LANGUAGE_EVENT, { detail: { lang } }));
    publishStatus({ lang, langSource: source, langEvents: status.langEvents + 1 });
  };

  const mounted = mountUi(asset, {
    root,
    layer: 50,
    onAction: (action) => {
      if (action === 'start') send('start');
      else if (action === 'resume') send('resume');
      else if (action === 'lang-zh' || action === 'lang-en') void setLanguage(action.slice(5) as GameLanguage, 'manual');
      // Keep keyboard focus off overlay buttons so WASD / R reach the game.
      const active = ui.host.shadowRoot?.activeElement;
      if (active instanceof view.HTMLElement) active.blur();
    },
  });
  if (!mounted.ok) throw mounted.error;
  const ui = mounted.value;
  const shadow = ui.host.shadowRoot;
  if (!shadow) throw new Error('Nezha menu requires a shadow root');
  const part = <T extends HTMLElement = HTMLElement>(name: string) => shadow.querySelector<T>(`[data-ui-part="${name}"]`);
  const releases: (() => void)[] = [];

  for (const list of shadow.querySelectorAll<HTMLUListElement>('ul.controls')) {
    for (const row of CONTROL_ROWS) {
      const item = document.createElement('li');
      if (row.soon) item.classList.add('soon');
      const keys = document.createElement('span');
      for (const key of row.keys) {
        const cap = document.createElement('kbd');
        if (key.startsWith('@')) cap.dataset.i18n = key.slice(1);
        else cap.textContent = key;
        keys.append(cap, document.createTextNode(' '));
      }
      const action = document.createElement('span');
      const label = document.createElement('span');
      label.dataset.i18n = row.action;
      action.append(label);
      if (row.soon) {
        const tag = document.createElement('span');
        tag.className = 'soon-tag';
        tag.dataset.i18n = 'menu.controls.soon';
        action.append(tag);
      }
      item.append(keys, action);
      list.append(item);
    }
  }

  const t = (key: string) => i18n.t(key);
  const localize = () => {
    for (const node of shadow.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n!);
    for (const node of shadow.querySelectorAll<HTMLElement>('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria!));
    const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as GameLanguage;
    ui.host.lang = lang === 'zh' ? 'zh-CN' : 'en';
    ui.host.dataset.lang = lang;
    for (const button of shadow.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
      button.classList.toggle('active', button.dataset.lang === lang);
      button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    }
    if (hintKey) part('hint')!.textContent = t(`hud.hint.${hintKey}`);
    document.title = t('terms:game.title');
    document.documentElement.lang = ui.host.lang;
  };
  releases.push(bindUiLocalization(ui, i18n, localize));

  // --- Development panel -------------------------------------------------------------
  let panel: DebugPanel | undefined;
  if (dev) {
    ui.host.classList.add('dev');
    panel = createDebugPanel({
      root: part('debug-panel')!,
      set: (path, value) => tune({ kind: 'set', path, value }),
      reset: () => tune({ kind: 'reset' }),
      language: (lang) => void setLanguage(lang, 'dev'),
      grey: (on) => publishStatus({ grey: on }),
    });
    releases.push(() => panel?.dispose());
    // URL presets for scripted QA setups: ?target=2x4 / 8x20.
    const target = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(params.get('target') ?? '');
    if (target) {
      tune({ kind: 'set', path: 'lock.targetHeight', value: Number(target[1]) });
      tune({ kind: 'set', path: 'lock.targetLength', value: Number(target[2]) });
    }
  }
  const setDebugOpen = (open: boolean) => {
    if (!dev || open === status.debugOpen) return;
    ui.host.classList.toggle('debug-open', open);
    // Opening the panel releases the pointer (the game keeps running; mouse-look pauses).
    if (open) document.exitPointerLock?.();
    publishStatus({ debugOpen: open });
  };

  const showHint = (key: string) => {
    hintKey = key;
    const node = part('hint')!;
    node.textContent = t(`hud.hint.${key}`);
    node.classList.add('show');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => node.classList.remove('show'), 1800);
  };

  const render = (next: HudState) => {
    state = next;
    for (const phase of ['title', 'playing', 'paused'] as const) ui.host.classList.toggle(`phase-${phase}`, next.phase === phase);
    ui.host.classList.toggle('locked', next.lock.active);
    const marker = part('lock-marker')!;
    marker.classList.toggle('on-screen', next.lock.marker.visible);
    marker.style.left = `${(next.lock.marker.x * 100).toFixed(2)}%`;
    marker.style.top = `${(next.lock.marker.y * 100).toFixed(2)}%`;
    if (next.hint && next.hint.serial !== lastHintSerial) {
      lastHintSerial = next.hint.serial;
      showHint(next.hint.key);
    }
    if (next.tuning) panel?.update(next.tuning);
    // QA mirror of the Engine read projection (static preview has no inspection bridge).
    if (next.projection !== undefined) ui.host.dataset.nezha = JSON.stringify(next.projection);
    if (next.phase === 'playing' && !status.debugOpen && shadow.activeElement instanceof view.HTMLElement) shadow.activeElement.blur();
  };

  const receive = (event: MessageEvent) => {
    if (isStateMessage(event.data)) render(event.data.state);
  };
  port?.addEventListener('message', receive);
  port?.start();
  releases.push(() => port?.removeEventListener('message', receive));
  publishStatus();
  send('inspect');

  // Pointer lock owns pause: losing the lock mid-play pauses (unless the dev panel took it), regaining it resumes.
  const onMode = () => {
    const mode = host.controlMode?.read() ?? 'pointer';
    const locked = mode === 'pointer-locked';
    ui.host.classList.toggle('pointer-locked', locked);
    if (locked !== status.pointerLocked) publishStatus({ pointerLocked: locked });
    if (locked !== status.pointerLocked) publishStatus({ pointerLocked: locked });
    if (wasLocked && !locked && state?.phase === 'playing' && !status.debugOpen) send('pause');
    if (locked && state?.phase === 'paused') send('resume');
    if (locked && status.debugOpen) setDebugOpen(false);
    wasLocked = locked;
  };
  if (host.controlMode) releases.push(host.controlMode.subscribe(onMode));
  onMode();
  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'F2' && dev) {
      event.preventDefault();
      setDebugOpen(!status.debugOpen);
      return;
    }
    // Esc always pauses (and releases the pointer); resuming is an explicit click or the Resume button.
    if (event.code !== 'Escape' || state?.phase !== 'playing') return;
    if (status.debugOpen) {
      setDebugOpen(false);
      return;
    }
    send('pause');
    document.exitPointerLock?.();
  };
  document.addEventListener('keydown', onKey);
  releases.push(() => document.removeEventListener('keydown', onKey));

  ui.host.classList.add('phase-title');
  return {
    host: ui.host,
    signal: ui.signal,
    resourceUrl: ui.resourceUrl,
    dispose: () => {
      if (hintTimer) clearTimeout(hintTimer);
      for (const release of releases.reverse()) release();
      ui.dispose();
    },
  };
}
