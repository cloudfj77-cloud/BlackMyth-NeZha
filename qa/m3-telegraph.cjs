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
      if (d.telegraph && d.kind && !done.has(d.kind) && d.k !== null && d.k < 8) {
        const kind = d.kind;
        done.add(kind);
        // Aim at the warned area centre.
        const poly = d.polygon;
        const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
        const pr = s.player.root;
        await h.faceYaw(page, Math.atan2(-(cx - pr[0]), -(cz - pr[2])));
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
