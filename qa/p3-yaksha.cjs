// Port batch 3, step 2: 巡海夜叉 on the boardwalk with real keys and mouse. Walk to the first ambush line,
// lock on (R), fight (left click; Space when a yaksha is about to stab), clear wave 1, walk on, clear wave 2,
// see the water gate open. Screenshots: ambush, wind-up fan, hit, death, wave 2, gate open.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/yaksha');
const click = async (page) => { await page.mouse.down({ button: 'left' }); await h.wait(30); await page.mouse.up({ button: 'left' }); };
const W = 45; // wind-up steps

async function fightWave(page, r, label, budgetMs) {
  const end = Date.now() + budgetMs;
  let shotFan = false, shotHit = false, shotDead = false;
  const log = { rolls: 0, clicks: 0, perfects0: 0 };
  let s = await h.state(page);
  log.perfects0 = s.combat.perfects;
  const hp0 = s.combat.hp;
  while (Date.now() < end) {
    s = await h.state(page);
    const y = s.yaksha;
    if (y.alive === 0) break;
    if (s.combat.hp < 40 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
    const root = s.player.root;
    const live = y.mobs.filter((m) => m.state !== 'dead');
    const near = live.map((m) => ({ m, d: Math.hypot(m.x - root[0], m.z - root[2]) })).sort((a, b) => a.d - b.d)[0];
    if (!near) { await h.wait(60); continue; }
    if (!s.lock.active) { await h.hold(page, ['KeyR'], 40); await h.wait(60); continue; }
    const threat = live.find((m) => m.state === 'attack' && m.t >= W - 10 && m.t <= W);
    if (threat) {
      if (!shotFan) { r[`${label}Fan`] = await h.shot(page, OUT, `${label}-windup-fan`); shotFan = true; }
      if (s.combat.stamina >= 25) { await h.hold(page, ['Space'], 40); log.rolls += 1; await h.wait(250); continue; }
    }
    if (near.d > 2.0) { await h.hold(page, ['KeyW'], 120); continue; }
    await click(page); log.clicks += 1;
    await h.wait(150);
    if (!shotHit && log.clicks === 3) { r[`${label}Hit`] = await h.shot(page, OUT, `${label}-hit`); shotHit = true; }
    const after = await h.state(page);
    if (!shotDead && after.yaksha.mobs.some((m) => m.state === 'dead' && m.t < 50)) { r[`${label}Dead`] = await h.shot(page, OUT, `${label}-death`); shotDead = true; }
  }
  s = await h.state(page);
  return { ...log, alive: s.yaksha.alive, hpLost: hp0 - s.combat.hp, perfects: s.combat.perfects - log.perfects0, stabs: s.yaksha.stabs, landed: s.yaksha.landed, lockFoe: s.lock.foe };
}

(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1');
    await h.startPlaying(page);
    await h.wait(800);
    let s = await h.state(page);
    r.start = { root: s.player.root, gate: s.sea.gateOpen, veil: s.sea.veil, wave: s.yaksha.wave };
    // Walk to the first ambush line (z 96.3).
    await h.goTo(page, 0, 95, { tolerance: 1, timeout: 15000 });
    s = await h.waitState(page, (q) => q.yaksha.alive > 0, 3000);
    await h.wait(500);
    r.wave1 = { alive: s.yaksha.alive, mobs: s.yaksha.mobs, texts: await h.visibleTexts(page) };
    r.s1 = await h.shot(page, OUT, '01-ambush');
    await h.wait(700);
    r.s1b = await h.shot(page, OUT, '02-closing-in');
    r.fight1 = await fightWave(page, r, 'w1', 60000);
    s = await h.state(page);
    r.afterWave1 = { alive: s.yaksha.alive, gate: s.sea.gateOpen, hp: s.combat.hp, lock: s.lock.active };
    // On to the second line (z 68.8); the lotus checkpoint lies just beyond.
    await h.goTo(page, 0, 67.5, { sprint: true, tolerance: 1, timeout: 15000 });
    s = await h.waitState(page, (q) => q.yaksha.alive > 0, 3000);
    await h.wait(600);
    r.s3 = await h.shot(page, OUT, '03-wave2');
    r.fight2 = await fightWave(page, r, 'w2', 90000);
    s = await h.state(page);
    r.afterWave2 = { alive: s.yaksha.alive, roadDone: s.yaksha.roadDone, gate: s.sea.gateOpen, hp: s.combat.hp, lit: s.yaksha.lit };
    if (!s.yaksha.lit) {
      await h.goTo(page, 0.5, 52, { tolerance: 1.2, timeout: 10000 });
      s = await h.state(page);
      r.litAfterWalk = s.yaksha.lit;
    }
    await h.goTo(page, 0, 29, { sprint: true, tolerance: 1.2, timeout: 15000 });
    await h.wait(400);
    s = await h.state(page);
    r.gate = { open: s.sea.gateOpen, veil: s.sea.veil };
    r.s4 = await h.shot(page, OUT, '04-gate-open');
    r.perf = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(f); }));
  } catch (e) { r.fail = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'fail.png') }).catch(() => {}); }
  r.errors = errors.slice(0, 10);
  console.log(JSON.stringify(r, null, 1).slice(0, 6000));
  await browser.close();
})();
