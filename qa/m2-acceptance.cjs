// M2 acceptance on the BUILT preview with real keyboard / mouse (system Chrome).
// Step-exact boundaries (35/37 combo, 2.49/2.51 m, 59/61°, 12/13-step perfect window, hitstop
// step counts, 48-step regen delay) are proven by unit tests on the same code
// (assets/__tests__/combat.test.ts, lock-on.test.ts); this script proves the integrated game.
const h = require('./harness.cjs');
const OUT = h.path.join(h.ROOT, 'artifacts/m2');
const SURFACE_Z = -6.5; // south face of the default 2×4 dummy (centre z = -7, thickness 1)

const click = async (page, button = 'left', ms = 40) => {
  await page.mouse.down({ button });
  await h.wait(ms);
  await page.mouse.up({ button });
};
const audio = (page) => page.evaluate(() => {
  const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
  return JSON.parse(host?.dataset.audio ?? '{}');
});
const approach = async (page, d) => {
  // Arrive from the south walking north, lock on (Nezha faces the dummy), then trim the
  // distance from the body surface with short W / S taps to ±5 cm.
  let s = await h.state(page);
  if (!s.lock.active) {
    await h.goTo(page, 0, SURFACE_Z + d + 3, { tolerance: 0.5, timeout: 30000 });
    await h.goTo(page, 0, SURFACE_Z + d + 0.6, { tolerance: 0.3, timeout: 10000 });
    await h.hold(page, ['KeyR'], 60);
    await h.waitState(page, (x) => x.lock.active, 3000);
  }
  for (let i = 0; i < 30; i += 1) {
    await h.wait(220);
    s = await h.state(page);
    const diff = s.lock.distance - d;
    if (Math.abs(diff) < 0.05) break;
    await h.hold(page, [diff > 0 ? 'KeyW' : 'KeyS'], Math.max(18, Math.min(260, Math.abs(diff) * 110)));
  }
  await h.wait(250);
  return h.state(page);
};
const waitStamina = (page, v = 99.9) => h.waitState(page, (s) => s.combat.stamina >= v, 15000);

async function session(name, url, lang, run) {
  const { browser, page, errors } = await h.launch({ lang });
  const r = {};
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.wait(400);
    await run(page, r);
  } catch (error) {
    r.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), `m2-${name}-fail.png`) });
  } finally {
    r.errors = errors;
    await browser.close();
  }
  return r;
}

(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const result = {};

  // ---- A: combo, heavy, range, flame vs judgement, shake, stamina ------------------------
  result.A = await session('A', `${base}?qa=1`, 'zh-CN', async (page, r) => {
    let s = await approach(page, 1.6);
    r.start = { root: s.player.root, dist: s.lock.distance, stamina: s.combat.stamina, lightBefore: s.combat.hitLog.length };
    const audio0 = await audio(page);
    // 1) Three-hit combo.
    const before = s.combat.hitLog.length;
    for (let i = 0; i < 3; i += 1) {
      await click(page);
      await h.wait(i === 2 ? 120 : 430);
      if (i === 2) await h.shot(page, OUT, 'combo');
    }
    await h.wait(600);
    s = await h.state(page);
    const combo = s.combat.hitLog.slice(before);
    r.combo = combo.map((x) => [x.stage, x.dmg, x.dist, x.ang]);
    // Window expiry: after > 0.6 s the next click starts again at stage 1.
    await h.wait(900);
    await click(page);
    await h.wait(500);
    s = await h.state(page);
    r.comboReset = s.combat.hitLog.at(-1).stage;
    const audio1 = await audio(page);
    r.audioHits = { hits: s.combat.hitLog.length - before, hitCues: (audio1.hit ?? 0) - (audio0.hit ?? 0), swings: (audio1['swing-light'] ?? 0) - (audio0['swing-light'] ?? 0) };

    // 3/4/12) Full-charge heavy: damage, flame end vs judgement line, shake peak.
    await waitStamina(page);
    s = await approach(page, 2.2);
    await page.mouse.down({ button: 'right' });
    await h.wait(1350);
    await h.shot(page, OUT, 'charge');
    const chargeAudio = await audio(page);
    await page.mouse.up({ button: 'right' });
    await h.waitState(page, (x) => x.combat.action === 'heavy' && x.combat.frame >= 9, 3000);
    await h.shot(page, OUT, 'flame');
    await h.wait(700);
    s = await h.state(page);
    const heavy = s.combat.hitLog.at(-1);
    const fe = s.combat.flameEnd, jl = s.combat.judgeLine;
    r.heavy = { kind: heavy.kind, dmg: heavy.dmg, dist: heavy.dist, chargeFullCue: chargeAudio['charge-full'] ?? 0, flameEnd: fe, judgeLine: jl, flameVsJudge: fe && jl ? +Math.hypot(fe[0] - jl[0], fe[1] - jl[1]).toFixed(3) : null, flameAlongAxisError: fe && jl ? +Math.abs(fe[1] - jl[1]).toFixed(3) : null, shakePeak: s.camera.shakePeak, swayAfterHit: s.dummy.swayDeg };
    await h.shot(page, OUT, 'heavy');

    // 2) Range from the body surface: light 2.3 hits / 2.8 whiffs; heavy (with 0.5 m lunge) 3.3 hits / 3.8 whiffs.
    r.range = {};
    for (const [label, d, button, hold] of [['light-2.3', 2.3, 'left', 40], ['light-2.8', 2.8, 'left', 40], ['heavy-3.3', 3.3, 'right', 400], ['heavy-3.8', 3.8, 'right', 400]]) {
      await waitStamina(page, 60);
      s = await approach(page, d);
      const pre = +s.lock.distance.toFixed(3);
      const n = s.combat.hitLog.length;
      const a0 = (await audio(page)).hit ?? 0;
      await click(page, button, hold);
      await h.wait(900);
      s = await h.state(page);
      r.range[label] = { pre, after: +s.lock.distance.toFixed(3), hit: s.combat.hitLog.length > n, hitCue: ((await audio(page)).hit ?? 0) - a0, logged: s.combat.hitLog.length > n ? s.combat.hitLog.at(-1).dist : null };
      if (label === 'light-2.8') await h.shot(page, OUT, 'hit-range');
    }

    // 5) Stamina: costs, refusal with flash + hint, 0.8 s delay then 25/s.
    await waitStamina(page);
    s = await h.state(page);
    const costs = {};
    let st = s.combat.stamina;
    await click(page);
    await h.wait(450);
    s = await h.state(page);
    costs.light = +(st - s.combat.stamina).toFixed(2);
    st = s.combat.stamina;
    await h.hold(page, ['Space'], 50);
    await h.wait(200);
    s = await h.state(page);
    costs.roll = +(st - s.combat.stamina).toFixed(2);
    r.costs = costs;
    const flash0 = s.combat.hudFlash;
    let lastSpend = 0;
    // Attacks are free (boss 22:12): drain stamina with rolls instead.
    for (let i = 0; i < 7; i += 1) {
      const pre = (await h.state(page)).combat.stamina;
      await h.hold(page, ['Space'], 30);
      await h.wait(420);
      const x = await h.state(page);
      if (x.combat.stamina < pre - 1) lastSpend = x.t - 0.38;
    }
    s = await h.state(page);
    r.refuse = { stamina: s.combat.stamina, flashed: s.combat.hudFlash > flash0, action: s.combat.action };
    await h.shot(page, OUT, 'stamina');
    const trace = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 2200) {
      const x = await h.state(page);
      trace.push([x.t, x.combat.stamina]);
      await h.wait(60);
    }
    const startV = trace[0][1];
    const rising = trace.find((p) => p[1] > startV + 0.05);
    const later = trace.find((p) => rising && p[0] >= rising[0] + 0.8);
    // A roll lasts 27 steps (0.45 s); recovery starts 0.8 s after it ends.
    r.regen = { riseAfterLastRollPress: rising ? +(rising[0] - lastSpend).toFixed(2) : null, expected: 0.45 + 0.8, ratePerSecond: rising && later ? +((later[1] - rising[1]) / (later[0] - rising[0])).toFixed(1) : null };
  });

  // ---- B: hurt, roll invulnerability, perfect dodge, plain dodge ---------------------------
  result.B = await session('B', `${base}?qa=1`, 'zh-CN', async (page, r) => {
    let s = await approach(page, 3.5);
    await h.hold(page, ['KeyT'], 50);
    await h.wait(250);
    await h.shot(page, OUT, 'warning-line');
    s = await h.waitState(page, (x) => x.dummy.outcomes.length > 0, 4000);
    await h.wait(60);
    await h.shot(page, OUT, 'hurt');
    s = await h.state(page);
    r.hurt = { outcome: s.dummy.outcomes.at(-1).result, hp: s.combat.hp, action: s.combat.action };
    await h.wait(1200);
    await waitStamina(page);
    // Roll: frame 1 on the press, invulnerable.
    await h.hold(page, ['Space'], 50);
    await h.wait(60);
    s = await h.state(page);
    r.roll = { action: s.combat.action, frame: s.combat.frame, invuln: s.combat.invuln, wheelsFull: s.combat.wheelsFull };
    await h.shot(page, OUT, 'dodge');
    await h.wait(900);
    // Perfect dodge: press Space in the last ~5 steps of the fan warning.
    // lead = world steps left when the script sees the warning; the key lands ~4 steps later (mirror + input
    // latency): 5 -> perfect (frame ≤ 13); 20 -> roll frame ~16-17 at the hit (plain dodge, invulnerable ≤ 18).
    for (const [label, kind, lead] of [['perfect', 'KeyY', 5], ['plain', 'KeyT', 20]]) {
      await waitStamina(page);
      s = await approach(page, 3.0);
      const before = s.dummy.outcomes.length;
      const stam = s.combat.stamina;
      await h.hold(page, [kind], 50);
      await h.waitState(page, (x) => x.dummy.attack && x.dummy.attack.steps - x.dummy.attack.progress <= lead, 4000);
      // Roll toward the dummy (W + Space): Nezha stays inside the warning, so only invulnerability saves him.
      await page.keyboard.down('KeyW');
      await h.hold(page, ['Space'], 40);
      await page.keyboard.up('KeyW');
      s = await h.waitState(page, (x) => x.dummy.outcomes.length > before, 3000);
      const o = s.dummy.outcomes.at(-1);
      r[label] = { result: o.result, frame: o.frame, hp: s.combat.hp, tsWorld: s.combat.tsWorld, slowmo: s.combat.slowmo, staminaDelta: +(s.combat.stamina - stam).toFixed(1) };
      if (label === 'perfect') {
        await h.wait(30);
        await h.shot(page, OUT, 'perfect');
      }
      await h.wait(1200);
    }
  });

  // ---- C: lotus seeds (incl. interrupted), Sash Bind freeze + cooldown, zh hints -------------
  result.C = await session('C', `${base}?qa=1`, 'zh-CN', async (page, r) => {
    let s = await approach(page, 3.5);
    const hitBy = async (key) => {
      const n = (await h.state(page)).dummy.outcomes.length;
      await h.hold(page, [key], 50);
      return h.waitState(page, (x) => x.dummy.outcomes.length > n, 4000);
    };
    await hitBy('KeyT');
    await h.wait(600);
    // Interrupted seed: eat right after a line attack is launched; the hit lands mid-eat.
    s = await h.state(page);
    const hp0 = s.combat.hp;
    await h.hold(page, ['KeyT'], 50);
    await h.wait(120);
    await h.hold(page, ['KeyQ'], 50);
    await h.wait(1600);
    s = await h.state(page);
    r.interrupted = { hpBefore: hp0, hpAfter: s.combat.hp, lotus: s.combat.lotus };
    // Normal seed.
    await hitBy('KeyT');
    await h.wait(600);
    s = await h.state(page);
    const hp1 = s.combat.hp;
    await h.hold(page, ['KeyQ'], 50);
    await h.wait(400);
    await h.shot(page, OUT, 'lotus');
    await h.wait(900);
    s = await h.state(page);
    r.seed = { hpBefore: hp1, hpAfter: s.combat.hp, lotus: s.combat.lotus };
    await h.hold(page, ['KeyQ'], 50);
    await h.wait(1300);
    await h.hold(page, ['KeyQ'], 50);
    await h.wait(250);
    s = await h.state(page);
    r.empty = { lotus: s.combat.lotus, hpUnchanged: true };
    await h.shot(page, OUT, 'hint-zh');
    // Sash Bind: freeze an attack in progress for 3 s.
    await h.hold(page, ['KeyT'], 50);
    await h.wait(200);
    await h.hold(page, ['Digit1'], 50);
    await h.wait(500);
    s = await h.state(page);
    const p1 = s.dummy.attack?.progress;
    await h.shot(page, OUT, 'sash');
    await h.wait(1500);
    s = await h.state(page);
    r.sash = { bound: s.dummy.bound, progressFrozen: p1 !== undefined && s.dummy.attack?.progress === p1, holdLeft: s.dummy.holdLeft, cd: s.combat.sashCd };
    await h.hold(page, ['Digit1'], 50);
    await h.wait(200);
    s = await h.state(page);
    r.sashAgain = { cd: s.combat.sashCd, stillBound: s.dummy.bound };
    await h.shot(page, OUT, 'sash-cooldown');
    await h.wait(2500);
    s = await h.state(page);
    r.sashReleased = { bound: s.dummy.bound, attack: s.dummy.attack ? 'resumed' : 'resolved', outcomes: s.dummy.outcomes.slice(-1) };
  });

  // ---- D: English + pseudo hints (no Chinese residue, no overflow) ---------------------------
  for (const [key, url, lang, shot] of [['D-en', `${base}?qa=1`, 'en-US', 'hint-en'], ['D-pseudo', `${base}?dev=1&lang=pseudo`, 'en-US', 'hint-pseudo']]) {
    result[key] = await session(key, url, lang, async (page, r) => {
      await h.wait(300);
      // Keep rolling until stamina runs out and the hint shows (attacks are free).
      for (let i = 0; i < 12; i += 1) {
        await h.hold(page, ['Space'], 30);
        await h.wait(300);
        const hint = await page.evaluate(() => {
          const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
          const node = host?.shadowRoot?.querySelector('[data-ui-part="hint"]');
          return node?.classList.contains('show') ? node.textContent : null;
        });
        if (hint) {
          r.hint = hint;
          break;
        }
      }
      const texts = await h.visibleTexts(page);
      await h.shot(page, OUT, shot);
      r.texts = texts.map((t) => t.text).filter((t) => !/^(W|A|S|D|Q|T|Y|R|1|Esc|Shift|×\d|\d+)$/.test(t));
      r.cjk = r.texts.filter((t) => /[\u3400-\u9fff]/.test(t));
      r.overflow = texts.filter((t) => t.overflow).map((t) => t.text);
    });
  }

  h.fs.writeFileSync(h.path.join(OUT, 'm2.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
})();
