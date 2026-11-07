// Port batch 2: jointed Nezha — idle (back / front), glide, sprint turn, light combo, charge, heavy, roll.
const h = require('./harness.cjs');
(async () => {
  const OUT = h.path.join(h.ROOT, 'artifacts/port/rig');
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.hold(page, ['KeyR'], 60); // free camera
    await h.wait(800);
    r.idleBack = await h.shot(page, OUT, '01-idle-back');
    await h.look(page, 1800, 0, 20); // ~180°
    await h.wait(700);
    r.idleFront = await h.shot(page, OUT, '02-idle-front');
    let s = await h.state(page);
    r.rig = s.rig;
    await h.look(page, -1800, 0, 20);
    await page.keyboard.down('KeyW');
    await h.wait(700);
    r.glide = await h.shot(page, OUT, '03-glide');
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyA');
    await h.wait(500);
    r.sprintTurn = await h.shot(page, OUT, '04-sprint-turn');
    s = await h.state(page);
    r.rigTurn = s.rig.hover;
    await page.keyboard.up('KeyA');
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
    await h.wait(400);
    await h.look(page, 900, 0, 10); // side view
    await h.wait(300);
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
      await h.wait(170);
      r[`light${i + 1}`] = await h.shot(page, OUT, `05-light-${i + 1}`);
    }
    await h.wait(400);
    await page.mouse.down({ button: 'right' });
    await h.wait(900);
    r.charge = await h.shot(page, OUT, '06-charge');
    await page.mouse.up({ button: 'right' });
    await h.wait(140);
    r.heavy = await h.shot(page, OUT, '07-heavy');
    await h.wait(600);
    await h.hold(page, ['Space'], 40);
    await h.wait(150);
    r.roll = await h.shot(page, OUT, '08-roll');
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  await browser.close();
})();
