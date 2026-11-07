const h = require('./harness.cjs');
(async () => {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  const r = { shots: [] };
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.goTo(page, 0, 2, { sprint: true, tolerance: 1, timeout: 6000 });
    const end = Date.now() + 60000;
    let roll = 0;
    while (Date.now() < end && r.shots.length < 2) {
      const s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      if (s.dragon.seeThrough >= 3 && s.dragon.lensHidden === 0) {
        r.shots.push({ see: s.dragon.seeThrough, file: await h.shot(page, h.path.join(h.ROOT, 'artifacts/m4/accept'), `g-glass-${r.shots.length}`) });
        await h.wait(1500);
      }
      if (s.dragon.telegraph && s.dragon.k >= s.dragon.hitStep - 4 && roll < 3) {
        roll += 1;
        await h.hold(page, ['Space'], 40);
        await h.wait(200);
        r.rollShot = await h.shot(page, h.path.join(h.ROOT, 'artifacts/m4/accept'), `g-roll-afterimage-${roll}`);
      }
      await h.wait(40);
    }
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  console.log(JSON.stringify(r));
  await browser.close();
})();
