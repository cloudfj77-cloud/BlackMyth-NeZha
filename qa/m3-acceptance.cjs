// M3 acceptance on the BUILT game with real keyboard / mouse (QA 12 items, see design/milestones/M3-dragon.md).
// Session A (?qa=1): M1 re-check, AI selection, warning == damage, opening + bind, strikes, no auto-release,
//   defeat「败」→ reset, desaturated shots, draw commands / dragon CPU.
// Session B (?qa=1&dev=1&lab=bosslow): the dragon starts at 40 HP — kill it with real attacks, verify the fall.
const h = require('./harness.cjs');

const OUT = h.path.join(h.ROOT, 'artifacts/m3/accept');
const r3 = (v) => Math.round(v * 1000) / 1000;
const yawTo = (from, to) => Math.atan2(to[0] - from[0], -(to[2] - from[2]));

/** Draw-command counter (same hook as t7). */
function drawHook() {
  const S = (self.__nz = { draws: 0, frames: [], last: 0 });
  const wrap = (proto, names) => {
    for (const n of names) {
      const f = proto[n];
      if (typeof f !== 'function') continue;
      proto[n] = function (...a) { S.draws += 1; return f.apply(this, a); };
    }
  };
  if (typeof GPURenderPassEncoder !== 'undefined') wrap(GPURenderPassEncoder.prototype, ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'multiDrawIndirect', 'multiDrawIndexedIndirect']);
  if (typeof GPURenderBundleEncoder !== 'undefined') wrap(GPURenderBundleEncoder.prototype, ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']);
  const tick = (now) => {
    if (S.last) S.frames.push([now - S.last, S.draws]);
    if (S.frames.length > 600) S.frames.shift();
    S.draws = 0;
    S.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Accumulates the dragon / fight logs across polls (they are ring buffers). */
function collector() {
  const c = { attacks: new Map(), fights: new Map(), hits: new Map(), overheadMin: Infinity, overheadSamples: 0, lockedMaxDistance: 0, lockDrops: 0, wasLocked: false, timing: new Map(), maxCpu: 0 };
  c.take = (s) => {
    for (const a of s.dragon.log ?? []) c.attacks.set(`${s.fight.resets}:${a.step}`, { ...a, epoch: s.fight.resets });
    for (const f of s.fight.log ?? []) c.fights.set(`${s.fight.resets}:${f.step}:${f.kind}`, f);
    for (const x of s.combat.hitLog ?? []) c.hits.set(`${x.step}:${x.kind}:${x.stage}`, x);
    if (s.dragon.mode === 'swim' && s.dragon.overheadUnderside !== null) {
      c.overheadMin = Math.min(c.overheadMin, s.dragon.overheadUnderside);
      c.overheadSamples += 1;
    }
    if (s.lock.active) c.lockedMaxDistance = Math.max(c.lockedMaxDistance, s.lock.distance);
    // A defeat / victory reset releases the lock on purpose; anything else is an automatic release.
    if (c.wasLocked && !s.lock.active && !c.allowDrop && s.fight.resets === c.lastResets) c.lockDrops += 1;
    c.wasLocked = s.lock.active;
    c.lastResets = s.fight.resets;
    // Keyed by both steps: the brain step counter restarts after a reset.
    if (s.dragon.lastHit) c.timing.set(`${s.fight.resets}:${s.dragon.lastHit.step}`, { telegraphAt: s.dragon.lastHit.telegraphAt, hitAt: s.dragon.lastHit.step, kind: s.dragon.lastHit.kind, expected: s.dragon.hitSteps[s.dragon.lastHit.kind] });
    c.maxCpu = Math.max(c.maxCpu, s.dragon.cpuMs);
  };
  return c;
}

async function pollFor(page, c, ms, each) {
  const end = Date.now() + ms;
  let s;
  while (Date.now() < end) {
    s = await h.state(page);
    c.take(s);
    if (each && (await each(s))) return s;
    await h.wait(60);
  }
  return s;
}

async function sessionA(result) {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN', width: 1280, height: 720 });
  await page.evaluateOnNewDocument(drawHook);
  const c = collector();
  try {
    await h.open(page, 'http://localhost:4191/?qa=1');
    await h.startPlaying(page);
    let s = await h.state(page);
    // 1. M1 re-check (affected items): spawn in the canyon, hover 1.15 m, focus 2.4 m, float ±15 cm.
    const spawn = s.player.root;
    s = await h.goTo(page, 0, 10, { sprint: true, timeout: 40000, tolerance: 0.6 });
    await h.wait(1200);
    s = await h.state(page);
    c.take(s);
    result.m1 = {
      spawn,
      modelOffsetY: s.player.modelOffsetY,
      focusY: s.camera.focusY,
      floatAmp: s.float.amp,
      bossBarVisible: null,
      pass: Math.abs(s.camera.focusY - 2.4) < 0.02 && Math.abs(s.float.amp - 0.15) < 0.005 && s.player.modelOffsetY > 0.95 && s.player.modelOffsetY < 1.35,
    };
    result.m1.shot = await h.shot(page, OUT, '01-arena');
    // Lock on (R): the lock point is on the front 11 m, 1.5–4 m high.
    await h.hold(page, ['KeyR'], 60);
    s = await h.waitState(page, (q) => q.lock.active, 4000);
    c.take(s);
    result.lock = { active: s.lock.active, lookPoint: s.lock.lookPoint, heightOk: s.lock.lookPoint[1] >= 1.5 - 1e-3 && s.lock.lookPoint[1] <= 4 + 1e-3 };
    result.lock.shot = await h.shot(page, OUT, '02-locked');

    // 2–3, 6–7: watch ~70 s. Nezha strafes around (locked orbit), eats seeds below 45 HP, never rolls.
    let strafe = 'KeyA';
    let flip = Date.now();
    const shotsTaken = new Set();
    await page.keyboard.down(strafe);
    await pollFor(page, c, 70000, async (q) => {
      if (Date.now() - flip > 2500) {
        await page.keyboard.up(strafe);
        strafe = strafe === 'KeyA' ? 'KeyD' : 'KeyA';
        await page.keyboard.down(strafe);
        flip = Date.now();
      }
      if (q.combat.hp < 45 && q.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      const d = q.dragon;
      if (d.telegraph && d.k !== null && d.k / d.hitStep > 0.6 && !shotsTaken.has(d.kind)) {
        shotsTaken.add(d.kind);
        await h.shot(page, OUT, `03-telegraph-${d.kind}`);
      }
      return false;
    });
    await page.keyboard.up(strafe);

    // 4–5: opening → Sash Bind → strike the front during the frozen opening (re-lock if a defeat dropped it).
    s = await h.state(page);
    if (!s.lock.active) {
      await h.goTo(page, 0, 9, { sprint: true, timeout: 15000, tolerance: 1 });
      await h.hold(page, ['KeyR'], 60);
      await h.waitState(page, (q) => q.lock.active, 4000).catch(() => null);
    }
    result.opening = { tries: 0 };
    for (let attempt = 0; attempt < 6 && !result.opening.struck; attempt += 1) {
      result.opening.tries += 1;
      s = await pollFor(page, c, 20000, (q) => q.dragon.opening);
      if (!s?.dragon.opening) continue;
      result.opening.lockOpening = s.lock.opening;
      result.opening.shot = await h.shot(page, OUT, '04-opening');
      await h.hold(page, ['Digit1'], 50);
      s = await h.waitState(page, (q) => q.dragon.bound, 2000).catch(() => null);
      if (!s) continue;
      c.take(s);
      const k0 = s.dragon.k;
      await h.wait(500);
      const s2 = await h.state(page);
      result.opening.bind = { bound: s2.dragon.bound, holdLeft: s2.dragon.holdLeft, kFrozen: s2.dragon.k === k0, k: [k0, s2.dragon.k], sashCd: s2.combat.sashCd };
      result.opening.bindShot = await h.shot(page, OUT, '05-bind');
      // Fly to the front body point and strike (light ×3, then a heavy).
      const target = s2.lock.lookPoint;
      s = await h.goTo(page, target[0], target[2], { sprint: true, tolerance: 2.2, timeout: 2200 });
      const hpBefore = s.dragon.hp;
      const hitsBefore = s.combat.hitLog.length ? s.combat.hitLog.at(-1).step : -1;
      for (let i = 0; i < 3; i += 1) {
        await page.mouse.down({ button: 'left' });
        await page.mouse.up({ button: 'left' });
        await h.wait(160);
        if (i === 1) await h.shot(page, OUT, '06-strike');
      }
      await h.wait(400);
      s = await h.state(page);
      c.take(s);
      const newHits = s.combat.hitLog.filter((x) => x.step > hitsBefore);
      result.opening.struck = newHits.length > 0;
      result.opening.hits = newHits;
      result.opening.dragonHp = [hpBefore, s.dragon.hp];
    }

    // 7 (far): wait out the sash cooldown, bind in the next opening, then sprint away from the frozen dragon.
    {
      s = await h.state(page);
      if (!s.lock.active) {
        await h.goTo(page, 0, 9, { sprint: true, timeout: 15000, tolerance: 1 });
        await h.hold(page, ['KeyR'], 60);
        await h.waitState(page, (q) => q.lock.active, 4000).catch(() => null);
      }
      s = await pollFor(page, c, 30000, (q) => {
        if (q.combat.hp < 45 && q.combat.lotus > 0) h.hold(page, ['KeyQ'], 50);
        return q.combat.sashCd === 0 && q.dragon.opening && q.lock.active;
      });
      if (s?.dragon.opening) {
        await h.hold(page, ['Digit1'], 50);
        await h.waitState(page, (q) => q.dragon.bound, 2000).catch(() => null);
        // Locked movement is target-relative: hold S + Shift to sprint straight away from the frozen dragon.
        const before = c.lockedMaxDistance;
        c.lockedMaxDistance = 0;
        await page.keyboard.down('ShiftLeft');
        await page.keyboard.down('KeyS');
        // Stop before leaving the boss field (r ≤ 26 m; the canyon mouth is open at +z).
        let maxInField = 0;
        const far = await pollFor(page, c, 3600, (q) => {
          const r = Math.hypot(q.player.root[0], q.player.root[2]);
          if (q.lock.active && r <= 26) maxInField = Math.max(maxInField, q.lock.distance);
          return r > 21;
        });
        await page.keyboard.up('KeyS');
        await page.keyboard.up('ShiftLeft');
        c.take(far);
        result.lock.far = { active: far.lock.active, distance: far.lock.distance, root: far.player.root, r: r3(Math.hypot(far.player.root[0], far.player.root[2])), maxDistanceLockedInField: r3(maxInField), autoReleaseRule: 'none while r ≤ 26 m (outside: 30 m)' };
        result.lock.farShot = await h.shot(page, OUT, '02b-locked-far');
        c.lockedMaxDistance = Math.max(before, c.lockedMaxDistance);
      }
    }

    // 8: defeat — stop eating seeds; stand in the open and take hits until「败」.
    c.allowDrop = true;
    await h.goTo(page, 0, 4, { sprint: true, timeout: 15000, tolerance: 1 });
    result.defeat = {};
    s = await pollFor(page, c, 90000, (q) => q.fight.defeatLeft > 0);
    const resetsBefore = s?.fight.resets ?? 0;
    if (s?.fight.defeatLeft > 0) {
      result.defeat.seen = true;
      result.defeat.banner = await page.evaluate(() => {
        const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
        const el = host.shadowRoot.querySelector('[data-ui-part="defeat"]');
        return { show: el.classList.contains('show'), text: el.textContent.trim(), opacity: getComputedStyle(el).opacity };
      });
      await h.wait(180);
      result.defeat.shot = await h.shot(page, OUT, '07-defeat');
      const t0 = Date.now();
      s = await h.waitState(page, (q) => q.fight.resets > resetsBefore, 4000);
      result.defeat.resetAfterMs = Date.now() - t0 + 180;
      await h.wait(300);
      s = await h.state(page);
      result.defeat.after = { root: s.player.root, hp: s.combat.hp, lotus: s.combat.lotus, dragonHp: s.dragon.hp, lock: s.lock.active, defeats: s.fight.defeats };
      result.defeat.pass = Math.hypot(s.player.root[0] - 0, s.player.root[2] - 16.5) < 0.3 && s.combat.hp === 100 && s.dragon.hp === s.dragon.hpMax && !s.lock.active;
      result.defeat.afterShot = await h.shot(page, OUT, '08-after-reset');
    }

    // 9: desaturated shots for the blind test (canvas grayscale; HUD left as is).
    await h.goTo(page, 0, 9, { sprint: true, timeout: 15000, tolerance: 1 });
    await page.addStyleTag({ content: 'canvas { filter: grayscale(1) !important; }' });
    const grey = [];
    s = await pollFor(page, c, 25000, (q) => q.dragon.telegraph && q.dragon.k > 20);
    grey.push(await h.shot(page, OUT, '09-grey-telegraph'));
    s = await pollFor(page, c, 8000, (q) => q.dragon.opening);
    grey.push(await h.shot(page, OUT, '09-grey-opening'));
    s = await pollFor(page, c, 8000, (q) => q.dragon.mode === 'swim');
    grey.push(await h.shot(page, OUT, '09-grey-swim'));
    result.grey = grey;

    // 10: draw commands (frames with the dragon in view) and dragon CPU.
    const perf = await page.evaluate(() => {
      const f = self.__nz?.frames ?? [];
      const draws = f.map((x) => x[1]).sort((a, b) => a - b);
      const ms = f.map((x) => x[0]).sort((a, b) => a - b);
      return { frames: f.length, drawsP50: draws[Math.floor(draws.length / 2)], drawsMax: draws.at(-1), frameMsP50: ms[Math.floor(ms.length / 2)] };
    });
    s = await h.state(page);
    result.perf = { ...perf, dragonCpuMs: s.dragon.cpuMs, dragonCpuMaxSeen: r3(c.maxCpu) };
  } catch (error) {
    result.failA = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 'm3-accept-A-fail.png') }).catch(() => {});
  } finally {
    result.errorsA = errors;
    // Derived checks over everything collected.
    const attacks = [...c.attacks.entries()].sort((a, b) => (+a[0].split(':')[0] - +b[0].split(':')[0]) || a[1].step - b[1].step).map((e) => e[1]);
    let repeatOk = true;
    // Within one fight (a reset starts a fresh dragon).
    for (let i = 2; i < attacks.length; i += 1) if (attacks[i].epoch === attacks[i - 2].epoch && attacks[i].kind === attacks[i - 1].kind && attacks[i].kind === attacks[i - 2].kind) repeatOk = false;
    result.ai = {
      count: attacks.length,
      kinds: attacks.map((a) => a.kind).join(','),
      gaps: attacks.map((a) => a.sinceOpening),
      gapsOk: attacks.every((a) => a.sinceOpening >= 60 && a.sinceOpening <= 180),
      // Forced at 180: charge when > 8 m and there is room, else bite (a third repeat swaps the kind).
      forcedOk: attacks.every((a, i) => {
        if (!a.forced) return true;
        const twoBites = i >= 2 && attacks[i - 1].epoch === a.epoch && attacks[i - 2].epoch === a.epoch && attacks[i - 1].kind === 'bite' && attacks[i - 2].kind === 'bite';
        return a.sinceOpening === 180 && (a.kind !== 'charge' || a.distance > 8 || twoBites);
      }),
      distanceOk: attacks.filter((a) => !a.forced).every((a) => a.distance <= 16 + 1e-6),
      // Regular bites / charges start facing Nezha within 30° (the lash and forced attacks are exempt).
      alignedOk: attacks.filter((a) => !a.forced && a.kind !== 'lash').every((a) => a.aligned <= 30 + 1e-6),
      repeatOk,
      log: attacks,
    };
    const fights = [...c.fights.values()];
    result.warning = {
      hits: fights.length,
      consistent: fights.every((f) => (f.inside ? f.result !== 'clear' : f.result === 'clear')),
      insideHurt: fights.filter((f) => f.inside).length,
      log: fights,
      timing: [...c.timing.values()],
      stepDiffZero: [...c.timing.values()].every((t) => t.hitAt - t.telegraphAt === t.expected),
    };
    result.overhead = { min: Number.isFinite(c.overheadMin) ? c.overheadMin : null, samples: c.overheadSamples, ok: !Number.isFinite(c.overheadMin) || c.overheadMin >= 3.5 - 1e-3 };
    result.noAutoRelease = { drops: c.lockDrops, maxDistanceWhileLocked: r3(c.lockedMaxDistance) };
    result.strikes = [...c.hits.values()];
    await browser.close();
  }
}

async function sessionB(result) {
  const { browser, page, errors } = await h.launch({ lang: 'en-US', width: 1280, height: 720 });
  const c = collector();
  result.fall = {};
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=bosslow');
    await h.startPlaying(page);
    await h.goTo(page, 0, 10, { sprint: true, timeout: 40000, tolerance: 0.6 });
    await h.hold(page, ['KeyR'], 60);
    await h.waitState(page, (q) => q.lock.active, 4000);
    let s = await h.state(page);
    result.fall.startHp = s.dragon.hp;
    for (let attempt = 0; attempt < 8 && s.dragon.mode !== 'dead'; attempt += 1) {
      s = await pollFor(page, c, 20000, (q) => q.dragon.opening || q.dragon.mode === 'dead');
      if (s.dragon.mode === 'dead') break;
      await h.hold(page, ['Digit1'], 50);
      await h.wait(120);
      s = await h.state(page);
      const target = s.lock.lookPoint;
      await h.goTo(page, target[0], target[2], { sprint: true, tolerance: 2.2, timeout: 2200 });
      for (let i = 0; i < 6; i += 1) {
        await page.mouse.down({ button: 'left' });
        await page.mouse.up({ button: 'left' });
        await h.wait(170);
      }
      s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
    }
    s = await h.waitState(page, (q) => q.dragon.mode === 'dead', 5000);
    const deadAt = Date.now();
    result.fall.dead = true;
    result.fall.shotFalling = await h.shot(page, OUT, '10-dragon-falling');
    s = await h.waitState(page, (q) => q.dragon.deathK >= 152, 5000);
    result.fall.at150 = { deathK: s.dragon.deathK, eye: s.dragon.eye, vortexSpeed: s.arena.vortexSpeed };
    result.fall.shotEyesClosed = await h.shot(page, OUT, '11-eyes-closed');
    const vt = s.arena.vortexTime;
    await h.wait(300);
    const s2 = await h.state(page);
    result.fall.vortexStopped = s2.arena.vortexTime === vt || s2.fight.resets > 0;
    s = await h.waitState(page, (q) => q.fight.resets > 0, 6000);
    result.fall.resetAfterMs = Date.now() - deadAt;
    await h.wait(300);
    s = await h.state(page);
    result.fall.after = { dragonMode: s.dragon.mode, dragonHp: s.dragon.hp, root: s.player.root, hp: s.combat.hp, victories: s.fight.victories, vortexSpeed: s.arena.vortexSpeed };
    result.fall.audio = await page.evaluate(() => {
      const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
      return JSON.parse(host?.dataset.audio ?? '{}');
    });
    result.fall.shotAfter = await h.shot(page, OUT, '12-after-victory-reset');
  } catch (error) {
    result.failB = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 'm3-accept-B-fail.png') }).catch(() => {});
  } finally {
    result.errorsB = errors;
    await browser.close();
  }
}

(async () => {
  const result = {};
  const which = process.argv[2] ?? 'AB';
  if (which.includes('A')) await sessionA(result);
  if (which.includes('B')) await sessionB(result);
  h.fs.writeFileSync(h.path.join(h.ensureDir(OUT), `result-${which}.json`), JSON.stringify(result, null, 1));
  const brief = { ...result };
  if (brief.ai) brief.ai = { ...brief.ai, log: `(${brief.ai.log.length})` };
  if (brief.warning) brief.warning = { ...brief.warning, log: `(${brief.warning.log.length})` };
  console.log(JSON.stringify(brief, null, 1).slice(0, 9000));
})();
