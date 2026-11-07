// Port batch 2 in-game check (real keys): ribbons while gliding / turning, jump (F) apex, plunge (attack
// in the air → strike on landing), then a perfect dodge on a real dragon attack → 灵息 (boost) + cyan trail.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/port/batch2');
const click = async (page, button = 'left') => { await page.mouse.down({ button }); await h.wait(30); await page.mouse.up({ button }); };
(async () => {
  const r = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro');
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.hold(page, ['KeyR'], 60); // free camera
    await h.wait(600);
    // Ribbons: glide forward, then hard turn, side view.
    await h.look(page, 700, 0, 10);
    await page.keyboard.down('KeyW');
    await h.wait(900);
    r.ribbonGlide = await h.shot(page, OUT, '01-ribbons-glide');
    await page.keyboard.down('KeyA');
    await h.wait(450);
    r.ribbonTurn = await h.shot(page, OUT, '02-ribbons-turn');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    await h.wait(250);
    r.ribbonStop = await h.shot(page, OUT, '03-ribbons-stop-swing');
    await h.wait(900);
    // Jump (F): sample height until it lands.
    let s = await h.state(page);
    const st0 = s.combat.stamina;
    await h.hold(page, ['KeyF'], 40);
    let apex = 0; let shotApex = false; const trace = [];
    const end = Date.now() + 2500;
    while (Date.now() < end) {
      s = await h.state(page);
      trace.push([s.combat.action, s.combat.airY]);
      apex = Math.max(apex, s.combat.airY);
      if (!shotApex && s.combat.airVy <= 0.5 && s.combat.airY > 0.5) { r.jumpApex = await h.shot(page, OUT, '04-jump-apex'); shotApex = true; }
      if (trace.length > 3 && s.combat.airY === 0) break;
      await h.wait(40);
    }
    r.jump = { apex, stamina0: st0, staminaAfter: (await h.state(page)).combat.stamina, samples: trace.length, actions: [...new Set(trace.map((t) => t[0]))] };
    await h.wait(900);
    // Plunge: jump, attack near the top → airatk, strike on landing.
    await h.hold(page, ['KeyF'], 40);
    await h.wait(260);
    await click(page);
    await h.wait(60);
    s = await h.state(page);
    r.plungeStart = { action: s.combat.action, airY: s.combat.airY };
    r.plungeShot = await h.shot(page, OUT, '05-plunge-air');
    const pt = [];
    const end2 = Date.now() + 2000;
    let landedShot = false;
    while (Date.now() < end2) {
      s = await h.state(page);
      pt.push([s.combat.action, s.combat.airY, s.combat.frame]);
      if (!landedShot && s.combat.airY === 0 && s.combat.action === 'airatk') { r.plungeLand = await h.shot(page, OUT, '06-plunge-land'); landedShot = true; }
      if (s.combat.action !== 'airatk' && pt.length > 2) break;
      await h.wait(40);
    }
    r.plunge = { trace: pt.slice(0, 30) };
    // Perfect dodge on the dragon: lock on, stand still, roll in the last few steps before the hit.
    await h.hold(page, ['KeyR'], 60);
    await h.goTo(page, 0, 4, { sprint: true, tolerance: 1.2, timeout: 6000 });
    const HIT = { bite: 42, lash: 54, charge: 48, coil: 60 };
    const tries = [];
    const end3 = Date.now() + 45000;
    while (Date.now() < end3) {
      s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      if (s.dragon.telegraph && HIT[s.dragon.kind] && s.dragon.k >= HIT[s.dragon.kind] - 7 && s.combat.stamina >= 25 && s.combat.action !== 'roll') {
        const before = s.combat.perfects;
        await h.hold(page, ['Space'], 40);
        await h.wait(140);
        const a = await h.state(page);
        tries.push({ kind: s.dragon.kind, k: s.dragon.k, last: a.combat.incoming.slice(-1)[0], boost: a.combat.boost });
        if (a.combat.perfects > before) {
          r.perfectShot = await h.shot(page, OUT, '07-perfect-cyan-trail');
          await h.wait(250);
          r.boostShot = await h.shot(page, OUT, '08-lingxi-hud');
          const b = await h.state(page);
          r.boost = { boost: b.combat.boost, stamina: b.combat.stamina, hud: b.hud?.combat };
          await h.wait(1200);
          r.boostAfter = (await h.state(page)).combat.boost;
          break;
        }
        await h.wait(500);
      }
      if (s.fight.stage !== 'fight') break;
      await h.wait(50);
    }
    r.tries = tries.slice(-6);
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1).slice(0, 5000));
  await browser.close();
})();
