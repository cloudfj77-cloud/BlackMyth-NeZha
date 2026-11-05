// QA harness for the BUILT game (forgeax project preview of dist/), driven with real
// keyboard / mouse through system Chrome. State comes only from the game's read
// projection `nezha` (inspection bridge, or its ?qa=1 DOM mirror), never from game internals.
const puppeteer = require('/Users/cloud/WorkBuddy/2026-10-31-16-30-00/qa/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROOT = path.resolve(__dirname, '..');

async function launch({ lang = 'zh-CN', width = 1280, height = 720, gpu = true } = {}) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--enable-unsafe-webgpu',
      ...(gpu ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] : []),
      `--window-size=${width},${height + 80}`,
      `--lang=${lang}`,
    ],
    defaultViewport: { width, height },
    env: { ...process.env, LANG: lang.replace('-', '_') + '.UTF-8' },
  });
  const page = (await browser.pages())[0];
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  await page.evaluateOnNewDocument((language) => {
    Object.defineProperty(navigator, 'language', { get: () => language });
    Object.defineProperty(navigator, 'languages', { get: () => [language] });
  }, lang);
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.bringToFront();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return { browser, page, errors };
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html[data-forgeax-input="open"]', { timeout: 120000 });
  await waitState(page, (s) => s && s.ui && s.ui.phase === 'title', 60000);
}

/** Read the `nezha` projection. */
async function state(page) {
  return page.evaluate(async () => {
    // Dev host: the inspection bridge. Static preview: the menu's DOM mirror of the same projection (?qa=1).
    const inspection = globalThis.__forgeaxGameInspection;
    if (inspection) {
      try {
        return await inspection.read('nezha');
      } catch (error) {
        return null;
      }
    }
    const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
    const raw = host?.dataset.nezha;
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitState(page, predicate, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await state(page);
    if (last && predicate(last)) return last;
    await wait(80);
  }
  throw new Error(`waitState timed out; last=${JSON.stringify(last)?.slice(0, 400)}`);
}

/** Menu host element (open shadow root) inside #game-ui. */
async function uiPoint(page, selector) {
  return page.evaluate((selector) => {
    const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
    const element = [...(host?.shadowRoot?.querySelectorAll(selector) ?? [])].find((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, selector);
}

async function click(page, selector) {
  const point = await uiPoint(page, selector);
  if (!point) throw new Error(`UI element not visible: ${selector}`);
  await page.mouse.click(point.x, point.y);
  return point;
}

/** Start the game from the title screen and take pointer lock with a real click. */
async function startPlaying(page) {
  await click(page, '[data-ui-action="start"]');
  await waitState(page, (s) => s.ui.phase === 'playing');
  const view = page.viewport();
  await page.mouse.click(view.width / 2, view.height / 2);
  await waitState(page, (s) => s.ui.pointerLocked === true, 8000);
}

async function hold(page, codes, ms) {
  for (const code of codes) await page.keyboard.down(code);
  await wait(ms);
  for (const code of [...codes].reverse()) await page.keyboard.up(code);
}

/**
 * Relative mouse look while pointer-locked. The page only sees movement deltas, so the
 * virtual cursor is tracked without re-centring (re-centring would emit the opposite delta).
 */
const cursors = new WeakMap();
async function look(page, dx, dy, steps = 12) {
  const view = page.viewport();
  const cursor = cursors.get(page) ?? { x: view.width / 2, y: view.height / 2 };
  cursors.set(page, cursor);
  const x0 = cursor.x, y0 = cursor.y;
  for (let index = 1; index <= steps; index += 1) {
    cursor.x = x0 + (dx * index) / steps;
    cursor.y = y0 + (dy * index) / steps;
    await page.mouse.move(cursor.x, cursor.y);
    await wait(16);
  }
}

async function visibleTexts(page) {
  return page.evaluate(() => {
    const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
    const out = [];
    const walk = (node) => {
      for (const child of node.children ?? []) {
        if (child.closest?.('[data-ui-part="debug-panel"]') || child.dataset?.uiPart === 'dev-badge') continue;
        const style = getComputedStyle(child);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const own = [...child.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
        if (own && child.getClientRects().length) {
          const r = child.getBoundingClientRect();
          out.push({ text: own, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, overflow: child.scrollWidth > child.clientWidth + 1 });
        }
        walk(child);
      }
    };
    if (host?.shadowRoot) walk(host.shadowRoot);
    return out;
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function shot(page, dir, name) {
  const file = path.join(ensureDir(dir), `${name}.png`);
  await page.screenshot({ path: file });
  return path.relative(ROOT, file);
}

module.exports = { wait, launch, open, state, waitState, uiPoint, click, startPlaying, hold, look, visibleTexts, ensureDir, shot, ROOT, path, fs };

/**
 * Fly to (x, z) with real input: hold W (and Shift to sprint) and steer the camera
 * with relative mouse moves toward the waypoint. Returns the final state.
 */
async function goTo(page, x, z, { sprint = false, tolerance = 0.8, timeout = 20000 } = {}) {
  const end = Date.now() + timeout;
  let s = await state(page);
  await page.keyboard.down('KeyW');
  if (sprint) await page.keyboard.down('ShiftLeft');
  try {
    while (Date.now() < end) {
      s = await state(page);
      const [px, , pz] = s.player.root;
      const dx = x - px, dz = z - pz;
      if (Math.hypot(dx, dz) < tolerance) break;
      const want = Math.atan2(dx, -dz);
      const diff = Math.atan2(Math.sin(want - s.camera.yaw), Math.cos(want - s.camera.yaw));
      const px2 = Math.max(-300, Math.min(300, diff / ((0.1 * Math.PI) / 180)));
      if (Math.abs(px2) > 2) await look(page, px2, 0, 3);
      await wait(60);
    }
  } finally {
    if (sprint) await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyW');
  }
  await wait(250);
  return state(page);
}
module.exports.goTo = goTo;

/** Turn the camera to an absolute yaw (radians) with relative mouse moves. */
async function faceYaw(page, yaw) {
  for (let i = 0; i < 6; i += 1) {
    const s = await state(page);
    const diff = Math.atan2(Math.sin(yaw - s.camera.yaw), Math.cos(yaw - s.camera.yaw));
    if (Math.abs(diff) < 0.01) return s;
    const px = diff / ((0.1 * Math.PI) / 180);
    await look(page, Math.max(-400, Math.min(400, px)), 0, 6);
    await wait(120);
  }
  return state(page);
}
module.exports.faceYaw = faceYaw;

/** Accumulate the fixed-step `player.samples` ring buffer across polls (game-time stamps). */
function sampleCollector(page) {
  const byT = new Map();
  const extra = [];
  let running = true;
  let since;
  const loop = (async () => {
    while (running) {
      const s = await state(page);
      const samples = s?.player?.samples ?? [];
      since ??= samples.at(-1)?.t ?? 0;
      for (const sample of samples) if (sample.t >= since) byT.set(sample.t, sample);
      if (s) extra.push({ t: s.t, ambient: s.ambient, float: s.float, sash: s.sash });
      await wait(40);
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return { samples: [...byT.values()].sort((a, b) => a.t - b.t), frames: extra };
    },
  };
}

/** Amplitude and frequency (interpolated upward zero crossings) of a sampled signal. */
function oscillation(points) {
  if (points.length < 3) return { amp: 0, hz: 0, mean: 0 };
  const mean = points.reduce((a, p) => a + p.v, 0) / points.length;
  const times = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1].v - mean, b = points[i].v - mean;
    if (a < 0 && b >= 0) times.push(points[i - 1].t + (-a / (b - a)) * (points[i].t - points[i - 1].t));
  }
  const vs = points.map((p) => p.v);
  return { amp: (Math.max(...vs) - Math.min(...vs)) / 2, hz: times.length > 1 ? (times.length - 1) / (times.at(-1) - times[0]) : 0, mean, cycles: Math.max(0, times.length - 1) };
}
module.exports.sampleCollector = sampleCollector;
module.exports.oscillation = oscillation;
