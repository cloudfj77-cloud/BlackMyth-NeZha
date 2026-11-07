// P1 acceptance: bilingual UI on the BUILT preview — no Chinese left in English, pseudo-locale fits,
// the manual choice survives a reload (loading cover included), and non-UI modules get the change event.
const h = require('./harness.cjs');
const NEUTRAL = new Set(['W', 'A', 'S', 'D', 'Shift', 'R', 'Esc', '中文', 'EN', '/', 'DEV · F2']);
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;

function audit(texts) {
  const leaves = texts.filter((t) => !NEUTRAL.has(t.text));
  const overlaps = [];
  for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) {
    const a = texts[i].rect, b = texts[j].rect;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 2 && iy > 2) overlaps.push([texts[i].text.slice(0, 16), texts[j].text.slice(0, 16)]);
  }
  return { count: leaves.length, cjk: leaves.filter((t) => CJK.test(t.text)).map((t) => t.text), overflow: texts.filter((t) => t.overflow).map((t) => t.text), overlaps };
}

(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = {};
  // English browser at both layout sizes: title + pause.
  for (const [w, hgt] of [[1280, 720], [1280, 600]]) {
    const key = `en-${w}x${hgt}`;
    const { browser, page, errors } = await h.launch({ lang: 'en-US', width: w, height: hgt });
    try {
      await h.open(page, `${base}?qa=1`);
      await h.wait(500);
      const s = await h.state(page);
      const title = audit(await h.visibleTexts(page));
      if (hgt === 720) await h.shot(page, out, 'lang-en');
      await h.startPlaying(page);
      await h.wait(300);
      await page.keyboard.press('Escape');
      await h.waitState(page, (x) => x.ui.phase === 'paused');
      await h.wait(300);
      const pause = audit(await h.visibleTexts(page));
      if (hgt === 720) await h.shot(page, out, 'lang-en-paused');
      const docTitle = await page.title();
      result[key] = { lang: s.i18n.lang, source: s.i18n.source, docTitle, title, pause, errors };
    } catch (error) {
      result[key] = { fail: error.stack, errors };
    } finally {
      await browser.close();
    }
  }
  // Chinese browser: all Chinese; switch to EN on the pause screen, reload, choice remembered; event delivered.
  {
    const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
    const r = (result.zh = {});
    try {
      await h.open(page, `${base}?qa=1`);
      await h.wait(400);
      r.initial = (await h.state(page)).i18n;
      r.titleTexts = (await h.visibleTexts(page)).map((t) => t.text).filter((t) => !NEUTRAL.has(t)).slice(0, 6);
      await h.shot(page, out, 'lang-zh');
      await page.evaluate(() => {
        window.__langEvents = [];
        window.addEventListener('nezha:language', (e) => window.__langEvents.push(e.detail.lang));
      });
      await h.startPlaying(page);
      await page.keyboard.press('Escape');
      await h.waitState(page, (x) => x.ui.phase === 'paused');
      await h.click(page, '[data-ui-action="lang-en"]');
      const switched = await h.waitState(page, (x) => x.i18n.lang === 'en');
      r.afterSwitch = { i18n: switched.i18n, windowEvents: await page.evaluate(() => window.__langEvents), audit: audit(await h.visibleTexts(page)) };
      await h.shot(page, out, 'lang-switch-en');
      // Reload: the cover and the menu must open in English (saved choice beats the zh browser).
      await page.goto(`${base}?qa=1`, { waitUntil: 'domcontentloaded' });
      const coverTitle = await page.evaluate(() => document.getElementById('forgeax-loading-title')?.textContent ?? document.title);
      await page.waitForSelector('html[data-forgeax-input="open"]', { timeout: 120000 });
      const reloaded = await h.waitState(page, (x) => x.ui.phase === 'title');
      r.afterReload = { coverTitle, i18n: reloaded.i18n };
      r.errors = errors;
    } catch (error) {
      r.fail = error.stack;
      r.errors = errors;
    } finally {
      await browser.close();
    }
  }
  // Pseudo-locale (dev only), smallest layout: everything bracketed, nothing clipped or overlapping.
  {
    const { browser, page, errors } = await h.launch({ lang: 'en-US', width: 1280, height: 600 });
    try {
      await h.open(page, `${base}?dev=1&lang=pseudo`);
      await h.wait(500);
      const texts = await h.visibleTexts(page);
      const a = audit(texts);
      const unbracketed = texts.map((t) => t.text).filter((t) => !NEUTRAL.has(t) && !/^\[.*\]$/.test(t));
      await h.shot(page, out, 'lang-pseudo');
      await h.startPlaying(page);
      await page.keyboard.press('Escape');
      await h.waitState(page, (x) => x.ui.phase === 'paused');
      await h.wait(300);
      const p = audit(await h.visibleTexts(page));
      await h.shot(page, out, 'lang-pseudo-paused');
      result.pseudo = { title: a, unbracketed, pause: p, lang: (await h.state(page)).i18n, errors };
    } catch (error) {
      result.pseudo = { fail: error.stack, errors };
    } finally {
      await browser.close();
    }
  }
  h.fs.writeFileSync(h.path.join(out, 'p1.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})();
