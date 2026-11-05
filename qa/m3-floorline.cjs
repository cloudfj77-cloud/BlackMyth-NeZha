const h = require('./harness.cjs');
(async () => {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  const r = {};
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.goTo(page, 0, 14, { sprint: true, timeout: 40000, tolerance: 0.5 });
    await h.faceYaw(page, Math.PI / 2);
    await h.look(page, 0, 450, 10); // pitch down hard (look at the floor around Nezha)
    await h.wait(400);
    const s = await h.state(page);
    r.root = s.player.root; r.cam = s.camera.pos; r.pitch = s.camera.pitch; r.arena = s.arena;
    await h.shot(page, h.path.join(h.ROOT, 'artifacts/m3/diag'), 'floor-r14');
    await h.goTo(page, 0, 6, { timeout: 15000, tolerance: 0.5 });
    await h.faceYaw(page, Math.PI / 2);
    await h.wait(300);
    await h.shot(page, h.path.join(h.ROOT, 'artifacts/m3/diag'), 'floor-r6');
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  console.log(JSON.stringify(r));
  await browser.close();
})();
