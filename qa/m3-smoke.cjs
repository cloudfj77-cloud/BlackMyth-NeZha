// M3 smoke: canyon -> vortex, dragon swims / telegraphs / strikes; boss bar; screenshots for the boss.
const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m3/smoke');
  const r = { samples: [] };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    let s = await h.state(page);
    r.start = { root: s.player.root, dragon: s.dragon && { mode: s.dragon.mode, head: s.dragon.head }, sections: Object.keys(s) };
    await h.shot(page, out, '00-canyon');
    await h.goTo(page, 0, 12, { sprint: true, timeout: 40000, tolerance: 0.6 });
    await h.faceYaw(page, 0);
    await h.shot(page, out, '01-arena-entry');
    for (let i = 0; i < 16; i += 1) {
      await h.wait(500);
      s = await h.state(page);
      r.samples.push({ t: i, mode: s.dragon.mode, kind: s.dragon.kind, k: s.dragon.k, tele: s.dragon.telegraph, head: s.dragon.head, hp: s.combat.hp, fight: s.fight.log.slice(-1)[0] ?? null });
      if (i % 2 === 1) await h.shot(page, out, `02-watch-${String(i).padStart(2, '0')}`);
    }
    r.fight = s.fight;
    r.arena = s.arena;
    r.camera = { focus: s.camera.pos, aimRaise: s.camera.aimRaise };
    r.float = s.float;
    r.sash = s.sash;
  } catch (error) {
    r.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 'm3-smoke-fail.png') });
  } finally {
    r.errors = errors;
    console.log(JSON.stringify(r, null, 1).slice(0, 6000));
    await browser.close();
  }
})();
