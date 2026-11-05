import { describe, expect, it } from 'vitest';
import TABLE from '../ui/menu.ui.i18n.json' with { type: 'json' };
import CONTEXT from '../i18n/context.json' with { type: 'json' };
import { detectBrowserLanguage, initialLanguage, pseudoString } from '../i18n/language.ts';

type Tree = { readonly [key: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}
const keys = (lang: 'zh' | 'en') => {
  const out = new Map<string, string>();
  for (const [ns, tree] of Object.entries(TABLE.resources[lang])) for (const [k, v] of flatten(tree as Tree)) out.set(`${ns}:${k}`, v);
  return out;
};

describe('language table', () => {
  const zh = keys('zh');
  const en = keys('en');
  it('has the same keys in Chinese and English (no key can fall through to a raw key name)', () => {
    expect([...zh.keys()].sort()).toEqual([...en.keys()].sort());
  });
  it('keys follow region.screen.purpose (terms are their own namespace)', () => {
    for (const key of en.keys()) {
      const [ns, path] = key.split(':') as [string, string];
      expect(['ui', 'terms']).toContain(ns);
      if (ns === 'ui') expect(path.split('.').length).toBeGreaterThanOrEqual(3);
    }
  });
  it('documents every key for translators in i18n/context.json', () => {
    const context = new Set(Object.keys(CONTEXT).filter((key) => !key.startsWith('_')));
    expect([...en.keys()].filter((key) => !context.has(key))).toEqual([]);
    expect([...context].filter((key) => !en.has(key))).toEqual([]);
  });
  it('keeps English free of CJK characters and HUD hints within the 28-character budget', () => {
    for (const [key, value] of en) {
      expect(/[\u3400-\u9fff]/.test(value), key).toBe(false);
      if (key.startsWith('ui:hud.hint.')) expect(value.length, key).toBeLessThanOrEqual(28);
    }
  });
});

describe('language choice', () => {
  it('follows the browser on first visit: zh* -> Chinese, everything else English', () => {
    expect(detectBrowserLanguage(['zh-CN'])).toBe('zh');
    expect(detectBrowserLanguage(['zh-TW', 'en'])).toBe('zh');
    expect(detectBrowserLanguage(['ja-JP', 'zh-CN'])).toBe('en');
    expect(initialLanguage({ saved: null, browser: ['de-DE'], dev: false })).toEqual({ lang: 'en', source: 'browser' });
  });
  it('remembers the manual choice afterwards', () => {
    expect(initialLanguage({ saved: 'zh', browser: ['en-US'], dev: false })).toEqual({ lang: 'zh', source: 'saved' });
    expect(initialLanguage({ saved: 'en', browser: ['zh-CN'], dev: false })).toEqual({ lang: 'en', source: 'saved' });
  });
  it('allows pseudo only in dev builds', () => {
    expect(initialLanguage({ saved: null, browser: ['en'], devOverride: 'pseudo', dev: true }).lang).toBe('pseudo');
    expect(initialLanguage({ saved: null, browser: ['en'], devOverride: 'pseudo', dev: false }).lang).toBe('en');
  });
  it('pseudo-localises with +30% length and brackets, keeping nesting intact', () => {
    const out = pseudoString('Resume');
    expect(out.startsWith('[') && out.endsWith(']')).toBe(true);
    expect(out.length - 2).toBeGreaterThanOrEqual(Math.ceil('Resume'.length * 1.3));
    expect(pseudoString('$t(terms:hero.nezha) rides')).toContain('$t(terms:hero.nezha)');
  });
});
