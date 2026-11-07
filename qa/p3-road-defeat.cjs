// Port batch 3, step 2b: falling on the 陈塘关 road. `lab=frail` makes a yaksha stab deal ×10.
// Walk past the lotus? No — stand at wave 1, take a stab, see 「败」, press Enter: back at the start,
// waves and gate reset, full health; then light the lotus, fall in wave 2, and come back at the lotus.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/yaksha');
(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=frail');
    await h.startPlaying(page);
    await h.wait(600);
    await h.goTo(page, 0, 95, { tolerance: 1, timeout: 15000 });
    let s = await h.waitState(page, (q) => q.yaksha.alive > 0, 3000);
    await h.wait(1200);
    r.hudOnRoad = await h.shot(page, OUT, '05-road-hud-bars');
    s = await h.state(page);
    r.bars = s.mobs ?? null;
    s = await h.waitState(page, (q) => q.fight.stage === 'defeat', 30000);
    r.defeat = { stage: s.fight.stage, hp: s.combat.hp, records: s.fight.history.length };
    await h.wait(1500);
    r.banner = await h.shot(page, OUT, '06-road-defeat');
    await page.keyboard.press('Enter');
    s = await h.waitState(page, (q) => q.fight.stage === 'canyon', 5000);
    await h.wait(500);
    s = await h.state(page);
    r.retry1 = { root: s.player.root, hp: s.combat.hp, wave: s.yaksha.wave, alive: s.yaksha.alive, gate: s.sea.gateOpen, lit: s.yaksha.lit };
    // Second try: the waves come again at the same line.
    await h.goTo(page, 0, 95, { tolerance: 1, timeout: 15000 });
    s = await h.waitState(page, (q) => q.yaksha.alive > 0, 3000);
    r.wavesAgain = s.yaksha.wave;
  } catch (e) { r.fail = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'fail-defeat.png') }).catch(() => {}); }
  r.errors = errors.slice(0, 10);
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  await browser.close();
})();
