/**
 * Language rules shared by the menu, the loading cover (web/head.html mirrors
 * them) and tests. First visit follows the browser (zh* -> Chinese, otherwise
 * English); afterwards the player's manual choice, saved locally, wins.
 */
import type { GameLanguage } from '../shared/protocol.ts';

export const STORAGE_KEY = 'nezha.lang';
export const LANGUAGE_EVENT = 'nezha:language';

export function detectBrowserLanguage(languages: readonly (string | undefined)[]): 'zh' | 'en' {
  const first = languages.find((value) => typeof value === 'string' && value.length > 0);
  return first !== undefined && first.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export interface LanguageChoice {
  readonly lang: GameLanguage;
  readonly source: 'browser' | 'saved' | 'dev';
}

/** Saved choice beats the browser; `?lang=pseudo` (dev builds only) beats both. */
export function initialLanguage(options: {
  readonly saved: string | null;
  readonly browser: readonly (string | undefined)[];
  readonly devOverride?: string | null;
  readonly dev: boolean;
}): LanguageChoice {
  if (options.dev && (options.devOverride === 'pseudo' || options.devOverride === 'zh' || options.devOverride === 'en')) {
    return { lang: options.devOverride, source: 'dev' };
  }
  if (options.saved === 'zh' || options.saved === 'en') return { lang: options.saved, source: 'saved' };
  return { lang: detectBrowserLanguage(options.browser), source: 'browser' };
}

const ACCENTS: Readonly<Record<string, string>> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/**
 * Pseudo-localisation of one English string: accented letters, +30% length
 * padding and brackets, so hard-coded text and clipping stand out. i18next
 * nesting (`$t(...)`) and `{{interpolation}}` are kept intact.
 */
export function pseudoString(text: string): string {
  const parts = text.split(/(\$t\([^)]*\)|\{\{[^}]*\}\})/);
  const body = parts.map((part, index) => (index % 2 === 1 ? part : [...part].map((ch) => ACCENTS[ch] ?? ch).join(''))).join('');
  const visible = parts.filter((_, index) => index % 2 === 0).join('').length;
  const padding = Math.max(1, Math.ceil(visible * 0.3));
  return `[${body}${'~'.repeat(padding)}]`;
}

export function pseudoBundle(bundle: unknown): unknown {
  if (typeof bundle === 'string') return pseudoString(bundle);
  if (bundle && typeof bundle === 'object') {
    return Object.fromEntries(Object.entries(bundle as Record<string, unknown>).map(([key, value]) => [key, pseudoBundle(value)]));
  }
  return bundle;
}
