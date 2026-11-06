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
import { createCombatAudio } from './audio.ts';

/** Run time shown as m:ss.s (language-neutral). */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

type Host = Pick<GameHost, 'uiRoot' | 'controlMode' | 'port' | 'presentationPort'>;

/** Control rows: key caps are language-neutral (`@key` caps are translated). */
const CONTROL_ROWS: readonly { readonly keys: readonly string[]; readonly action: string; readonly soon?: boolean }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: 'menu.controls.move' },
  { keys: ['Shift'], action: 'menu.controls.sprint' },
  { keys: ['@menu.controls.keySpace'], action: 'menu.controls.roll' },
  { keys: ['@menu.controls.keyMouse'], action: 'menu.controls.camera' },
  { keys: ['@menu.controls.keyLmb'], action: 'menu.controls.lightAttack' },
  { keys: ['@menu.controls.keyRmb'], action: 'menu.controls.heavyAttack' },
  { keys: ['R'], action: 'menu.controls.lock' },
  { keys: ['Q'], action: 'menu.controls.lotus' },
  { keys: ['1'], action: 'menu.controls.sash' },
  { keys: ['Enter'], action: 'menu.controls.skip' },
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
  const audio = createCombatAudio(view);
  let lastFlash = 0;
  let lastHurt = 0;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let hurtTimer: ReturnType<typeof setTimeout> | undefined;
  let lastHintSerial = 0;
  let hintKey: string | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let wasLocked = false;
  let lastSubtitle = '';
  let lastRecordSerial = 0;
  const RUNS_KEY = 'nezha.runs.v1';
  const canvas = () => document.querySelector('canvas');
  const relock = () => {
    try {
      void (canvas()?.requestPointerLock?.() as unknown as Promise<void> | undefined)?.catch?.(() => undefined);
    } catch {
      /* the click-to-lock on the game still works */
    }
  };
  /** A menu with buttons is up (defeat banner, result): losing the pointer there is not a pause. */
  const menuUp = () => !!state?.run && (state.run.banner || state.run.stage === 'result');
  let status: FrontendStatus = {
    lang: first.lang,
    langSource: first.source,
    langEvents: 0,
    dev,
    qa: dev || params.get('qa') === '1',
    debugOpen: false,
    pointerLocked: false,
    grey: dev && params.get('grey') === '1',
    // Boss ruling (M1 review #13): pillars fade as frosted glass by default; dev can compare `?fade=hash|steps`.
    fade: dev && (params.get('fade') === 'steps' || params.get('fade') === 'hash') ? (params.get('fade') as 'steps' | 'hash') : 'glass',
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
      if (action === 'start' || action === 'resume') audio.unlock();
      if (action === 'start') send('start');
      else if (action === 'resume') send('resume');
      else if (action === 'retry' || action === 'restart') {
        send(action);
        // The button click is a user gesture: take the pointer back at once (the menu released it).
        relock();
      } else if (action === 'toTitle') send('toTitle');
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
    for (const event of next.events ?? []) audio.play(event);
    const c = next.combat;
    if (c) {
      const width = (name: string, value: number, max: number) => {
        const node = part(name);
        if (node) node.style.width = `${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(1)}%`;
      };
      width('hp-fill', c.hp, c.hpMax);
      width('stamina-fill', c.stamina, c.staminaMax);
      part('hp-value')!.textContent = `${Math.round(c.hp)}`;
      part('stamina-value')!.textContent = `${Math.floor(c.stamina)}`;
      part('lotus-count')!.textContent = `×${c.lotus}`;
      part('sash-seconds')!.textContent = c.sashCd > 0 ? `${c.sashCd}` : '';
      part('sash-cooldown')!.style.setProperty('--fx-nezha-cd', `${((c.sashCd / c.sashCdMax) * 100).toFixed(1)}%`);
      if (c.flash !== lastFlash) {
        lastFlash = c.flash;
        const meter = part('stamina-meter')!;
        meter.classList.remove('flash');
        void meter.offsetWidth;
        meter.classList.add('flash');
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => meter.classList.remove('flash'), 900);
      }
      if (c.hurt !== lastHurt) {
        lastHurt = c.hurt;
        const vignette = part('hurt-vignette')!;
        vignette.classList.add('on');
        if (hurtTimer) clearTimeout(hurtTimer);
        hurtTimer = setTimeout(() => vignette.classList.remove('on'), 30);
      }
    }
    const boss = next.boss;
    part('boss-panel')!.classList.toggle('show', !!boss?.visible);
    if (boss) part('boss-fill')!.style.width = `${Math.max(0, Math.min(100, (boss.hp / boss.hpMax) * 100)).toFixed(1)}%`;
    const run = next.run;
    ui.host.classList.toggle('run-hud-off', !!run && !run.hud);
    ui.host.classList.toggle('run-menu', !!run && (run.banner || !!run.result));
    part('defeat')!.classList.toggle('show', !!run?.banner);
    part('skip-hint')!.classList.toggle('show', !!run?.skip);
    part('result')!.classList.toggle('show', !!run?.result);
    part('pause-seconds')!.textContent = run ? formatTime(run.seconds) : '';
    const sub = run?.subtitle;
    const subKey = sub ? `${sub.key}|${sub.speaker}|${status.lang}` : '';
    if (subKey !== lastSubtitle) {
      lastSubtitle = subKey;
      const box = part('subtitle')!;
      box.classList.toggle('show', !!sub);
      if (sub) {
        const speaker = part('speaker')!;
        speaker.textContent = t(sub.speaker === 'dragonKing' ? 'terms:boss.dragonKingSpeaker' : 'terms:hero.nezha');
        speaker.className = `speaker ${sub.speaker}`;
        part('line')!.textContent = t(sub.key);
      }
    }
    if (run?.result) {
      part('res-time')!.textContent = formatTime(run.result.seconds);
      part('res-hits')!.textContent = `${run.result.hits}`;
      part('res-perfect')!.textContent = `${run.result.perfects}`;
      const letter = part('res-rating')!;
      letter.textContent = run.result.rating;
      letter.className = `rating-letter ${run.result.rating}`;
    }
    // Defeat: the world greys (65 % desaturated); the HUD layer stays in colour.
    const gameCanvas = canvas();
    if (gameCanvas) {
      const filter = run?.desaturate ? 'saturate(0.35)' : '';
      if (gameCanvas.style.filter !== filter) gameCanvas.style.filter = filter;
    }
    // Run records (M4 §11): every finished attempt is kept in local storage for the difficulty pass.
    if (run && run.recordSerial !== lastRecordSerial && run.record) {
      lastRecordSerial = run.recordSerial;
      try {
        const list = JSON.parse(storage?.getItem(RUNS_KEY) ?? '[]') as unknown[];
        list.push({ ...(run.record as object), savedAt: new Date().toISOString(), lang: status.lang });
        storage?.setItem(RUNS_KEY, JSON.stringify(list.slice(-200)));
      } catch {
        /* storage full or blocked: the QA projection still has the history */
      }
    }
    // QA mirror of the Engine read projection (static preview has no inspection bridge).
    if (next.projection !== undefined) {
      ui.host.dataset.nezha = JSON.stringify(next.projection);
      ui.host.dataset.audio = JSON.stringify(audio.counts());
    }
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
    // The engine itself frees the pointer when a menu with buttons comes up; its state message can
    // land a frame after the pointer event, so the pause decision waits a moment and checks again.
    if (wasLocked && !locked && state?.phase === 'playing' && !status.debugOpen && !menuUp()) {
      view.setTimeout(() => {
        const stillFree = (host.controlMode?.read() ?? 'pointer') !== 'pointer-locked';
        if (stillFree && state?.phase === 'playing' && !status.debugOpen && !menuUp()) send('pause');
      }, 150);
    }
    if (locked) audio.unlock();
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
    if (event.code !== 'Escape' || state?.phase !== 'playing' || menuUp()) return;
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
      if (flashTimer) clearTimeout(flashTimer);
      if (hurtTimer) clearTimeout(hurtTimer);
      audio.dispose();
      for (const release of releases.reverse()) release();
      ui.dispose();
    },
  };
}
