// T6 acceptance: a real pillar between the lens and Nezha fades within 0.2 s, Nezha stays ≥ 90 % visible.
// Nezha stands south of the canyon pillar; the player sweeps the camera with the mouse until the pillar
// crosses the line of sight. Route A (screen-door fade) is measured; route B2 (glass) is shot for review.
const h = require('./harness.cjs');
(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = {};
  for (const [route, query] of [['A', '?qa=1'], ['B2', '?dev=1&fade=glass']]) {
    const r = (result[route] = {});
    const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
    try {
      await h.open(page, base + query);
      await h.startPlaying(page);
      await h.wait(500);
      await h.goTo(page, 0, 35.5, { tolerance: 0.3, timeout: 25000 });
      await h.faceYaw(page, 0.15);
      await h.wait(600);
      const before = await h.state(page);
      r.before = { occluded: (before.occlusion.pillars ?? []).length, visible: before.occlusion.nezhaVisible200 };
      let hit;
      for (let step = 0; step < 40 && !hit; step += 1) {
        await h.look(page, -25, 0, 2); // 2.5° per step
        await h.wait(60);
        const s = await h.state(page);
        const p = (s.occlusion.pillars ?? []).find((x) => x.occluded);
        if (p) hit = { yawDeg: +((s.camera.yaw * 180) / Math.PI).toFixed(1), id: p.id };
      }
      if (!hit) throw new Error('no pillar ever occluded Nezha during the sweep');
      await h.wait(450);
      const s = await h.state(page);
      const p = s.occlusion.pillars.find((x) => x.id === hit.id);
      r.occlusion = { ...hit, opacity: p.opacity, fadeToBelow04: p.fadeToBelow04, nezhaVisible200: s.occlusion.nezhaVisible200, route: s.occlusion.route };
      r.pass = route === 'A' ? p.fadeToBelow04 !== null && p.fadeToBelow04 <= 0.2 && p.opacity <= 0.4 && s.occlusion.nezhaVisible200 >= 0.9 : undefined;
      await h.shot(page, out, route === 'A' ? 'pillar' : 'review-pillar-glass');
      // Swing back out: the pillar must return to solid.
      await h.look(page, 250, 0, 10);
      await h.wait(600);
      const after = await h.state(page);
      r.restored = !(after.occlusion.pillars ?? []).some((x) => x.id === hit.id && x.opacity < 0.99);
    } catch (error) {
      r.fail = error.stack;
      await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), `t6-${route}-fail.png`) });
    } finally {
      r.errors = errors;
      await browser.close();
    }
  }
  h.fs.writeFileSync(h.path.join(out, 't6.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})();
