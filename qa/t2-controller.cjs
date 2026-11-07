// T2 acceptance: hover controller on the BUILT preview with real keyboard input.
// Metrics come from fixed-step samples in the `nezha` projection (game-time stamps, not wall clock).
const h = require('./harness.cjs');

function collector(page) {
  const byT = new Map();
  let running = true;
  let since;
  const loop = (async () => {
    while (running) {
      const s = await h.state(page);
      const samples = s?.player?.samples ?? [];
      since ??= samples.at(-1)?.t ?? 0;
      for (const sample of samples) if (sample.t >= since) byT.set(sample.t, sample);
      await h.wait(40);
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return [...byT.values()].sort((a, b) => a.t - b.t);
    },
  };
}
const DT = 1 / 60;

(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.wait(600);

    // 1. Walk: start from rest, hold W 1.6 s, release.
    let c = collector(page);
    await h.wait(300);
    await h.hold(page, ['KeyW'], 1600);
    await h.wait(500);
    let s = await c.stop();
    const start = s.findIndex((x) => x.speed > 0.01);
    const t95 = s.find((x, i) => i >= start && x.speed >= 0.95 * 5).t - s[start - 1].t;
    const steady = s.filter((x) => x.speed > 4.5);
    const walk = steady.slice(5, -5).reduce((a, x) => a + x.speed, 0) / Math.max(1, steady.length - 10);
    const lastMoving = s.map((x) => x.speed).lastIndexOf(s.filter((x) => x.speed > 4.9).at(-1)?.speed);
    const stopAt = s.findIndex((x, i) => i > lastMoving && x.speed < 0.01);
    const stopTime = s[stopAt].t - s[lastMoving].t;
    let slide = 0;
    for (let i = lastMoving + 1; i <= stopAt; i += 1) slide += s[i].speed * DT;
    result.walk = { speed: +walk.toFixed(3), t95: +t95.toFixed(3), stopTime: +stopTime.toFixed(3), slide: +slide.toFixed(3) };
    await h.shot(page, out, 'accel');

    // 2. Sprint: hold Shift + W 2 s.
    c = collector(page);
    await page.keyboard.down('ShiftLeft');
    await h.hold(page, ['KeyW'], 2000);
    const midSprint = await h.state(page);
    await h.shot(page, out, 'speed');
    await page.keyboard.up('ShiftLeft');
    await h.wait(400);
    s = await c.stop();
    const sorted = s.map((x) => x.speed).filter((v) => v > 5.05).sort((a, b) => a - b);
    const sprint = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
    const firstFast = s.find((x) => x.speed > 5.05);
    const firstMove = s.find((x) => x.speed > 0.01);
    result.sprint = { speed: +sprint.toFixed(3), mode: midSprint.player.mode, lean: midSprint.player.lean, sprintStartsAfter: firstFast && firstMove ? +(firstFast.t - firstMove.t).toFixed(3) : null };

    // 3. Turn: walk forward, then reverse (S) — facing must swing 180° at 720°/s.
    c = collector(page);
    await page.keyboard.down('KeyW');
    await h.wait(700);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    await h.wait(700);
    await page.keyboard.up('KeyS');
    await h.wait(300);
    s = await c.stop();
    let maxRate = 0, turnStart, turnEnd;
    for (let i = 1; i < s.length; i += 1) {
      const d = Math.abs(Math.atan2(Math.sin(s[i].yaw - s[i - 1].yaw), Math.cos(s[i].yaw - s[i - 1].yaw)));
      const rate = (d / (s[i].t - s[i - 1].t)) * 180 / Math.PI;
      if (rate > 1) {
        turnStart ??= s[i - 1];
        turnEnd = s[i];
      }
      maxRate = Math.max(maxRate, rate);
    }
    const swept = turnStart && turnEnd ? Math.abs(Math.atan2(Math.sin(turnEnd.yaw - turnStart.yaw), Math.cos(turnEnd.yaw - turnStart.yaw))) * 180 / Math.PI : 0;
    result.turn = { maxRateDegPerS: +maxRate.toFixed(1), sweptDeg: +swept.toFixed(1), duration: turnStart ? +(turnEnd.t - turnStart.t).toFixed(3) : null, avgRate: turnStart ? +(swept / (turnEnd.t - turnStart.t)).toFixed(1) : null };
    await h.shot(page, out, 'turn');

    // 4. Idle: capsule must not move (≤ 1 mm); model 0.3 m above root; glow on the root.
    await h.wait(500);
    c = collector(page);
    await h.wait(2200);
    s = await c.stop();
    const ys = s.map((x) => x.capsuleY), xs = s.map((x) => x.x), zs = s.map((x) => x.z);
    const span = (a) => Math.max(...a) - Math.min(...a);
    const idle = await h.state(page);
    result.idle = { capsuleSpanY: +span(ys).toFixed(5), capsuleSpanXZ: +Math.max(span(xs), span(zs)).toFixed(5), modelOffsetY: idle.player.modelOffsetY, glowOffsetFromRoot: idle.glow.offsetFromRoot, silhouette: idle.silhouette };
    await h.shot(page, out, 'capsule');

    // 5. Glow while moving.
    await page.keyboard.down('KeyD');
    await h.wait(500);
    const movingGlow = await h.state(page);
    await page.keyboard.up('KeyD');
    result.glowMoving = movingGlow.glow.offsetFromRoot;
    await h.wait(400);
    await h.shot(page, out, 'glow');

    // 6. Shift tap: counted as a step-dodge tap, no sprint.
    const before = (await h.state(page)).player.dodgeTaps;
    await h.hold(page, ['ShiftLeft'], 90);
    await h.wait(200);
    result.shiftTap = { taps: (await h.state(page)).player.dodgeTaps - before };

    // 7. Silhouette frame: camera comes around to Nezha's side.
    await h.look(page, 420, 0, 20);
    await h.wait(400);
    await h.shot(page, out, 'silhouette');
  } catch (error) {
    result.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 't2-fail.png') });
  } finally {
    result.errors = errors;
    h.fs.writeFileSync(h.path.join(out, 't2.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 1));
    await browser.close();
  }
})();
