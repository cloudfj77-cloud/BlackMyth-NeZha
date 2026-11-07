// M4 acceptance (built game, real keyboard / mouse). Complements qa/m4-flow.cjs (phase change, coil,
// defeat / retry, victory / result) and qa/m4-perf.cjs (draw commands). Parts:
//  I  intro: input ignored 0–852, shots at 0/300/390/688/852, hand-back (lock, timer, first attack ≥ +60),
//     back to title → second viewing skips the whole intro.
//  D  phase-2 double charge with Nezha far out (?lab=skipintro,finish — she never attacks).
//  P  pause menu: time shown, 「重新开始」 resets, 「回到标题」 back to the start screen.
//  L  English and pseudo-locale screens: defeat banner, result, pause, subtitles (no CJK, no overflow).
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/m4/accept');
const hostOf = () => [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));

async function partI(r) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    await h.goTo(page, 0, 19.6, { sprint: true, timeout: 40000, tolerance: 1.4 });
    let s = await h.waitState(page, (q) => q.fight.stage === 'intro', 4000);
    // Inputs during the intro: move, lock, attack, roll — nothing may happen.
    await h.wait(1500);
    const before = await h.state(page);
    await page.keyboard.down('KeyD');
    await h.hold(page, ['KeyR'], 60);
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    await h.hold(page, ['Space'], 60);
    await h.wait(700);
    await page.keyboard.up('KeyD');
    const after = await h.state(page);
    r.inputLocked = { root: [before.player.root, after.player.root], lock: after.lock.active, action: after.combat.action, controls: after.fight.controls };
    const marks = [300, 390, 688, 852];
    const shots = {};
    while (Object.keys(shots).length < marks.length) {
      s = await h.state(page);
      const k = s.fight.stage === 'intro' ? s.fight.k : 9999;
      for (const m of marks) if (!shots[m] && k >= m) shots[m] = { k: Math.min(k, 9999), file: await h.shot(page, OUT, `i-intro-${m}`), sub: s.fight.subtitle, skip: s.fight.skip };
      if (s.fight.stage === 'fight' && !shots[852]) shots[852] = { k: 'fight', file: await h.shot(page, OUT, 'i-intro-852'), sub: null };
      await h.wait(30);
    }
    r.introShots = shots;
    s = await h.waitState(page, (q) => q.fight.stage === 'fight', 15000);
    const endStep = s.fight.actions.find((a) => a.type === 'intro-end')?.step;
    r.handBack = { lock: s.lock.active, controls: s.fight.controls, timer: s.fight.timer, sealed: s.arena.sealed, endStep };
    s = await h.waitState(page, (q) => q.dragon.log.length > 0, 20000);
    r.firstAttack = { since: s.dragon.log[0].sinceOpening, kind: s.dragon.log[0].kind };
    // Back to title (pause menu) → start → canyon → second viewing: Enter skips it all.
    await page.keyboard.press('Escape');
    await h.waitState(page, (q) => q.ui.phase === 'paused', 3000);
    await h.click(page, '[data-ui-action="toTitle"]');
    s = await h.waitState(page, (q) => q.ui.phase === 'title' && q.fight.stage === 'canyon', 4000);
    r.toTitle = { stage: s.fight.stage, root: s.player.root, dragon: s.dragon.mode, sealed: s.arena.sealed };
    await h.startPlaying(page);
    await h.goTo(page, 0, 19.6, { sprint: true, timeout: 40000, tolerance: 1.4 });
    s = await h.waitState(page, (q) => q.fight.stage === 'intro', 4000);
    await h.wait(300);
    await page.keyboard.press('Enter');
    s = await h.waitState(page, (q) => q.fight.stage === 'fight', 3000);
    r.secondViewing = { stage: s.fight.stage, skippable: s.fight.introSkippable, lock: s.lock.active };
  } catch (e) { r.failI = e.stack; await page.screenshot({ path: h.path.join(h.ensureDir(OUT), 'i-fail.png') }).catch(() => {}); }
  r.errorsI = errors;
  await browser.close();
}

async function partD(r) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro,finish');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.hold(page, ['KeyR'], 60); // unlock: free movement to the centre
    // Stay far from the head so the dragon charges; eat seeds; never attack (it has 1 HP).
    const end = Date.now() + 80000;
    while (Date.now() < end && !r.second) {
      const s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      // Hold the centre of the vortex: charges come from the band (> 12 m) and leave room for the second.
      const p = s.player.root;
      if (Math.hypot(p[0], p[2]) > 2.5 && !s.dragon.telegraph) await h.goTo(page, 0, 0, { tolerance: 1.5, timeout: 1500 });
      if (s.dragon.second && s.dragon.telegraph) {
        const log = s.dragon.log.slice(-2);
        r.second = { k: s.dragon.k, log, hits: s.fight.log.slice(-2) };
        await h.wait(200);
        r.secondShot = await h.shot(page, OUT, 'd-second-charge');
      }
      if (s.fight.stage !== 'fight') break;
      await h.wait(60);
    }
    const s = await h.state(page);
    r.dragonLog = s.dragon.log.slice(-8).map((e) => `${e.kind}${e.second ? '²' : ''}@${Math.round(e.distance)}m`).join(' ');
  } catch (e) { r.failD = e.stack; }
  r.errorsD = errors;
  await browser.close();
}

async function partP(r) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.goTo(page, 0, 3, { sprint: true, tolerance: 1, timeout: 6000 });
    await h.wait(3000);
    await page.keyboard.press('Escape');
    let s = await h.waitState(page, (q) => q.ui.phase === 'paused', 3000);
    const timerAtPause = s.fight.timer;
    await h.wait(1000);
    s = await h.state(page);
    r.pause = { timerAtPause, timerAfter1s: s.fight.timer, seconds: await page.evaluate(() => [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]')).shadowRoot.querySelector('[data-ui-part="pause-seconds"]').textContent) };
    r.pauseShot = await h.shot(page, OUT, 'p-pause-menu');
    await h.click(page, '[data-ui-action="restart"]');
    s = await h.waitState(page, (q) => q.ui.phase === 'playing' && q.fight.timer < 30, 3000);
    r.restart = { timer: s.fight.timer, hp: s.combat.hp, dragonHp: s.dragon.hp, root: s.player.root, attempt: s.fight.attempt, deaths: s.fight.deaths, lock: s.lock.active };
  } catch (e) { r.failP = e.stack; }
  r.errorsP = errors;
  await browser.close();
}

async function partL(r, lang, query) {
  const { browser, page, errors } = await h.launch({ lang });
  const tag = query.includes('pseudo') ? 'pseudo' : lang.slice(0, 2);
  const res = {};
  try {
    await h.open(page, `http://localhost:4191/?qa=1&dev=1&lab=skipintro${query}`);
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.goTo(page, 0, 3, { sprint: true, tolerance: 1, timeout: 6000 });
    let s = await h.waitState(page, (q) => q.fight.subtitle !== null, 120000);
    res.subtitleShot = await h.shot(page, OUT, `l-${tag}-subtitle`);
    s = await h.waitState(page, (q) => q.fight.banner, 120000);
    await h.wait(300);
    res.bannerShot = await h.shot(page, OUT, `l-${tag}-defeat`);
    res.bannerTexts = (await h.visibleTexts(page)).filter((t) => t.text).map((t) => ({ text: t.text, overflow: t.overflow }));
    await page.keyboard.press('Enter');
    await h.waitState(page, (q) => q.fight.stage === 'fight', 3000);
    await page.keyboard.press('Escape');
    await h.waitState(page, (q) => q.ui.phase === 'paused', 3000);
    res.pauseShot = await h.shot(page, OUT, `l-${tag}-pause`);
    res.pauseTexts = (await h.visibleTexts(page)).map((t) => ({ text: t.text, overflow: t.overflow }));
    const all = [...res.bannerTexts, ...res.pauseTexts];
    res.cjk = tag === 'zh' ? null : all.filter((t) => /[\u3400-\u9fff]/.test(t.text) && !['中文'].includes(t.text)).map((t) => t.text);
    res.overflow = all.filter((t) => t.overflow).map((t) => t.text);
  } catch (e) { res.fail = e.stack; }
  res.errors = errors;
  r[`lang-${tag}`] = res;
  await browser.close();
}

(async () => {
  const r = {};
  const which = process.argv[2] ?? 'IDPL';
  if (which.includes('I')) await partI(r);
  if (which.includes('D')) await partD(r);
  if (which.includes('P')) await partP(r);
  if (which.includes('L')) {
    await partL(r, 'en-US', '');
    await partL(r, 'en-US', '&lang=pseudo');
  }
  h.fs.writeFileSync(h.path.join(h.ensureDir(OUT), `acceptance-${which}.json`), JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1).slice(0, 14000));
})();
