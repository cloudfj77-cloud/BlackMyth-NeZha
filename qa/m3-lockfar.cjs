// QA 7: no automatic lock release in the boss field (r ≤ 26 m) — bind the dragon, sprint away backwards.
const h = require('./harness.cjs');
(async () => {
  const OUT = h.path.join(h.ROOT, 'artifacts/m3/accept');
  const r = { runs: [] };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await h.goTo(page, 0, 4, { sprint: true, timeout: 30000, tolerance: 1 });
      await h.hold(page, ['KeyR'], 60);
      await h.waitState(page, (q) => q.lock.active, 4000);
      let s = await h.waitState(page, (q) => q.dragon.opening && q.combat.sashCd === 0, 25000);
      await h.hold(page, ['Digit1'], 50);
      await h.waitState(page, (q) => q.dragon.bound, 2000);
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyS');
      let maxIn = 0, last;
      const end = Date.now() + 3200;
      while (Date.now() < end) {
        last = await h.state(page);
        const rr = Math.hypot(last.player.root[0], last.player.root[2]);
        if (rr <= 26) maxIn = Math.max(maxIn, last.lock.active ? last.lock.distance : 0);
        if (!last.lock.active || rr > 21) break;
        await h.wait(50);
      }
      await page.keyboard.up('KeyS');
      await page.keyboard.up('ShiftLeft');
      const run = { active: last.lock.active, distance: last.lock.distance, root: last.player.root, r: Math.round(Math.hypot(last.player.root[0], last.player.root[2]) * 100) / 100, maxLockedDistanceInField: maxIn };
      r.runs.push(run);
      if (attempt === 0) run.shot = await h.shot(page, OUT, '02b-locked-far');
      // Hold still a moment: still locked?
      await h.wait(1500);
      const after = await h.state(page);
      run.stillLockedAfter1500ms = after.lock.active;
      if (maxIn > 25) break;
      await h.hold(page, ['KeyR'], 60);
    }
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  h.fs.writeFileSync(h.path.join(OUT, 'lockfar.json'), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})();
