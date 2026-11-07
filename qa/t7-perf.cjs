// P3 + T7: development panel with real input, then the M1 performance proxy baseline
// (real GPU, 1920x1080, vsync off): frame time p95 and GPU draw commands per frame,
// counted by hooking WebGPU inside the Render Worker (frame boundary = getCurrentTexture).
const h = require('./harness.cjs');
const HOOK = () => {
  if (self.__nz) return 'already';
  const S = (self.__nz = { draws: 0, frames: [], last: 0 });
  const wrap = (proto, names) => {
    for (const n of names) {
      const f = proto?.[n];
      if (typeof f !== 'function') continue;
      proto[n] = function (...a) { S.draws += 1; return f.apply(this, a); };
    }
  };
  if (typeof GPURenderPassEncoder !== 'undefined') wrap(GPURenderPassEncoder.prototype, ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'multiDrawIndirect', 'multiDrawIndexedIndirect']);
  if (typeof GPURenderBundleEncoder !== 'undefined') wrap(GPURenderBundleEncoder.prototype, ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']);
  if (typeof GPUCanvasContext === 'undefined') return 'no-canvas-context';
  const g = GPUCanvasContext.prototype.getCurrentTexture;
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    const now = performance.now();
    if (S.last) S.frames.push([now - S.last, S.draws]);
    S.last = now;
    S.draws = 0;
    if (S.frames.length > 5000) S.frames.splice(0, 2500);
    return g.call(this);
  };
  return 'hooked';
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

(async () => {
  const base = process.argv[2] ?? 'http://localhost:4191/';
  const out = h.path.join(h.ROOT, 'artifacts/m1');
  const result = { panel: {}, perf: {} };
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN', width: 1920, height: 1080 });
  const workers = [];
  page.on('workercreated', async (worker) => {
    workers.push(worker);
    try { worker.hook = await worker.evaluate(HOOK); } catch (e) { worker.hook = String(e.message); }
  });
  await page.evaluateOnNewDocument(HOOK);
  const read = async () => {
    let frames = [];
    for (const w of [...workers, page]) {
      try { frames = frames.concat(await w.evaluate(() => (self.__nz ? self.__nz.frames.splice(0) : []))); } catch {}
    }
    return frames;
  };
  const sample = async (name, count = 600) => {
    await h.wait(1500);
    await read();
    let frames = [];
    const end = Date.now() + 20000;
    while (frames.length < count && Date.now() < end) {
      await h.wait(400);
      frames = frames.concat(await read());
    }
    frames = frames.slice(0, count);
    const ms = frames.map((f) => f[0]), draws = frames.map((f) => f[1]);
    const s = await h.state(page);
    result.perf[name] = { frames: frames.length, frameMsP50: +pct(ms, 0.5).toFixed(2), frameMsP95: +pct(ms, 0.95).toFixed(2), drawsP50: pct(draws, 0.5), drawsMax: Math.max(...draws), seaweed: s.ambient.seaweed.total };
    await h.shot(page, out, `perf-${name}`);
  };
  try {
    await h.open(page, `${base}?dev=1`);
    await h.startPlaying(page);
    await h.wait(800);
    result.hooks = workers.map((w) => w.hook);
    result.adapter = await page.evaluate(async () => {
      const a = await navigator.gpu?.requestAdapter();
      return a?.info ? { vendor: a.info.vendor, architecture: a.info.architecture, fallback: a.isFallbackAdapter ?? false } : null;
    });

    // --- P3: development panel with real input -------------------------------------
    await page.keyboard.press('F2');
    let s = await h.waitState(page, (x) => x.ui.debugOpen === true, 5000);
    result.panel.opened = { debugOpen: s.ui.debugOpen, pointerLocked: s.ui.pointerLocked, phase: s.ui.phase };
    await h.click(page, '[data-dev="cam-5.4"]');
    s = await h.waitState(page, (x) => x.tuning.overrides['camera.distance'] === 5.4, 5000);
    const slider = await page.evaluate(() => {
      const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
      const input = host.shadowRoot.querySelector('input[data-path="move.walkSpeed"]');
      input.scrollIntoView({ block: 'center' });
      const r = input.getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2, w: r.width };
    });
    await page.mouse.move(slider.x + slider.w * 0.4, slider.y);
    await page.mouse.down();
    await page.mouse.move(slider.x + slider.w + 20, slider.y, { steps: 8 });
    await page.mouse.up();
    s = await h.waitState(page, (x) => x.tuning.overrides['move.walkSpeed'] !== undefined, 5000);
    result.panel.overrides = s.tuning.overrides;
    await h.shot(page, out, 'debug-panel');
    await page.keyboard.press('F2');
    await h.waitState(page, (x) => !x.ui.debugOpen, 5000);
    await page.mouse.click(960, 540);
    await h.waitState(page, (x) => x.ui.pointerLocked, 5000);
    const c = h.sampleCollector(page);
    await h.hold(page, ['KeyW'], 1500);
    const { samples } = await c.stop();
    result.panel.walkSpeedMeasured = Math.max(...samples.map((x) => x.speed));
    await page.keyboard.press('F2');
    await h.waitState(page, (x) => x.ui.debugOpen, 5000);
    await h.click(page, '[data-dev="reset"]');
    s = await h.waitState(page, (x) => Object.keys(x.tuning.overrides).length === 0, 5000);
    result.panel.resetOk = true;
    await page.keyboard.press('F2');
    await h.waitState(page, (x) => !x.ui.debugOpen, 5000);
    await page.mouse.click(960, 540);
    await h.waitState(page, (x) => x.ui.pointerLocked, 5000);

    // --- T7: performance baseline ---------------------------------------------------
    await h.goTo(page, 0.6, 33, { timeout: 25000 });
    await h.faceYaw(page, 0);
    await sample('canyon');
    await h.goTo(page, 0, 9, { sprint: true, timeout: 25000 });
    await h.faceYaw(page, 0.3);
    await sample('plaza');
    await h.faceYaw(page, 0);
    await h.hold(page, ['KeyR'], 90);
    await h.waitState(page, (x) => x.lock.active, 5000);
    await page.keyboard.down('KeyA');
    await h.wait(1600);
    await page.keyboard.up('KeyA');
    await sample('plaza-locked');
    for (const tier of ['0', '1200']) {
      await page.keyboard.press('F2');
      await h.waitState(page, (x) => x.ui.debugOpen, 5000);
      await h.click(page, `[data-dev="seaweed-${tier}"]`);
      await h.wait(400);
      await page.keyboard.press('F2');
      await h.waitState(page, (x) => !x.ui.debugOpen, 5000);
      await sample(`plaza-locked-seaweed${tier}`);
    }
  } catch (error) {
    result.fail = error.stack;
    await page.screenshot({ path: h.path.join(h.ensureDir(h.path.join(h.ROOT, '.forgeax/diag')), 't7-fail.png') });
  } finally {
    result.errors = errors;
    h.fs.writeFileSync(h.path.join(out, 't7-perf.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await browser.close();
  }
})();
