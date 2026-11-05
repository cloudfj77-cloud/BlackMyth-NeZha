// Shared helpers: drive the BUILT game (forgeax project preview of dist/) with real input.
const puppeteer = require('/Users/cloud/WorkBuddy/2026-10-31-16-30-00/qa/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch({ lang = 'zh-CN', width = 1280, height = 720 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-webgpu', `--window-size=${width},${height + 80}`, `--lang=${lang}`],
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

/** HUD host element inside #game-ui (open shadow root). */
async function hud(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#game-ui > [data-ui-asset]') ?? [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
    if (!host) return null;
    const raw = host.dataset.hud;
    return { phase: host.dataset.phase, lang: host.dataset.lang, state: raw ? JSON.parse(raw) : null, classes: host.className };
  });
}

async function waitHud(page, predicate, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await hud(page);
    if (last && predicate(last)) return last;
    await wait(120);
  }
  return last;
}

/** Centre of a visible element in the HUD shadow root matched by selector (optionally by text). */
async function hudPoint(page, selector) {
  return page.evaluate((selector) => {
    const host = document.querySelector('#game-ui > [data-ui-asset]');
    const element = [...(host?.shadowRoot?.querySelectorAll(selector) ?? [])].find((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: element.textContent };
  }, selector);
}

async function clickHud(page, selector) {
  const point = await hudPoint(page, selector);
  if (!point) throw new Error(`HUD element not visible: ${selector}`);
  await page.mouse.click(point.x, point.y);
  return point;
}

/** Every visible text node in the HUD with its box, for language / overlap / clipping checks. */
async function visibleTexts(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#game-ui > [data-ui-asset]');
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          const element = child.parentElement;
          const style = getComputedStyle(element);
          const range = document.createRange();
          range.selectNodeContents(child);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
          if (!rects.length || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
          let hidden = false;
          for (let e = element; e && e !== host; e = e.parentElement ?? e.getRootNode().host) {
            const s = getComputedStyle(e);
            if (s.display === 'none' || Number(s.opacity) === 0) { hidden = true; break; }
          }
          if (hidden) continue;
          const box = range.getBoundingClientRect();
          out.push({
            text: child.textContent.trim(),
            box: { x: box.x, y: box.y, w: box.width, h: box.height },
            clipped: element.scrollWidth > element.clientWidth + 1 && style.overflow !== 'visible',
            lines: rects.length,
            langSwitch: !!element.closest('.lang-switch'),
          });
        } else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
      }
    };
    if (host?.shadowRoot) walk(host.shadowRoot);
    for (const id of ['forgeax-loading-title', 'forgeax-loading-subtitle']) {
      const element = document.getElementById(id);
      if (element && getComputedStyle(document.getElementById('forgeax-loading')).opacity !== '0' && element.textContent.trim()) {
        const r = element.getBoundingClientRect();
        out.push({ text: element.textContent.trim(), box: { x: r.x, y: r.y, w: r.width, h: r.height }, clipped: false, lines: 1, host: true });
      }
    }
    return { texts: out, title: document.title, htmlLang: document.documentElement.lang };
  });
}

async function holdKeys(page, codes, ms) {
  for (const code of codes) await page.keyboard.down(code);
  await wait(ms);
  for (const code of [...codes].reverse()) await page.keyboard.up(code);
}

/** Relative mouse motion while pointer-locked, in small real steps. */
const cursor = { x: 640, y: 360 };
async function look(page, dx, dy, steps = 12) {
  for (let index = 1; index <= steps; index += 1) {
    cursor.x += dx / steps;
    cursor.y += dy / steps;
    await page.mouse.move(cursor.x, cursor.y);
    await wait(16);
  }
}

async function fps(page, ms = 2000) {
  return page.evaluate((ms) => new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - started < ms) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (performance.now() - started));
    };
    requestAnimationFrame(tick);
  }), ms);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { wait, launch, hud, waitHud, hudPoint, clickHud, visibleTexts, holdKeys, look, fps, ensureDir, path, fs };

/** Steer with real WASD toward each waypoint (x, z) using the camera yaw the HUD reports. */
async function navigate(page, waypoints, { run = false, tolerance = 1.0, timeout = 60000, onStep } = {}) {
  const combos = [['KeyW'], ['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA']];
  const axes = { KeyW: [0, 1], KeyS: [0, -1], KeyD: [1, 0], KeyA: [-1, 0] };
  let held = [];
  const setKeys = async (next) => {
    for (const key of held) if (!next.includes(key)) await page.keyboard.up(key);
    for (const key of next) if (!held.includes(key)) await page.keyboard.down(key);
    held = next;
  };
  if (run) await page.keyboard.down('ShiftLeft');
  const end = Date.now() + timeout;
  let index = 0;
  let last;
  try {
    while (index < waypoints.length && Date.now() < end) {
      const h = await hud(page);
      const s = h?.state;
      if (!s) { await wait(100); continue; }
      last = s;
      const [px, , pz] = s.player.position;
      const [tx, tz] = waypoints[index];
      const dx = tx - px, dz = tz - pz;
      if (Math.hypot(dx, dz) < tolerance) { index += 1; continue; }
      const yaw = s.camera.yaw;
      const fwd = [Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), Math.sin(yaw)];
      let best = combos[0], bestDot = -Infinity;
      for (const combo of combos) {
        let h2 = 0, v2 = 0;
        for (const key of combo) { h2 += axes[key][0]; v2 += axes[key][1]; }
        const len = Math.hypot(h2, v2);
        const mx = (fwd[0] * v2 + right[0] * h2) / len, mz = (fwd[1] * v2 + right[1] * h2) / len;
        const dot = (mx * dx + mz * dz) / Math.hypot(dx, dz);
        if (dot > bestDot) { bestDot = dot; best = combo; }
      }
      await setKeys(best);
      if (onStep) await onStep(s);
      await wait(90);
    }
  } finally {
    await setKeys([]);
    if (run) await page.keyboard.up('ShiftLeft');
  }
  return { reached: index >= waypoints.length, state: last };
}

/** Canyon centre line from the spawn to the plaza mouth (mirrors assets/shared/layout.ts). */
function canyonPath(fromZ = 49, toZ = 21, step = 2.5) {
  const center = (z) => (z <= 20 ? 0 : 2.0 * Math.sin((Math.PI * (z - 20)) / 17));
  const points = [];
  for (let z = fromZ; z >= toZ; z -= step) points.push([center(z), z]);
  return points;
}

module.exports.navigate = navigate;
module.exports.canyonPath = canyonPath;

/** Steer with real WASD toward each waypoint (x, z) using the camera yaw the HUD reports. */
async function navigate(page, waypoints, { run = false, tolerance = 1.0, timeout = 60000, onStep } = {}) {
  const combos = [['KeyW'], ['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA']];
  const axes = { KeyW: [0, 1], KeyS: [0, -1], KeyD: [1, 0], KeyA: [-1, 0] };
  let held = [];
  const setKeys = async (next) => {
    for (const key of held) if (!next.includes(key)) await page.keyboard.up(key);
    for (const key of next) if (!held.includes(key)) await page.keyboard.down(key);
    held = next;
  };
  if (run) await page.keyboard.down('ShiftLeft');
  const end = Date.now() + timeout;
  let index = 0;
  let last;
  try {
    while (index < waypoints.length && Date.now() < end) {
      const h = await hud(page);
      const s = h?.state;
      if (!s) { await wait(100); continue; }
      last = s;
      const [px, , pz] = s.player.position;
      const [tx, tz] = waypoints[index];
      const dx = tx - px, dz = tz - pz;
      if (Math.hypot(dx, dz) < tolerance) { index += 1; continue; }
      const yaw = s.camera.yaw;
      const fwd = [Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), Math.sin(yaw)];
      let best = combos[0], bestDot = -Infinity;
      for (const combo of combos) {
        let h2 = 0, v2 = 0;
        for (const key of combo) { h2 += axes[key][0]; v2 += axes[key][1]; }
        const len = Math.hypot(h2, v2);
        const mx = (fwd[0] * v2 + right[0] * h2) / len, mz = (fwd[1] * v2 + right[1] * h2) / len;
        const dot = (mx * dx + mz * dz) / Math.hypot(dx, dz);
        if (dot > bestDot) { bestDot = dot; best = combo; }
      }
      await setKeys(best);
      if (onStep) await onStep(s);
      await wait(90);
    }
  } finally {
    await setKeys([]);
    if (run) await page.keyboard.up('ShiftLeft');
  }
  return { reached: index >= waypoints.length, state: last };
}

/** Canyon centre line from the spawn to the plaza mouth (mirrors assets/shared/layout.ts). */
function canyonPath(fromZ = 49, toZ = 21, step = 2.5) {
  const center = (z) => (z <= 20 ? 0 : 2.0 * Math.sin((Math.PI * (z - 20)) / 17));
  const points = [];
  for (let z = fromZ; z >= toZ; z -= step) points.push([center(z), z]);
  return points;
}

module.exports.navigate = navigate;
module.exports.canyonPath = canyonPath;
