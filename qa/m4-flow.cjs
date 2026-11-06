// M4 flow on the built game with real input. Part A (?lab=skipintro,phase2): cross 50 % → phase change
// (lines, invulnerable, timer stopped) → coil within 30 steps → coil ring → double charge. Part B: defeat
// twice (「败」at 110 then 45, Enter retries). Part C (?lab=skipintro,finish): the fall → lines → result → retry.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/m4/flow');
const strikeOpening = async (page, presses = 4) => {
  let s = await h.waitState(page, (q) => q.dragon.opening && q.lock.active, 30000);
  if (s.combat.sashCd === 0) {
    await h.hold(page, ['Digit1'], 50);
    await h.wait(120);
  }
  s = await h.state(page);
  const t = s.lock.lookPoint;
  await h.goTo(page, t[0], t[2], { sprint: true, tolerance: 2.2, timeout: 2000 });
  for (let i = 0; i < presses; i += 1) {
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    await h.wait(160);
  }
};
async function partA(r) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro,phase2');
    await h.startPlaying(page);
    let s = await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    r.start = { root: s.player.root, lock: s.lock.active, hp: s.dragon.hp, hpMax: s.dragon.hpMax, timer: s.fight.timer };
    for (let i = 0; i < 6 && s.fight.stage !== 'transition'; i += 1) {
      await strikeOpening(page);
      s = await h.state(page);
      if (s.combat.hp < 50) await h.hold(page, ['KeyQ'], 50);
    }
    s = await h.waitState(page, (q) => q.fight.stage === 'transition', 8000);
    r.transition = { hp: s.dragon.hp, roarK: s.dragon.roarK, len: s.dragon.transitionLen, timer: s.fight.timer, log: s.fight.log.slice(-2), withLines: s.fight.withLines };
    await h.wait(600);
    r.shotRoar = await h.shot(page, OUT, 'a1-roar');
    s = await h.state(page);
    r.roar = { roarK: s.dragon.roarK, eye: s.dragon.eye, sub: s.fight.subtitle, head: s.dragon.head, timer: s.fight.timer };
    // Strikes do nothing while it roars.
    const hp0 = s.dragon.hp;
    const t = s.lock.lookPoint;
    await h.goTo(page, t[0], t[2], { sprint: true, tolerance: 2.2, timeout: 1500 });
    for (let i = 0; i < 3; i += 1) { await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' }); await h.wait(150); }
    await h.wait(1600);
    s = await h.state(page);
    r.roarImmune = { hp0, hp: s.dragon.hp, timer: s.fight.timer, sub: s.fight.subtitle, wallTurn: s.arena.wallTurn, grade: s.arena.grade };
    r.shotLap = await h.shot(page, OUT, 'a2-lap');
    await h.goTo(page, 0, 4, { sprint: true, tolerance: 1, timeout: 6000 });
    s = await h.waitState(page, (q) => q.dragon.kind === 'coil' && q.dragon.telegraph, 15000);
    r.coil = { since: s.dragon.log.slice(-1)[0], stage: s.fight.stage, ring: s.dragon.ring, timer: s.fight.timer, transitionLen: s.dragon.transitionLen };
    await h.waitState(page, (q) => q.dragon.kind === 'coil' && q.dragon.k >= 30, 3000);
    r.shotCoil = await h.shot(page, OUT, 'a3-coil-hold');
    s = await h.state(page);
    r.coilPose = { headY: s.dragon.coilHeadY, k: s.dragon.k, eye: s.dragon.eye };
    s = await h.waitState(page, (q) => q.dragon.coilWall !== null, 4000);
    await h.wait(150);
    r.shotBurst = await h.shot(page, OUT, 'a4-coil-burst');
    s = await h.state(page);
    r.coilHit = s.fight.log.slice(-1)[0];
    // Look for a double charge (second telegraph) for up to 40 s; eat seeds when low.
    const end = Date.now() + 40000;
    while (Date.now() < end) {
      s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      if (s.dragon.second && s.dragon.telegraph) {
        r.second = { k: s.dragon.k, log: s.dragon.log.slice(-2) };
        r.shotSecond = await h.shot(page, OUT, 'a5-second-charge');
        break;
      }
      if (s.fight.stage !== 'fight') break;
      await h.wait(60);
    }
    s = await h.state(page);
    r.endA = { stage: s.fight.stage, hits: s.fight.hits, perfects: s.fight.perfects, timer: s.fight.timer, history: s.fight.history.length, phase: s.dragon.phase, eye: s.dragon.eye };
  } catch (e) { r.failA = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'a-fail.png') }).catch(() => {}); }
  r.errorsA = errors;
  await browser.close();
}
async function partB(r) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.goTo(page, 0, 3, { sprint: true, tolerance: 1, timeout: 6000 });
    for (const round of [1, 2]) {
      let s = await h.waitState(page, (q) => q.fight.stage === 'defeat', 120000);
      const t0 = s.fight.k;
      r[`death${round}`] = { kAtFirstRead: t0, deaths: s.fight.deaths, withLines: s.fight.withLines };
      await h.wait(500);
      s = await h.state(page);
      r[`death${round}`].sub = s.fight.subtitle;
      r[`death${round}`].banner500 = { k: s.fight.k, banner: s.fight.banner };
      if (round === 1) r.shotLine = await h.shot(page, OUT, 'b1-defeat-line');
      s = await h.waitState(page, (q) => q.fight.banner, 4000);
      r[`death${round}`].bannerK = s.fight.k;
      await h.wait(250);
      r[`shotBanner${round}`] = await h.shot(page, OUT, `b2-defeat-banner-${round}`);
      s = await h.state(page);
      r[`death${round}`].ui = await page.evaluate(() => {
        const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
        const el = host.shadowRoot.querySelector('[data-ui-part="defeat"]');
        return { show: el.classList.contains('show'), word: el.querySelector('.defeat-word').textContent, filter: document.querySelector('canvas')?.style.filter, phase: host.className };
      });
      r[`death${round}`].pointerLocked = s.ui.pointerLocked;
      r[`death${round}`].phase = s.ui.phase;
      await page.keyboard.press('Enter');
      s = await h.waitState(page, (q) => q.fight.stage === 'fight', 3000);
      await h.wait(300);
      s = await h.state(page);
      r[`retry${round}`] = { hp: s.combat.hp, lotus: s.combat.lotus, sashCd: s.combat.sashCd, dragonHp: s.dragon.hp, phase: s.dragon.phase, eye: s.dragon.eye, timer: s.fight.timer, hits: s.fight.hits, root: s.player.root, lock: s.lock.active, deaths: s.fight.deaths, attempt: s.fight.attempt, played: s.fight.played };
      if (!s.ui.pointerLocked) {
        const v = page.viewport();
        await page.mouse.click(v.width / 2, v.height / 2);
        await h.wait(300);
      }
      await h.goTo(page, 0, 3, { sprint: true, tolerance: 1, timeout: 6000 });
    }
    const s = await h.state(page);
    r.records = s.fight.history;
  } catch (e) { r.failB = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'b-fail.png') }).catch(() => {}); }
  r.errorsB = errors;
  await browser.close();
}
async function partC(r) {
  const { browser, page, errors } = await h.launch({ lang: 'en-US' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro,finish');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    for (let i = 0; i < 6; i += 1) {
      const s = await h.state(page);
      if (s.fight.stage === 'victory') break;
      await strikeOpening(page, 2);
    }
    let s = await h.waitState(page, (q) => q.fight.stage === 'victory', 10000);
    r.victory = { timer: s.fight.timer, clock: s.clock, result: s.fight.result };
    await h.wait(300);
    r.shotSlow = await h.shot(page, OUT, 'c1-fall-slowmo');
    s = await h.waitState(page, (q) => q.fight.subtitle === 'dialogue.dragonKing.fall', 6000);
    r.fallLineK = s.fight.k;
    await h.wait(400);
    r.shotFall = await h.shot(page, OUT, 'c2-fall-line');
    s = await h.waitState(page, (q) => q.fight.subtitle === 'dialogue.nezha.victory', 8000);
    r.victoryLineK = s.fight.k;
    r.shotVictory = await h.shot(page, OUT, 'c3-victory-line');
    s = await h.waitState(page, (q) => q.fight.stage === 'result', 8000);
    r.resultK = s.fight.k;
    await h.wait(1200);
    r.shotResult = await h.shot(page, OUT, 'c4-result');
    s = await h.state(page);
    r.result = { result: s.fight.result, pointerLocked: s.ui.pointerLocked, phase: s.ui.phase, vortexSpeed: s.arena.vortexSpeed };
    r.resultTexts = (await h.visibleTexts(page)).map((t) => t.text).join(' | ');
    await page.keyboard.press('Enter');
    s = await h.waitState(page, (q) => q.fight.stage === 'fight', 3000);
    r.afterRetry = { hp: s.dragon.hp, mode: s.dragon.mode, attempt: s.fight.attempt, timer: s.fight.timer };
  } catch (e) { r.failC = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'c-fail.png') }).catch(() => {}); }
  r.errorsC = errors;
  await browser.close();
}
(async () => {
  const r = {};
  const which = process.argv[2] ?? 'ABC';
  if (which.includes('A')) await partA(r);
  if (which.includes('B')) await partB(r);
  if (which.includes('C')) await partC(r);
  h.fs.writeFileSync(h.path.join(h.ensureDir(OUT), `flow-${which}.json`), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1).slice(0, 12000));
})();
