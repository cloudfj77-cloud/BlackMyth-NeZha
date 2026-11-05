// T5 acceptance: lock-on with the long placeholder at both end sizes, BUILT preview, real input.
const h = require('./harness.cjs');
const tapR = (page) => h.hold(page, ['KeyR'], 90);

async function waitLock(page, predicate, timeout = 15000) {
  return h.waitState(page, (s) => s.lock && predicate(s.lock, s), timeout);
}

(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = {};
  for (const size of ['2x4', '8x20']) {
    const r = (result[size] = { angles: [] });
    const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
    try {
      await h.open(page, `${base}?dev=1&target=${size}`);
      await h.startPlaying(page);
      await h.wait(600);
      if (size === '2x4') {
        await tapR(page);
        const s = await waitLock(page, (l) => l.hint === 'noTarget');
        r.farPress = { distance: s.lock.distance, hint: s.lock.hint, active: s.lock.active };
        await h.shot(page, out, 'lock-no-target');
      }
      await h.goTo(page, 0, 12, { sprint: true, timeout: 30000 });
      await h.faceYaw(page, 0);
      await tapR(page);
      let s = await waitLock(page, (l) => l.active);
      r.acquired = { distance: s.lock.distance, target: s.lock.target };
      // Close to ~6 m from the body surface, then orbit a full lap with A (+Shift).
      await page.keyboard.down('KeyW');
      await waitLock(page, (l) => l.distance <= 6, 10000).catch(() => null);
      await page.keyboard.up('KeyW');
      await h.wait(500);
      s = await h.state(page);
      const start = s.lock.orbitAngleDeg;
      let last = start, swept = 0, next = 0, framed = 0, polls = 0;
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyA');
      const end = Date.now() + 45000;
      while (next < 12 && Date.now() < end) {
        s = await h.state(page);
        let d = s.lock.orbitAngleDeg - last;
        d = ((d + 540) % 360) - 180;
        swept += Math.abs(d);
        last = s.lock.orbitAngleDeg;
        polls += 1;
        if (s.lock.nezhaInFrame) framed += 1;
        if (swept >= next * 30) {
          const name = `lock-${size}-${String(next).padStart(2, '0')}`;
          r.angles.push({ step: next, orbitAngleDeg: s.lock.orbitAngleDeg, active: s.lock.active, nezhaInFrame: s.lock.nezhaInFrame, nezhaBox: s.lock.nezhaBox, targetInFrame: s.lock.targetBox.inFrame, distance: s.lock.distance, shot: await h.shot(page, out, name) });
          next += 1;
        }
        await h.wait(30);
      }
      await page.keyboard.up('KeyA');
      await page.keyboard.up('ShiftLeft');
      r.sweptDeg = Math.round(swept);
      r.framedPolls = `${framed}/${polls}`;
      r.allAnglesFramed = r.angles.length === 12 && r.angles.every((a) => a.nezhaInFrame && a.active);
      if (size === '8x20') {
        await tapR(page);
        s = await waitLock(page, (l) => !l.active && l.hint === 'unlocked');
        r.release = s.lock.hint;
        await h.goTo(page, 0, 12, { sprint: true, timeout: 30000 });
        await h.faceYaw(page, 0);
        await tapR(page);
        await waitLock(page, (l) => l.active);
        await page.keyboard.down('ShiftLeft');
        await page.keyboard.down('KeyS');
        let max = 0;
        s = await h.waitState(page, (x) => {
          max = Math.max(max, x.lock.distance);
          return !x.lock.active;
        }, 15000);
        await page.keyboard.up('KeyS');
        await page.keyboard.up('ShiftLeft');
        r.autoBreak = { hint: s.lock.hint, distanceAtBreak: s.lock.distance, maxWhileLocked: max };
        await h.shot(page, out, 'lock-broken');
      }
    } catch (error) {
      r.fail = error.stack;
      await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), `t5-${size}-fail.png`) });
    } finally {
      r.errors = errors;
      await browser.close();
    }
  }
  h.fs.writeFileSync(h.path.join(out, 't5.json'), JSON.stringify(result, null, 2));
  for (const [size, r] of Object.entries(result)) console.log(size, JSON.stringify({ ...r, angles: r.angles.map((a) => [a.step, a.orbitAngleDeg, a.nezhaInFrame, a.active]) }));
})();
