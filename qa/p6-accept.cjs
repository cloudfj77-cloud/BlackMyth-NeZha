// Round acceptance (boss 11-06 17:11): 敖丙 dialogue in the real intro, phase-2 bar name, pause menu (中英双语),
// 灵息 gained segment + qi gathering, victory lines → result → 自由游览. Real keys / mouse, built preview.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/accept');
const BASE = 'http://localhost:4191/';
const click = async (page) => { await page.mouse.down({ button: 'left' }); await h.wait(30); await page.mouse.up({ button: 'left' }); };
const r = {};
async function session(url, fn) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try { await h.open(page, url); await fn(page); } catch (e) { r[`fail ${url}`] = e.stack.slice(0, 300); await page.screenshot({ path: h.path.join(h.ensureDir(OUT), `fail-${Date.now()}.png`) }).catch(() => {}); }
  r[`errors ${url.replace(BASE, '')}`] = errors.slice(0, 3);
  await browser.close();
}
(async () => {
  // A: the road, then the real intro with 敖丙's lines.
  await session(`${BASE}?qa=1&dev=1&lab=weakmobs`, async (page) => {
    await h.startPlaying(page);
    const clear = async () => {
      const end = Date.now() + 30000;
      while (Date.now() < end) {
        const q = await h.state(page);
        if (q.yaksha.alive === 0) return;
        if (!q.lock.active) await h.hold(page, ['KeyR'], 40);
        const live = q.yaksha.mobs.filter((m) => m.state !== 'dead');
        const near = live.map((m) => Math.hypot(m.x - q.player.root[0], m.z - q.player.root[2])).sort((a, b) => a - b)[0] ?? 9;
        if (near > 2) await h.hold(page, ['KeyW'], 120); else { await click(page); await h.wait(160); }
      }
    };
    await h.goTo(page, 0, 95, { tolerance: 1, timeout: 15000 });
    await h.waitState(page, (q) => q.yaksha.alive > 0, 4000);
    await clear();
    await h.goTo(page, 0, 67.5, { sprint: true, tolerance: 1, timeout: 15000 });
    await h.waitState(page, (q) => q.yaksha.alive > 0, 4000);
    await clear();
    if ((await h.state(page)).lock.active) await h.hold(page, ['KeyR'], 40);
    await h.goTo(page, 0, 16, { sprint: true, tolerance: 1.5, timeout: 20000 });
    await h.waitState(page, (q) => q.fight.stage === 'intro' && q.fight.k >= 470, 20000);
    r.introAobing = await h.shot(page, OUT, '01-intro-aobing-line');
    r.introSub1 = (await h.state(page)).fight.subtitle;
    await h.waitState(page, (q) => q.fight.stage === 'intro' && q.fight.k >= 740, 10000);
    r.introNezha = await h.shot(page, OUT, '02-intro-nezha-line');
    r.introSub2 = (await h.state(page)).fight.subtitle;
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(1200);
    r.fightHud = await h.shot(page, OUT, '03-fight-hud-bilingual');
    await page.keyboard.press('Escape');
    await h.waitState(page, (q) => q.ui.phase === 'paused', 4000);
    await h.wait(400);
    r.pause = await h.shot(page, OUT, '04-pause-bilingual');
  });
  // B: 灵息 (perfect dodge on a real attack).
  await session(`${BASE}?qa=1&dev=1&lab=skipintro`, async (page) => {
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    // Spend some stamina first so the gained stretch shows.
    for (let i = 0; i < 3; i += 1) { await h.hold(page, ['Space'], 40); await h.wait(500); }
    const end = Date.now() + 50000;
    while (Date.now() < end) {
      const s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      const d = s.dragon;
      if (d.telegraph && d.hitStep && d.k !== null && d.k >= d.hitStep - 7 && s.combat.stamina >= 15) {
        const before = s.combat.perfects;
        await h.hold(page, ['Space'], 40);
        await h.wait(90);
        const a = await h.state(page);
        if (a.combat.perfects > before) { r.qi = await h.shot(page, OUT, '05-lingxi-qi-gather'); await h.wait(150); r.gain = await h.shot(page, OUT, '06-lingxi-gain-segment'); break; }
        await h.wait(400);
      } else await h.wait(40);
    }
  });
  // C: phase-2 bar name.
  await session(`${BASE}?qa=1&dev=1&lab=skipintro,p2`, async (page) => {
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(1500);
    r.p2bar = await h.shot(page, OUT, '07-p2-bar-name');
  });
  // D: the fall, the lines, the result, then free roam.
  await session(`${BASE}?qa=1&dev=1&lab=skipintro,finish`, async (page) => {
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const s = await h.state(page);
      if (s.fight.stage !== 'fight') break;
      const t = s.lock.lookPoint;
      if (t) await h.goTo(page, t[0], t[2], { sprint: true, tolerance: 2.0, timeout: 1500 }).catch(() => {});
      await click(page);
      await h.wait(200);
    }
    await h.waitState(page, (q) => q.fight.stage === 'victory' && q.fight.k >= 100, 10000);
    r.fall = await h.shot(page, OUT, '08-fall-line');
    r.fallSub = (await h.state(page)).fight.subtitle;
    await h.waitState(page, (q) => q.fight.stage === 'result', 15000);
    await h.wait(800);
    r.result = await h.shot(page, OUT, '09-result-roam-button');
    await h.click(page, '[data-ui-action="roam"]');
    await h.waitState(page, (q) => q.fight.stage === 'roam', 4000);
    await h.wait(400);
    const view = page.viewport();
    await page.mouse.click(view.width / 2, view.height / 2);
    await h.wait(800);
    await page.keyboard.down('KeyW');
    await h.wait(2500);
    await page.keyboard.up('KeyW');
    const s = await h.state(page);
    r.roam = { stage: s.fight.stage, sealed: s.sea.sealed, gate: s.sea.gateOpen, root: s.player.root, music: s.audio?.music };
    r.roamShot = await h.shot(page, OUT, '10-free-roam');
  });
  console.log(JSON.stringify(r, null, 1).slice(0, 4000));
})();
