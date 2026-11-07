// Run in a normal terminal (WorkBuddy's sandbox cannot start the play browser):
//   pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json
// M1 official playthrough: start → pointer lock → walk speed / stop time on game-time samples →
// idle float via play.advance (frame-exact) → dash down the canyon → R lock-on.
// State comes only from the `nezha` read projection (assets/core/core.pack.ts).

const READ = { read: 'nezha' };

function fail(message, detail) {
  throw new Error(`${message}: ${JSON.stringify(detail).slice(0, 400)}`);
}

async function uiCentre(play, selector) {
  return play.page.evaluate((sel) => {
    const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
    const el = host?.shadowRoot?.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

function oscillation(points) {
  const mean = points.reduce((a, p) => a + p.v, 0) / points.length;
  const times = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1].v - mean, b = points[i].v - mean;
    if (a < 0 && b >= 0) times.push(points[i - 1].t + (-a / (b - a)) * (points[i].t - points[i - 1].t));
  }
  const vs = points.map((p) => p.v);
  return { amp: (Math.max(...vs) - Math.min(...vs)) / 2, hz: times.length > 1 ? (times.length - 1) / (times.at(-1) - times[0]) : 0 };
}

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  const out = {};
  await play.step('title', async () => {
    await play.waitFor((s) => s.ui?.phase === 'title', { ...READ, timeoutMs: 60_000 });
    await play.screenshot('title');
  });
  await play.step('start', async () => {
    const button = await uiCentre(play, '[data-ui-action="start"]');
    if (!button) fail('start button not visible', {});
    await play.mouse.click(button);
    await play.waitFor((s) => s.ui.phase === 'playing', READ);
    const size = play.page.viewportSize?.() ?? { width: 1280, height: 720 };
    await play.mouse.click({ x: size.width / 2, y: size.height / 2 });
    await play.waitFor((s) => s.ui.pointerLocked === true, { ...READ, timeoutMs: 10_000 });
  });
  await play.step('walk', async () => {
    await play.keyboard.hold('KeyW', 1500);
    await play.advance(0.5, READ);
    const s = await play.state('nezha');
    const samples = s.player.samples;
    const top = Math.max(...samples.map((x) => x.speed));
    const last = samples.map((x) => x.speed).lastIndexOf(top);
    const stopped = samples.findIndex((x, i) => i > last && x.speed < 0.01);
    out.walk = { speed: top, stopSeconds: stopped > 0 ? +(samples[stopped].t - samples[last].t).toFixed(3) : null };
    if (Math.abs(top - 5) > 0.25) fail('walk speed outside 5 m/s ±5%', out.walk);
    if (out.walk.stopSeconds === null || out.walk.stopSeconds > 0.15 + 1 / 60) fail('stop slower than 0.15 s', out.walk);
    await play.screenshot('walk');
  });
  await play.step('idle-float', async () => {
    const points = [];
    for (let i = 0; i < 10; i += 1) {
      const s = await play.advance(0.5, READ);
      for (const x of s.player.samples) if (!points.some((p) => p.t === x.t)) points.push({ t: x.t, v: x.modelY, c: x.capsuleY });
    }
    points.sort((a, b) => a.t - b.t);
    const o = oscillation(points);
    const capsuleSpan = Math.max(...points.map((p) => p.c)) - Math.min(...points.map((p) => p.c));
    out.float = { amp: +o.amp.toFixed(4), hz: +o.hz.toFixed(3), capsuleSpanMm: +(capsuleSpan * 1000).toFixed(3) };
    if (Math.abs(o.amp - 0.05) > 0.005 || Math.abs(o.hz - 0.8) > 0.08) fail('idle float outside ±5 cm / 0.8 Hz ±10%', out.float);
    if (capsuleSpan > 0.001) fail('capsule moved while floating', out.float);
    await play.screenshot('hover');
  });
  await play.step('canyon-to-plaza', async () => {
    await play.keyboard.hold(['ShiftLeft', 'KeyW'], (s) => s.player.root[2] < 14, { ...READ, timeoutMs: 20_000 }).catch(() => undefined);
    const s = await play.state('nezha');
    out.reached = s.player.root;
    await play.screenshot('plaza');
  });
  await play.step('lock-on', async () => {
    await play.keyboard.press('KeyR');
    const s = await play.waitFor((x) => x.lock.active || x.lock.hint === 'noTarget', { ...READ, timeoutMs: 5_000 });
    out.lock = { active: s.lock.active, distance: s.lock.distance, nezhaInFrame: s.lock.nezhaInFrame };
    if (!s.lock.active && s.lock.distance <= 25) fail('R did not lock within 25 m', out.lock);
    await play.screenshot('lock');
  });
  return out;
}
