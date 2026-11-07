// T3 acceptance: right-shoulder camera against reef walls on the BUILT preview, real input.
const h = require('./harness.cjs');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4191/?qa=1';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = { sweep: [] };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN' });
  const poll = async (ms) => {
    const trace = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await h.state(page);
      trace.push(s.camera);
      await h.wait(40);
    }
    return trace;
  };
  try {
    await h.open(page, url);
    await h.startPlaying(page);
    await h.wait(500);
    const spawn = await h.state(page);
    result.spawn = spawn.camera;

    // a) Back Nezha straight into the canyon dead end (camera yaw 0 -> S moves toward +Z).
    let trace = [];
    await page.keyboard.down('KeyS');
    trace = trace.concat(await poll(1800));
    await page.keyboard.up('KeyS');
    await h.wait(300);
    const back = await h.state(page);
    result.backToWall = { camera: back.camera, root: back.player.root };
    result.backTraceAllClear = trace.every((c) => c.lineClear);
    result.backTraceMinDistance = Math.min(...trace.map((c) => c.distance));
    await h.shot(page, out, 'wall-back');

    // b) Sweep the camera 360° in 30° steps against the wall corner.
    for (let step = 0; step < 12; step += 1) {
      await h.look(page, 300, 0, 10); // 300 px × 0.1°/px = 30°
      await h.wait(160);
      const s = await h.state(page);
      result.sweep.push({ yawDeg: Math.round((s.camera.yaw * 180) / Math.PI), distance: s.camera.distance, blocked: s.camera.blocked, lifted: s.camera.lifted, lineClear: s.camera.lineClear });
      if (step === 2) await h.shot(page, out, 'wall');
    }
    result.sweepAllClear = result.sweep.every((x) => x.lineClear);

    // c) Walk away from the wall: the boom must ease back (delay 0.1 s, ~0.4 s).
    await h.faceYaw(page, 0);
    await page.keyboard.down('KeyW');
    const away = await poll(1500);
    await page.keyboard.up('KeyW');
    await h.wait(200);
    result.returnTrace = away.map((c) => +c.distance.toFixed(2)).filter((_, i) => i % 3 === 0);
    result.returnFinal = (await h.state(page)).camera.distance;

    // d) Look up / down limits (pitch -25°..60°).
    await h.look(page, 0, 900, 20);
    const down = (await h.state(page)).camera.pitch;
    await h.look(page, 0, -1400, 30);
    const up = (await h.state(page)).camera.pitch;
    result.pitchRangeDeg = [Math.round((up * 180) / Math.PI), Math.round((down * 180) / Math.PI)];
    await h.look(page, 0, 370, 12); // back to the 12° default (-25° + 37°)

    // e) Canyon darkness review frame, then fly into the plaza for fog / beam frames.
    await h.goTo(page, -0.5, 36, { sprint: false });
    await h.faceYaw(page, 0);
    await h.wait(400);
    await h.shot(page, out, 'review-canyon-dark');
    const arrived = await h.goTo(page, 0, 8, { sprint: true, timeout: 25000 });
    result.reachedPlaza = arrived.player.root;
    await h.faceYaw(page, -0.45);
    await h.wait(500);
    await h.shot(page, out, 'plaza-beam');
  } catch (error) {
    result.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 't3-fail.png') });
  } finally {
    result.errors = errors;
    h.fs.writeFileSync(h.path.join(out, 't3.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await browser.close();
  }
})();
