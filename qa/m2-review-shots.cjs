// Side-on review frames for screenshot review: heavy flame and a light thrust, camera turned 90°.
const h = require('./harness.cjs');
(async () => {
  const out = h.path.join(h.ROOT, 'artifacts/m2');
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.goTo(page, -6, 6, { tolerance: 0.5, timeout: 30000 });
    await h.faceYaw(page, 0);
    await h.hold(page, ['KeyW'], 120);
    await h.wait(400);
    await h.look(page, -900, 0, 20); // swing the camera to Nezha's right side
    await h.wait(500);
    await page.mouse.down({ button: 'right' });
    await h.wait(1300);
    await h.shot(page, out, 'review-charge-side');
    await page.mouse.up({ button: 'right' });
    // The flame lives for frames 7..15 (0.15 s): poll without delay and shoot as soon as it appears.
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      const x = await h.state(page);
      if (x?.combat.action === 'heavy' && x.combat.frame >= 6) break;
    }
    await h.shot(page, out, 'review-flame-side');
    await h.wait(900);
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    await h.waitState(page, (x) => x.combat.action === 'light' && x.combat.frame >= 8, 3000);
    await h.shot(page, out, 'review-thrust-side');
    await h.wait(800);
    await h.hold(page, ['Space'], 40);
    await h.waitState(page, (x) => x.combat.action === 'roll' && x.combat.frame >= 7, 3000);
    await h.shot(page, out, 'review-roll-side');
  } finally {
    console.log('errors', JSON.stringify(errors));
    await browser.close();
  }
})();
