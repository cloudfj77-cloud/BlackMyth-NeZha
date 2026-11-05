// T0 smoke: built preview boots, title screen localized, projection `nezha` readable, start works.
const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m1/t0');
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, url);
    const inspection = await page.evaluate(async () => (await globalThis.__forgeaxGameInspection?.list()) ?? null);
    const title = await h.state(page);
    await h.wait(1200);
    console.log('reads', JSON.stringify(inspection));
    console.log('title', JSON.stringify(title));
    console.log('shot', await h.shot(page, out, 't0-title-zh'));
    await h.startPlaying(page);
    await h.wait(800);
    console.log('playing', JSON.stringify(await h.state(page)));
    console.log('shot', await h.shot(page, out, 't0-playing'));
    const adapter = await page.evaluate(async () => {
      const a = await navigator.gpu?.requestAdapter();
      const info = a?.info ?? (await a?.requestAdapterInfo?.());
      return info ? { vendor: info.vendor, architecture: info.architecture, description: info.description, isFallback: a.isFallbackAdapter } : null;
    });
    console.log('adapter', JSON.stringify(adapter));
  } catch (error) {
    console.log('FAIL', error.message);
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 't0-fail.png') });
  } finally {
    console.log('errors', JSON.stringify(errors));
    await browser.close();
  }
})();
