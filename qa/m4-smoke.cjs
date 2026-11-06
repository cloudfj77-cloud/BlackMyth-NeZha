// M4 smoke: canyon → intro (no skip; screenshots on the shot changes) → fight hand-back.
const h = require('./harness.cjs');
(async () => {
  const OUT = h.path.join(h.ROOT, 'artifacts/m4/smoke');
  const r = { shots: [], samples: [] };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    let s = await h.state(page);
    r.start = { stage: s.fight.stage, dragon: s.dragon.mode, root: s.player.root };
    await h.goTo(page, 0, 19.5, { sprint: true, timeout: 40000, tolerance: 1.2 });
    const marks = [20, 200, 318, 365, 520, 760, 870];
    const done = new Set();
    const end = Date.now() + 22000;
    while (Date.now() < end) {
      s = await h.state(page);
      const k = s.fight.stage === 'intro' ? s.fight.k : s.fight.stage === 'fight' ? 900 : -1;
      for (const m of marks) if (!done.has(m) && k >= m) {
        done.add(m);
        r.shots.push({ m, k, file: await h.shot(page, OUT, `intro-${String(m).padStart(3, '0')}`), sub: s.fight.subtitle, head: s.dragon.head, cam: s.camera.pos, root: s.player.root, seal: s.arena.seal });
      }
      if (done.size === marks.length) break;
      await h.wait(40);
    }
    s = await h.state(page);
    r.after = { stage: s.fight.stage, lock: s.lock.active, controls: s.fight.controls, timer: s.fight.timer, dragon: s.dragon.mode, sealed: s.arena.sealed, actions: s.fight.actions };
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1).slice(0, 6000));
  await browser.close();
})();
