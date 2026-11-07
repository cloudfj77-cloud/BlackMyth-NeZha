// M2 smoke: boots, light attack on the dummy, heavy, roll, T fake attack — reads `combat` / `dummy`.
const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m2/smoke');
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.goTo(page, 0, -4.2, { sprint: true, timeout: 30000, tolerance: 0.4 });
    await h.faceYaw(page, 0);
    let s = await h.state(page);
    r.atDummy = { root: s.player.root, dist: s.lock.distance };
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    await h.wait(150);
    await h.shot(page, out, 'light-1');
    await h.wait(600);
    s = await h.state(page);
    r.light = { hitLog: s.combat.hitLog, stamina: s.combat.stamina, action: s.combat.action };
    await page.mouse.down({ button: 'right' });
    await h.wait(900);
    await h.shot(page, out, 'charge');
    await page.mouse.up({ button: 'right' });
    await h.wait(170);
    await h.shot(page, out, 'heavy');
    await h.wait(600);
    s = await h.state(page);
    r.heavy = { hitLog: s.combat.hitLog.slice(-1), judgeLine: s.combat.judgeLine, stamina: s.combat.stamina, swayDeg: s.dummy.swayDeg };
    await h.hold(page, ['KeyT'], 60);
    await h.wait(300);
    await h.shot(page, out, 'warning-line');
    await h.wait(900);
    s = await h.state(page);
    r.fake = { outcomes: s.dummy.outcomes, hp: s.combat.hp };
    await h.hold(page, ['KeyY'], 60);
    await h.wait(700);
    await h.hold(page, ['Space'], 60);
    await h.wait(80);
    await h.shot(page, out, 'roll');
    await h.wait(900);
    s = await h.state(page);
    r.roll = { outcomes: s.dummy.outcomes.slice(-1), hp: s.combat.hp, stamina: s.combat.stamina };
    await h.hold(page, ['Digit1'], 60);
    await h.wait(400);
    await h.shot(page, out, 'sash-bind');
    s = await h.state(page);
    r.sash = { bound: s.dummy.bound, sashCd: s.combat.sashCd };
  } catch (error) {
    r.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 'm2-smoke-fail.png') });
  } finally {
    r.errors = errors;
    console.log(JSON.stringify(r, null, 1).slice(0, 3500));
    await browser.close();
  }
})();
