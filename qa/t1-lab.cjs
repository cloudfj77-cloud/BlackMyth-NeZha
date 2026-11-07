// T1 material lab: pillar fade routes side by side (Alpha Hash / quantised steps / blended glass),
// outline on the faded pillar, wheel emissive readability without bloom, GPU adapter identity.
const h = require('./harness.cjs');
(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const out = h.path.join(h.ROOT, 'artifacts/m1/experiments');
  const cases = [
    ['lab-0-baseline', '?dev=1'],
    ['lab-A-alphahash', '?dev=1&lab=force'],
    ['lab-B1-steps', '?dev=1&lab=force&fade=steps'],
    ['lab-B2-glass', '?dev=1&lab=force&fade=glass'],
  ];
  const results = {};
  for (const [name, query] of cases) {
    const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
    try {
      await h.open(page, base + query);
      // Hide the title overlay so the pillar and Nezha read clearly in the review frame.
      await page.evaluate(() => {
        const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
        if (host) host.style.visibility = 'hidden';
      });
      await h.wait(1500);
      const s = await h.state(page);
      results[name] = { occlusion: s?.occlusion, errors };
      await h.shot(page, out, name);
      if (name === 'lab-0-baseline') {
        results.adapter = await page.evaluate(async () => {
          const a = await navigator.gpu?.requestAdapter();
          const info = a?.info;
          return info ? { vendor: info.vendor, architecture: info.architecture, description: info.description, fallback: a.isFallbackAdapter ?? null } : null;
        });
        // Close-up of the wheels and contact glow (crop of the same frame).
        await page.screenshot({ path: h.path.join(out, 'lab-wheels-closeup.png'), clip: { x: 520, y: 330, width: 240, height: 150 } });
      }
    } catch (error) {
      results[name] = { fail: error.message, errors };
    } finally {
      await browser.close();
    }
  }
  h.fs.writeFileSync(h.path.join(out, 'lab.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 1));
})();
