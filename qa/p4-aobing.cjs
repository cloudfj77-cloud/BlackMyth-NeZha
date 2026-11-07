// 敖丙 moves on the long dragon, real keys. Phase 1 (?lab=skipintro): watch for slash / sweep / thrust,
// screenshot each telegraph and strike; then phase 2 (?lab=skipintro,p2): leap, spikes, ice ring; 破势 by striking.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/aobing');
const click = async (page) => { await page.mouse.down({ button: 'left' }); await h.wait(30); await page.mouse.up({ button: 'left' }); };

async function watch(page, r, label, wanted, budget) {
  const shots = {};
  const seen = new Set();
  const end = Date.now() + budget;
  let s;
  while (Date.now() < end && wanted.some((k) => !shots[k])) {
    s = await h.state(page);
    if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
    const d = s.dragon;
    if (d.kind) seen.add(d.kind);
    if (d.kind && wanted.includes(d.kind) && !shots[d.kind] && d.sp === 'wind' && d.st > 18) {
      shots[d.kind] = await h.shot(page, OUT, `${label}-${d.kind}-telegraph`);
      await h.wait(d.kind === 'leap' ? 900 : d.kind === 'thrust' ? 380 : 330);
      shots[`${d.kind}Strike`] = await h.shot(page, OUT, `${label}-${d.kind}-strike`);
    }
    if (d.spikes > 0 && !shots.spikes) shots.spikes = await h.shot(page, OUT, `${label}-spikes`);
    if (d.rings > 0 && !shots.icering) { await h.wait(250); shots.icering = await h.shot(page, OUT, `${label}-icering`); }
    // Keep a medium distance, back off sometimes so the thrust / leap come too.
    const root = s.player.root, hd = d.head;
    const dist = Math.hypot(hd[0] - root[0], hd[2] - root[2]);
    if (dist < 5) await h.hold(page, ['KeyS'], 200);
    else if (dist > 11) await h.hold(page, ['KeyW'], 150);
    else await h.wait(60);
  }
  r[label] = { shots, seen: [...seen], hp: s?.combat.hp, dragon: { mode: s?.dragon.mode, phase: s?.dragon.phase, under: s?.dragon.bodyUnderside, log: s?.dragon.log?.slice(-8), fight: s?.fight.log?.slice(-6) } };
}

(async () => {
  const r = {};
  let { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(1500);
    r.float = await h.shot(page, OUT, '00-floating-low');
    let s = await h.state(page);
    r.start = { under: s.dragon.bodyUnderside, head: s.dragon.head, modelY: s.player.modelY };
    await watch(page, r, 'p1', ['slash', 'smash', 'sweep', 'thrust'], 70000);
    // 破势: strike until it staggers.
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      s = await h.state(page);
      if (s.dragon.mode === 'stagger') { r.breakShot = await h.shot(page, OUT, 'p1-break-stagger'); r.break = { breaks: s.dragon.breaks, texts: (await h.visibleTexts(page)).map((t) => t.text).slice(-6) }; break; }
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      const t = s.lock.lookPoint;
      if (t && s.dragon.opening) {
        await h.goTo(page, t[0], t[2], { sprint: true, tolerance: 2.0, timeout: 1500 }).catch(() => {});
        for (let i = 0; i < 3; i += 1) { await click(page); await h.wait(150); }
      } else if (s.dragon.telegraph && s.dragon.st > (s.dragon.hitStep ?? 40) - 14 && s.combat.stamina > 20) { await h.hold(page, ['Space'], 40); await h.wait(200); }
      else await h.wait(60);
    }
  } catch (e) { r.fail1 = e.stack; }
  r.errors1 = errors.slice(0, 8);
  await browser.close();
  ({ browser, page, errors } = await h.launch({ lang: 'zh-CN' }));
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro,p2');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(800);
    r.p2glow = await h.shot(page, OUT, 'p2-00-dragon-armour');
    await watch(page, r, 'p2', ['leap', 'smash', 'sweep', 'thrust', 'spikes', 'icering'], 90000);
    r.perf = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(f); }));
  } catch (e) { r.fail2 = e.stack; }
  r.errors2 = errors.slice(0, 8);
  console.log(JSON.stringify(r, null, 1).slice(0, 7000));
  await browser.close();
})();
