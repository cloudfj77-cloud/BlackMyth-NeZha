// Side-on frame strips of the roll and the light combo (screenshot review of the reworked motion).
const h = require('./harness.cjs');
(async () => {
  const out = h.path.join(h.ROOT, 'artifacts/m2/motion');
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN', width: 960, height: 540 });
  const strip = async (name, trigger, count, gap) => {
    await trigger();
    for (let i = 0; i < count; i += 1) {
      await page.screenshot({ path: h.path.join(h.ensureDir(out), `${name}-${String(i).padStart(2, '0')}.png`), clip: { x: 230, y: 90, width: 500, height: 400 } });
      if (gap) await h.wait(gap);
    }
  };
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.goTo(page, -6, 6, { tolerance: 0.5, timeout: 30000 });
    await h.faceYaw(page, 0);
    await h.hold(page, ['KeyW'], 120);
    await h.wait(400);
    await h.look(page, -900, 0, 20);
    await h.wait(600);
    await strip('roll', async () => {
      await page.keyboard.down('KeyD');
      await h.hold(page, ['Space'], 30);
      await page.keyboard.up('KeyD');
    }, 10, 0);
    await h.wait(1200);
    await strip('combo', async () => {
      await page.mouse.down({ button: 'left' });
      await page.mouse.up({ button: 'left' });
    }, 6, 0);
    const s = await h.state(page);
    console.log('stamina after one light', s.combat.stamina);
  } finally {
    console.log('errors', JSON.stringify(errors));
    await browser.close();
  }
})();
