// Diagnose draw spikes: in frames with > 13 draws, record every draw's arguments (vertex / index counts).
const h = require('./harness.cjs');
const HOOK = () => {
  if (self.__nzd) return 'already';
  const S = (self.__nzd = { cur: [], spikes: [], frames: 0 });
  const wrap = (proto, names) => {
    for (const n of names) {
      const f = proto?.[n];
      if (typeof f !== 'function') continue;
      proto[n] = function (...a) { S.cur.push(n[4] === 'I' ? `I${a[0]}x${a[1] ?? 1}` : n === 'draw' ? `D${a[0]}x${a[1] ?? 1}` : n); return f.apply(this, a); };
    }
  };
  if (typeof GPURenderPassEncoder !== 'undefined') wrap(GPURenderPassEncoder.prototype, ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']);
  if (typeof GPUCanvasContext === 'undefined') return 'no-ctx';
  const g = GPUCanvasContext.prototype.getCurrentTexture;
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    S.frames += 1;
    if (S.cur.length > 13 && S.spikes.length < 30) S.spikes.push({ frame: S.frames, n: S.cur.length, draws: S.cur.slice(0, 60) });
    if (S.cur.length <= 13 && S.frames % 300 === 0 && S.spikes.length < 30) S.spikes.push({ frame: S.frames, n: S.cur.length, draws: S.cur.slice(0, 20), normal: true });
    S.cur = [];
    return g.call(this);
  };
  return 'hooked';
};
(async () => {
  const { browser, page, errors } = await h.launch({ lang: 'zh-CN', width: 1280, height: 720 });
  const workers = [];
  page.on('workercreated', async (w) => { workers.push(w); try { await w.evaluate(HOOK); } catch {} });
  const r = {};
  try {
    await h.open(page, `http://localhost:4191/?qa=1&dev=1&lab=${process.argv[2] ?? 'skipintro'}`);
    await h.startPlaying(page);
    await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const s = await h.state(page);
      if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
      if (s.dragon.telegraph && s.dragon.k >= s.dragon.hitStep - 4) await h.hold(page, ['Space'], 40);
      if (s.fight.stage !== 'fight') break;
      if (s.dragon.telegraph && s.dragon.k <= 3) r.tele = (r.tele ?? 0) + 1;
      await h.wait(50);
    }
    for (const w of workers) {
      try { const d = await w.evaluate(() => self.__nzd ? { frames: self.__nzd.frames, spikes: self.__nzd.spikes } : null); if (d) r.diag = d; } catch {}
    }
  } catch (e) { r.fail = e.stack; }
  r.errors = errors;
  h.fs.writeFileSync(h.path.join(h.ensureDir(h.path.join(h.ROOT, 'artifacts/m4/diag')), 'spikes.json'), JSON.stringify(r, null, 1));
  const d = r.diag;
  console.log('telegraph polls', r.tele, 'frames', d?.frames, 'spikes', d?.spikes.filter((x) => !x.normal).length);
  for (const sp of (d?.spikes ?? []).slice(0, 12)) console.log(sp.normal ? 'NORMAL' : 'SPIKE', sp.frame, sp.n, sp.draws.join(' '));
  await browser.close();
})();
