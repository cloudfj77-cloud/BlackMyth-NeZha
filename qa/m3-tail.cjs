// QA 5: tail hits in the build — ×0.3 damage (round, min 1), light hitstop 1/1/2, no shake, smaller sparks.
const h = require('./harness.cjs');
(async () => {
  const OUT = h.path.join(h.ROOT, 'artifacts/m3/accept');
  const r = { tries: [] };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.goTo(page, 0, 6, { sprint: true, timeout: 30000, tolerance: 1 });
    for (let attempt = 0; attempt < 8 && !r.tailHit; attempt += 1) {
      // Any opening with the tail low; bind it, fly beside the tail, face it, strike.
      let s = await h.waitState(page, (q) => q.dragon.opening && q.dragon.tailUnderside <= 2.5 && q.combat.sashCd === 0, 40000);
      await h.hold(page, ['Digit1'], 50);
      await h.waitState(page, (q) => q.dragon.bound, 2000).catch(() => null);
      s = await h.state(page);
      const t = s.dragon.tail, p = s.player.root;
      const dx = p[0] - t[0], dz = p[2] - t[2], n = Math.hypot(dx, dz) || 1;
      s = await h.goTo(page, t[0] + (dx / n) * 1.6, t[2] + (dz / n) * 1.6, { sprint: true, tolerance: 0.5, timeout: 2500 });
      await h.faceYaw(page, Math.atan2(t[0] - s.player.root[0], -(t[2] - s.player.root[2])));
      // Walk-tap toward the tail so Nezha faces it, then attack.
      await h.hold(page, ['KeyW'], 70);
      const before = s.combat.hitLog.length ? s.combat.hitLog.at(-1).step : -1;
      for (let i = 0; i < 3; i += 1) {
        await page.mouse.down({ button: 'left' });
        await page.mouse.up({ button: 'left' });
        await h.wait(150);
        if (i === 0) await h.shot(page, OUT, '14-tail-strike');
      }
      await h.wait(300);
      s = await h.state(page);
      const hits = s.combat.hitLog.filter((x) => x.step > before);
      r.tries.push(hits.map((x) => `${x.kind}${x.stage} seg${x.segment} tail=${x.tail} dmg${x.dmg} hs${x.hitstop} sh${x.shake}`));
      const tail = hits.filter((x) => x.tail);
      if (tail.length) r.tailHit = tail;
    }
    if (r.tailHit) {
      const base = { 1: 8, 2: 9, 3: 14 };
      const hs = { 1: 1, 2: 1, 3: 2 };
      r.pass = r.tailHit.every((x) => x.kind !== 'light' || (x.dmg === Math.max(1, Math.round(base[x.stage] * 0.3)) && x.hitstop === hs[x.stage] && x.shake === 0));
    }
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  h.fs.writeFileSync(h.path.join(OUT, 'tail.json'), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();
