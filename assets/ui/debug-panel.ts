/**
 * Development tuning panel (dev builds only: `?dev=1`, toggled with F2).
 * Not localized (developer tool; QA skips it when scanning for Chinese text).
 * Every edit goes to the Engine, which clamps it and mirrors the live values back.
 */
import { TUNING_RANGES, type TuningPath } from '../shared/tuning.ts';

export interface DebugPanelHost {
  readonly root: HTMLElement;
  readonly set: (path: string, value: number) => void;
  readonly reset: () => void;
  readonly language: (lang: 'zh' | 'en' | 'pseudo') => void;
  readonly grey: (on: boolean) => void;
}

export interface DebugPanel {
  readonly update: (tuning: Readonly<Record<string, Readonly<Record<string, number>>>>) => void;
  readonly setFlags: (flags: { readonly lang: string; readonly grey: boolean }) => void;
  readonly dispose: () => void;
}

export function createDebugPanel(host: DebugPanelHost): DebugPanel {
  const document = host.root.ownerDocument;
  const releases: (() => void)[] = [];
  const on = (node: EventTarget, type: string, listener: (event: Event) => void) => {
    node.addEventListener(type, listener);
    releases.push(() => node.removeEventListener(type, listener));
  };
  const rows = new Map<string, { input: HTMLInputElement; output: HTMLOutputElement }>();
  let latest: Readonly<Record<string, Readonly<Record<string, number>>>> = {};
  const value = (path: string) => {
    const [group, key] = path.split('.') as [string, string];
    return latest[group]?.[key];
  };

  const heading = (text: string) => {
    const node = document.createElement('h4');
    node.textContent = text;
    host.root.append(node);
  };
  const actions = (buttons: readonly (readonly [string, string, () => void])[]) => {
    const bar = document.createElement('div');
    bar.className = 'actions';
    for (const [id, label, run] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.dev = id;
      on(button, 'click', () => {
        run();
        (button as HTMLButtonElement).blur();
      });
      bar.append(button);
    }
    host.root.append(bar);
  };

  heading('Presets');
  actions([
    ['target-2x4', 'Target 2×4', () => { host.set('lock.targetHeight', 2); host.set('lock.targetLength', 4); }],
    ['target-5x12', 'Target 5×12', () => { host.set('lock.targetHeight', 5); host.set('lock.targetLength', 12); }],
    ['target-8x20', 'Target 8×20', () => { host.set('lock.targetHeight', 8); host.set('lock.targetLength', 20); }],
    ['cam-5.0', 'Camera 5.0', () => host.set('camera.distance', 5)],
    ['cam-5.4', 'Camera 5.4', () => host.set('camera.distance', 5.4)],
  ]);
  actions([
    ['seaweed-0', 'Seaweed 0', () => { host.set('ambient.seaweedCanyon', 0); host.set('ambient.seaweedEdge', 0); host.set('ambient.seaweedFar', 0); }],
    ['seaweed-480', 'Seaweed 480', () => { host.set('ambient.seaweedCanyon', 240); host.set('ambient.seaweedEdge', 180); host.set('ambient.seaweedFar', 60); }],
    ['seaweed-1200', 'Seaweed 1200', () => { host.set('ambient.seaweedCanyon', 600); host.set('ambient.seaweedEdge', 450); host.set('ambient.seaweedFar', 150); }],
  ]);
  actions([
    ['lang-zh', 'zh', () => host.language('zh')],
    ['lang-en', 'en', () => host.language('en')],
    ['lang-pseudo', 'pseudo', () => host.language('pseudo')],
    ['grey', 'Grey model', () => host.grey(!greyOn)],
    ['reset', 'Reset all', () => host.reset()],
    ['export', 'Export tuning.json', () => exportJson()],
  ]);

  let group = '';
  for (const [path, range] of Object.entries(TUNING_RANGES) as [TuningPath, readonly [number, number, number]][]) {
    const [name, key] = path.split('.') as [string, string];
    if (name !== group) {
      group = name;
      heading(name);
    }
    const row = document.createElement('label');
    row.className = 'row';
    const caption = document.createElement('span');
    caption.textContent = key;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range[0]);
    input.max = String(range[1]);
    input.step = String(range[2]);
    input.dataset.path = path;
    const output = document.createElement('output');
    on(input, 'input', () => {
      output.textContent = input.value;
      host.set(path, Number(input.value));
    });
    row.append(caption, input, output);
    host.root.append(row);
    rows.set(path, { input, output });
  }

  let greyOn = false;
  const exportJson = () => {
    const text = `${JSON.stringify(latest, null, 2)}\n`;
    const view = document.defaultView;
    if (!view) return;
    const url = view.URL.createObjectURL(new view.Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tuning.json';
    link.click();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  };

  return {
    update: (tuning) => {
      latest = tuning;
      for (const [path, { input, output }] of rows) {
        const current = value(path);
        const focused = (host.root.getRootNode() as Document | ShadowRoot).activeElement;
        if (current === undefined || focused === input) continue;
        input.value = String(current);
        output.textContent = String(Math.round(current * 1000) / 1000);
      }
    },
    setFlags: ({ lang, grey }) => {
      greyOn = grey;
      for (const button of host.root.querySelectorAll<HTMLButtonElement>('[data-dev]')) {
        const id = button.dataset.dev ?? '';
        button.classList.toggle('active', id === `lang-${lang}` || (id === 'grey' && grey));
      }
    },
    dispose: () => {
      for (const release of releases.reverse()) release();
      host.root.replaceChildren();
    },
  };
}
