// Boss 21:55: Space during any action rolls out at once (built preview, real input).
const h = require('./harness.cjs');
(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  const rollAfter = async (label, start, waitMs) => {
    await h.waitState(page, (x) => x.combat.action === 'free' && x.combat.stamina > 60, 10000);
    await start();
    await h.wait(waitMs);
    const before = await h.state(page);
    await h.hold(page, ['Space'], 30);
    const s = await h.waitState(page, (x) => x.combat.action === 'roll', 1500).catch(() => null);
    r[label] = { from: `${before.combat.action}:${before.combat.frame}`, rolled: !!s, rollFrameWhenSeen: s?.combat.frame ?? null };
    await h.wait(700);
  };
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.goTo(page, 0, -3.5, { sprint: true, timeout: 30000, tolerance: 0.4 });
    await h.faceYaw(page, 0);
    const lmb = async () => { await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' }); };
    await rollAfter('light-windup', lmb, 30);
    await rollAfter('light-recovery', lmb, 220);
    await rollAfter('charge', () => page.mouse.down({ button: 'right' }), 400);
    await page.mouse.up({ button: 'right' });
    await h.wait(600);
    await rollAfter('heavy', async () => { await page.mouse.down({ button: 'right' }); await h.wait(350); await page.mouse.up({ button: 'right' }); }, 60);
    await rollAfter('lotus', () => h.hold(page, ['KeyQ'], 30), 150);
    await h.waitState(page, (x) => x.combat.stamina > 60, 10000);
    await h.hold(page, ['Space'], 30);
    await h.wait(150);
    const mid = await h.state(page);
    await h.hold(page, ['Space'], 30);
    await h.wait(60);
    const again = await h.state(page);
    r['roll-into-roll'] = { first: `${mid.combat.action}:${mid.combat.frame}`, after: `${again.combat.action}:${again.combat.frame}`, restarted: again.combat.action === 'roll' && again.combat.frame < mid.combat.frame };
    // Roll then attack as soon as the displacement ends.
    await h.waitState(page, (x) => x.combat.stamina > 60, 10000);
    await h.goTo(page, 0, -3.5, { timeout: 20000, tolerance: 0.4 });
    await h.faceYaw(page, 0);
    await h.hold(page, ['Space'], 30);
    await h.wait(230);
    await lmb();
    const s = await h.waitState(page, (x) => x.combat.action === 'light', 1500).catch(() => null);
    r['roll-into-attack'] = { attacked: !!s, stamina: (await h.state(page)).combat.stamina };
    // Light chain speed: three presses 0.2 s apart all land.
    await h.waitState(page, (x) => x.combat.stamina > 60, 10000);
    await h.goTo(page, 0, -4.6, { timeout: 20000, tolerance: 0.3 });
    await h.faceYaw(page, 0);
    await h.hold(page, ['KeyR'], 50);
    await h.wait(400);
    const n = (await h.state(page)).combat.hitLog.length;
    for (let i = 0; i < 3; i += 1) { await lmb(); await h.wait(200); }
    await h.wait(700);
    const after = await h.state(page);
    r.fastCombo = { stages: after.combat.hitLog.slice(n).map((x) => x.stage), distance: after.lock.distance };
  } finally {
    r.errors = errors;
    console.log(JSON.stringify(r));
    await browser.close();
  }
})();
