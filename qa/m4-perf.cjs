// M3 performance (QA 10): real GPU 1920×1080, GPU draw commands per frame counted inside the Render
// Worker (frame boundary = getCurrentTexture), with the dragon in view; dragon CPU from telemetry.
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
  const out = h.path.join(h.ROOT, 'artifacts/m4/accept');
  const result = { perf: {} };
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
    await read();
    let frames = [];
    const cpu = [];
    const spikes = [];
    const end = Date.now() + 25000;
    while (frames.length < count && Date.now() < end) {
      await h.wait(300);
      frames = frames.concat(await read());
      const s = await h.state(page);
      cpu.push(s.dragon.cpuMs);
      if (frames.length && Math.max(...frames.slice(-40).map((f) => f[1])) > 13) spikes.push({ tele: s.dragon.telegraph, kind: s.dragon.kind, k: s.dragon.k, mode: s.dragon.mode, seeThrough: s.dragon.seeThrough, lensHidden: s.dragon.lensHidden, hidden: s.occlusion?.faded ?? null });
    }
    frames = frames.slice(0, count);
    const ms = frames.map((f) => f[0]), draws = frames.map((f) => f[1]);
    result.perf[name] = { frames: frames.length, frameMsP50: +pct(ms, 0.5).toFixed(2), frameMsP95: +pct(ms, 0.95).toFixed(2), drawsP50: pct(draws, 0.5), drawsMax: Math.max(...draws), drawsP95: pct(draws, 0.95), drawsP99: pct(draws, 0.99), over13: draws.filter((d) => d > 13).length, hist: Object.entries(draws.reduce((m, d) => ((m[d] = (m[d] ?? 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' '), dragonCpuP50: pct(cpu, 0.5), dragonCpuP95: pct(cpu, 0.95), spikes: spikes.slice(0, 12) };
    await h.shot(page, out, `perf-${name}`);
  };
  try {
    await h.open(page, 'http://localhost:4191/?qa=1&dev=1&lab=skipintro,phase2');
    await h.startPlaying(page);
    result.hooks = workers.map((w) => w.hook);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    await h.wait(1500);
    await sample('phase1-locked', 900);
    // Cross half health: bind in an opening and strike until the phase change starts.
    for (let i = 0; i < 8; i += 1) {
      let s = await h.state(page);
      if (s.fight.stage === 'transition') break;
      s = await h.waitState(page, (q) => q.dragon.opening || q.fight.stage === 'transition', 30000);
      if (s.fight.stage === 'transition') break;
      if (s.combat.sashCd === 0) await h.hold(page, ['Digit1'], 50);
      s = await h.state(page);
      const t = s.lock.lookPoint;
      await h.goTo(page, t[0], t[2], { sprint: true, tolerance: 2.2, timeout: 2000 });
      for (let k = 0; k < 4; k += 1) { await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' }); await h.wait(160); }
    }
    await h.waitState(page, (q) => q.fight.stage === 'transition', 8000);
    await sample('phase-change-roar', 500);
    // Phase 2 with the coil (water burst) and rolls (perfect-dodge attempts) on every telegraph.
    const end = Date.now() + 25000;
    await read();
    let frames = [];
    const cpu = [];
    while (Date.now() < end && frames.length < 1500) {
      const s = await h.state(page);
      cpu.push(s.dragon.cpuMs);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      if (s.dragon.telegraph && s.dragon.k >= s.dragon.hitStep - 4) await h.hold(page, ['Space'], 40);
      frames = frames.concat(await read());
      await h.wait(40);
    }
    const ms = frames.map((f) => f[0]), draws = frames.map((f) => f[1]);
    result.perf['phase2'] = { frames: frames.length, frameMsP50: +pct(ms, 0.5).toFixed(2), frameMsP95: +pct(ms, 0.95).toFixed(2), drawsP50: pct(draws, 0.5), drawsMax: Math.max(...draws), drawsP95: pct(draws, 0.95), drawsP99: pct(draws, 0.99), over13: draws.filter((d) => d > 13).length, hist: Object.entries(draws.reduce((m, d) => ((m[d] = (m[d] ?? 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' '), dragonCpuP50: pct(cpu, 0.5), dragonCpuP95: pct(cpu, 0.95) };
    const s = await h.state(page);
    result.audio = await page.evaluate(() => {
      const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
      return JSON.parse(host?.dataset.audio ?? '{}');
    });
    result.fightLog = s.fight.log;
  } catch (error) {
    result.fail = error.stack;
  } finally {
    result.errors = errors;
    h.fs.writeFileSync(h.path.join(h.ensureDir(out), 'perf.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 1));
    await browser.close();
  }
})();
