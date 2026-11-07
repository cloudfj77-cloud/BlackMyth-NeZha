// M3: capture each attack's telegraph (early / mid / just before hit) and the hit result.
const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m3/telegraph');
  const r = { seen: [] };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.goTo(page, 0, 8, { sprint: true, timeout: 40000, tolerance: 0.6 });
    const done = new Set();
    const end = Date.now() + 90000;
    while (Date.now() < end && done.size < 3) {
      const s = await h.state(page);
      if (s.combat.hp < 40) await h.hold(page, ['KeyQ'], 60);
      const d = s.dragon;
      // Keep the camera on the dragon while waiting, so the telegraph is already in frame.
      if (!d.telegraph) {
        const hd = d.head, pr0 = s.player.root;
        const want = Math.atan2(hd[0] - pr0[0], -(hd[2] - pr0[2]));
        const diff = Math.atan2(Math.sin(want - s.camera.yaw), Math.cos(want - s.camera.yaw));
        if (Math.abs(diff) > 0.35) await h.look(page, Math.max(-400, Math.min(400, diff / (0.1 * Math.PI / 180))), 0, 4);
      }
      if (d.telegraph && d.kind && !done.has(d.kind) && d.k !== null && d.k < 8) {
        const kind = d.kind;
        done.add(kind);
        const poly = d.polygon;
        const shots = [];
        let last = d;
        for (let i = 0; i < 40; i += 1) {
          const q = await h.state(page);
          last = q.dragon;
          if (!last.telegraph || last.kind !== kind) break;
          const frac = last.k / last.hitStep;
          const tag = frac < 0.4 ? 'a-early' : frac < 0.75 ? 'b-mid' : 'c-late';
          if (!shots.includes(tag)) {
            shots.push(tag);
            await h.shot(page, out, `${kind}-${tag}`);
          }
          await h.wait(60);
        }
        await h.wait(250);
        await h.shot(page, out, `${kind}-d-after`);
        const q = await h.state(page);
        r.seen.push({ kind, shots, fight: q.fight.log.slice(-1)[0], hp: q.combat.hp, polygonVerts: poly.length });
      }
      await h.wait(50);
    }
  } catch (error) {
    r.fail = error.stack;
  } finally {
    r.errors = errors;
    console.log(JSON.stringify(r, null, 1).slice(0, 4000));
    await browser.close();
  }
})();
