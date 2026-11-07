// T4 acceptance: Nezha float, sash, environment float — BUILT preview, real input.
const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = {};
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.wait(1200);

    // Idle 6 s: model height oscillation, capsule fixed, seaweed sway frequency (longer window below).
    let c = h.sampleCollector(page);
    await h.wait(6000);
    let { samples, frames } = await c.stop();
    const idle = h.oscillation(samples.map((x) => ({ t: x.t, v: x.modelY })));
    const capsuleSpan = Math.max(...samples.map((x) => x.capsuleY)) - Math.min(...samples.map((x) => x.capsuleY));
    result.idle = { mean: +idle.mean.toFixed(4), amp: +idle.amp.toFixed(4), hz: +idle.hz.toFixed(3), cycles: idle.cycles, capsuleSpanMm: +(capsuleSpan * 1000).toFixed(3) };
    result.sash = frames.at(-1).sash;
    await h.look(page, 330, 0, 12); // side-on view of the float and sash
    await h.wait(600);
    await h.shot(page, out, 'hover');

    // Moving and sprinting amplitudes (circle so the camera keeps him in frame).
    for (const [name, keys] of [['move', ['KeyW', 'KeyA']], ['sprint', ['ShiftLeft', 'KeyW', 'KeyA']]]) {
      for (const k of keys) await page.keyboard.down(k);
      await h.wait(900);
      c = h.sampleCollector(page);
      await h.wait(2600);
      ({ samples } = await c.stop());
      if (name === 'sprint') await h.shot(page, out, 'sash-sprint');
      for (const k of [...keys].reverse()) await page.keyboard.up(k);
      const o = h.oscillation(samples.map((x) => ({ t: x.t, v: x.modelY })));
      result[name] = { amp: +o.amp.toFixed(4), meanSpeed: +(samples.reduce((a, x) => a + x.speed, 0) / samples.length).toFixed(2) };
      await h.wait(600);
    }

    // Seaweed: sample the shared current for 14 s (0.18 Hz ≈ 2.5 cycles).
    c = h.sampleCollector(page);
    await h.wait(14000);
    ({ frames } = await c.stop());
    const sway = h.oscillation(frames.filter((f) => f.ambient).map((f) => ({ t: f.t, v: f.ambient.swaySample })));
    result.seaweed = { counts: frames.at(-1).ambient.seaweed, measuredHz: +sway.hz.toFixed(3), cycles: sway.cycles, particles: frames.at(-1).ambient.particles };
    await h.faceYaw(page, Math.PI);
    await h.wait(500);
    await h.shot(page, out, 'seaweed-canyon');
  } catch (error) {
    result.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 't4-fail.png') });
  } finally {
    result.errors = errors;
    h.fs.writeFileSync(h.path.join(out, 't4.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await browser.close();
  }
})();
