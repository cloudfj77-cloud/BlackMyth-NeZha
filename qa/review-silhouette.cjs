// Screenshot review #12: grey-model silhouette from 30 m (1920x1080), plus the colour frame for comparison.
const h = require('./harness.cjs');
(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN', width: 1920, height: 1080 });
  try {
    await h.open(page, `${base}?dev=1&grey=1&lab=far30`);
    await h.startPlaying(page);
    await h.wait(500);
    await h.goTo(page, 0, 2, { sprint: true, timeout: 30000 });
    await h.faceYaw(page, 0);
    await h.hold(page, ['KeyD'], 220); // turn side-on: spear and buns in profile
    await h.wait(1200);
    const shotFrame = async (name) => {
      const s = await h.state(page);
      const b = s.lock.nezhaBox;
      const cx = ((b.minX + b.maxX) / 2) * 1920, cy = ((b.minY + b.maxY) / 2) * 1080;
      await h.shot(page, out, name);
      await page.screenshot({ path: h.path.join(out, `${name}-zoom.png`), clip: { x: Math.max(0, cx - 160), y: Math.max(0, cy - 120), width: 320, height: 240 } });
      return { cameraDistance: s.camera.distance, grey: s.silhouette.grey, nezhaPx: { w: Math.round((b.maxX - b.minX) * 1920), h: Math.round((b.maxY - b.minY) * 1080) }, inFrame: b.inFrame };
    };
    result.grey = await shotFrame('review-silhouette-30m');
    await page.keyboard.press('F2');
    await h.waitState(page, (x) => x.ui.debugOpen, 5000);
    await h.click(page, '[data-dev="grey"]');
    await h.waitState(page, (x) => x.silhouette.grey === false, 5000);
    await page.keyboard.press('F2');
    await h.wait(800);
    result.colour = await shotFrame('review-silhouette-30m-colour');
  } catch (error) {
    result.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 'review12-fail.png') });
  } finally {
    result.errors = errors;
    h.fs.writeFileSync(h.path.join(out, 'review-12.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await browser.close();
  }
})();
