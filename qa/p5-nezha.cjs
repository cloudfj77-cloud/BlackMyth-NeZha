// v1.4.0 Nezha directly: idle hover near the ground (back / side / front), glide, sprint turn, light combo,
// wheels (spin, flame halo, light), 混天绫 loop, red tassel; next to the dragon (same float band).
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/nezha');
const click = async (page) => { await page.mouse.down({ button: 'left' }); await h.wait(30); await page.mouse.up({ button: 'left' }); };
(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1');
    await h.startPlaying(page);
    await h.wait(1500);
    r.back = await h.shot(page, OUT, '01-idle-back');
    await h.look(page, 900, 60, 12);
    await h.wait(700);
    r.side = await h.shot(page, OUT, '02-idle-side');
    const ys = [];
    for (let i = 0; i < 25; i += 1) { const s = await h.state(page); ys.push(s.player.modelY); await h.wait(80); }
    r.modelY = { min: Math.min(...ys), max: Math.max(...ys) };
    await h.look(page, 900, 0, 12);
    await h.wait(600);
    r.front = await h.shot(page, OUT, '03-idle-front');
    await h.look(page, -1800, -60, 20);
    await page.keyboard.down('KeyW');
    await h.wait(900);
    r.glide = await h.shot(page, OUT, '04-glide');
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyA');
    await h.wait(600);
    r.turn = await h.shot(page, OUT, '05-sprint-turn');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    await h.wait(300);
    r.stop = await h.shot(page, OUT, '06-stop-sink');
    await h.look(page, 700, 0, 10);
    for (let i = 0; i < 3; i += 1) { await click(page); await h.wait(180); r[`light${i}`] = await h.shot(page, OUT, `07-light-${i + 1}`); }
    await h.wait(600);
  } catch (e) { r.fail = e.stack; }
  r.errors = errors.slice(0, 8);
  await browser.close();
  // Next to the dragon.
  const b = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(b.page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(b.page);
    await h.waitState(b.page, (q) => q.fight.stage === 'fight', 8000);
    await h.hold(b.page, ['KeyR'], 60);
    await h.wait(1200);
    await h.look(b.page, 500, 80, 8);
    await h.wait(400);
    r.withDragon = await h.shot(b.page, OUT, '08-with-dragon');
    const s = await h.state(b.page);
    r.dragonUnder = s.dragon.bodyUnderside;
    r.nezhaModelY = s.player.modelY;
  } catch (e) { r.fail2 = e.stack; }
  r.errors2 = b.errors.slice(0, 8);
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  await b.browser.close();
})();
