// Boss 11-06 20:57: weapon trail + 4-hit spin, pale walking afterimages / dark roll ones, glowing blade,
// mid-air fight (two Nezhas up, bob one Nezha), whirlpool below, v1.4.0 perfect dodge (banner + flash).
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/air');
const click = async (page) => { await page.mouse.down({ button: 'left' }); await h.wait(30); await page.mouse.up({ button: 'left' }); };
const r = {};
(async () => {
  // A: on the road: walking afterimages, roll afterimages, the combo with the trail, the spin.
  let { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1');
    await h.startPlaying(page);
    await h.wait(800);
    await h.look(page, 700, 0, 10);
    await page.keyboard.down('KeyA');
    await h.wait(700);
    r.walk = await h.shot(page, OUT, '01-walk-afterimages');
    await h.hold(page, ['Space'], 40);
    await h.wait(200);
    r.roll = await h.shot(page, OUT, '02-roll-afterimages');
    await page.keyboard.up('KeyA');
    await h.wait(900);
    for (let i = 0; i < 4; i += 1) {
      await click(page);
      await h.wait(i === 3 ? 260 : 110);
      r[`light${i + 1}`] = await h.shot(page, OUT, `0${3 + i}-light-${i + 1}-trail`);
      await h.wait(i === 3 ? 600 : 220);
    }
    const s = await h.state(page);
    r.combo = s.combat.combo;
  } catch (e) { r.failA = e.stack; }
  r.errorsA = errors.slice(0, 3);
  await browser.close();
  // B: the fight in the air, whirlpool, bob ranges, perfect dodge.
  ({ browser, page, errors } = await h.launch({ lang: 'zh-CN' }));
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(2500);
    r.air = await h.shot(page, OUT, '07-fight-in-air');
    const alts = [], unders = [];
    for (let i = 0; i < 70; i += 1) { const q = await h.state(page); alts.push(q.player.altitude ?? null); unders.push(q.dragon.bodyUnderside); await h.wait(100); }
    r.dragonUnder = { min: Math.min(...unders), max: Math.max(...unders) };
    await h.look(page, 0, 260, 10);
    await h.wait(400);
    r.whirl = await h.shot(page, OUT, '08-whirlpool-below');
    await h.look(page, 0, -260, 10);
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      const q = await h.state(page);
      if (q.combat.hp < 45 && q.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      const d = q.dragon;
      if (d.telegraph && d.hitStep && d.k !== null && d.k >= d.hitStep - 9 && q.combat.stamina >= 15) {
        const before = q.combat.perfects;
        await h.hold(page, ['Space'], 40);
        await h.wait(110);
        const a = await h.state(page);
        if (a.combat.perfects > before) { r.perfect = await h.shot(page, OUT, '09-perfect-dodge'); r.slow = a.combat.tsWorld; break; }
        await h.wait(500);
      } else await h.wait(40);
    }
    r.fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(f); }));
  } catch (e) { r.failB = e.stack; }
  r.errorsB = errors.slice(0, 3);
  await browser.close();
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
})();
