const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  const r = {};
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.goTo(page, 0, 12, { sprint: true, timeout: 40000, tolerance: 0.6 });
    await h.wait(1500);
    for (let k = 0; k < 3; k += 1) {
      const q = await h.state(page);
      const hd = q.dragon.head, pr = q.player.root;
      await h.faceYaw(page, Math.atan2(-(hd[0] - pr[0]), -(hd[2] - pr[2])));
      await h.shot(page, h.path.join(h.ROOT, 'artifacts/m3/smoke'), `diag-face-${k}`);
      await h.wait(700);
    }
    const s = await h.state(page);
    r.dragon = { ...s.dragon, log: undefined, polygon: undefined };
    r.player = s.player.root;
    r.cam = s.camera.pos;
    await h.shot(page, h.path.join(h.ROOT, 'artifacts/m3/smoke'), 'diag');
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1).slice(0, 5000));
  await browser.close();
})();
