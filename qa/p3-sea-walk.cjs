// Port batch 3, step 1: 陈塘关 scene walk-through with real keys. Spawn view down the boardwalk,
// the 「陈塘关」 arch behind, lotus pond, water gate, platform, fight start (mist + runes + arena light),
// and the walking limits (boardwalk edge, platform edge in the fight).
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/sea');
(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1');
    await h.startPlaying(page);
    await h.wait(1200);
    let s = await h.state(page);
    r.spawn = { root: s.player.root, stage: s.fight.stage, sea: s.sea };
    r.s01 = await h.shot(page, OUT, '01-spawn-boardwalk');
    // The arch and its 「陈塘关」 board up close (walk north: the camera trails behind, facing the arch).
    await h.goTo(page, 0, 114.5, { tolerance: 0.8, timeout: 8000 });
    await h.wait(600);
    r.s09 = await h.shot(page, OUT, '09-arch-close');
    s = await h.state(page);
    r.plaque = s.sea.plaque;
    await h.goTo(page, 0, 110, { tolerance: 0.8, timeout: 8000 });
    await h.look(page, 1800, 0, 20); // turn round: the arch and the open sea behind
    await h.wait(500);
    r.s02 = await h.shot(page, OUT, '02-arch-behind');
    await h.look(page, -1800, 0, 20);
    // Side limit: push hard right on the boardwalk.
    await h.hold(page, ['KeyD'], 1500);
    s = await h.state(page);
    r.sideLimit = s.player.root;
    await h.look(page, -500, 120, 8);
    await h.wait(300);
    r.s03 = await h.shot(page, OUT, '03-boardwalk-edge-sea');
    await h.look(page, 500, -120, 8);
    // Walk to the lotus pond.
    await h.goTo(page, 0, 56, { sprint: true, tolerance: 1.2, timeout: 20000 });
    await h.wait(300);
    r.s04 = await h.shot(page, OUT, '04-lotus-pond');
    // To the water gate.
    await h.goTo(page, 0, 27, { sprint: true, tolerance: 1.2, timeout: 15000 });
    await h.wait(300);
    r.s05 = await h.shot(page, OUT, '05-water-gate');
    // Through it onto the platform: the fight starts.
    await h.goTo(page, 0, 16, { sprint: true, tolerance: 1.5, timeout: 10000 });
    s = await h.waitState(page, (q) => q.fight.stage !== 'canyon', 6000);
    r.fightStart = { stage: s.fight.stage, root: s.player.root };
    await h.wait(2500);
    r.s06 = await h.shot(page, OUT, '06-intro');
    // Skip the intro, fight a moment, test the platform edge.
    await page.keyboard.press('Enter');
    s = await h.waitState(page, (q) => q.fight.stage === 'fight', 15000);
    await h.wait(1500);
    s = await h.state(page);
    r.fight = { sea: s.sea, root: s.player.root };
    r.s07 = await h.shot(page, OUT, '07-fight-platform');
    await h.hold(page, ['KeyR'], 60);
    await h.hold(page, ['KeyW'], 4000);
    s = await h.state(page);
    r.edge = { root: s.player.root, r: Math.hypot(s.player.root[0], s.player.root[2]) };
    r.s08 = await h.shot(page, OUT, '08-platform-edge');
    r.perf = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(f); }));
  } catch (e) { r.fail = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'fail.png') }).catch(() => {}); }
  r.errors = errors.slice(0, 10);
  console.log(JSON.stringify(r, null, 1).slice(0, 4000));
  await browser.close();
})();
