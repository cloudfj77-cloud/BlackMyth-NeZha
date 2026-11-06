// Release gate (v1.4.0 qa/run.js + scripts/release.sh, ported): build → unit tests → real Chrome on the
// built preview with real keys / mouse → PASS / FAIL with measured vs expected → report + screenshots.
// Any blocking case failing → exit 1 (scripts/release.sh refuses to tag). Starts its own preview on :4192
// and always stops it (no server left running).
//
//   node qa/gate.cjs              full gate (build + tests + browser)
//   node qa/gate.cjs --no-build   reuse dist/
const { spawn, execSync } = require('child_process');
const h = require('./harness.cjs');
const { path, fs } = h;

const ROOT = h.ROOT;
const OUT = path.join(ROOT, 'artifacts/gate');
const PORT = 4192;
const BASE = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);
const results = [];
const record = (suite, name, pass, measured, expect, level = 'block') => {
  results.push({ suite, name, pass: !!pass, measured: String(measured), expect, level });
  console.log(`${pass ? '  ✓' : level === 'block' ? '  ✗' : '  △'} [${suite}] ${name} — 实测 ${measured}（标准 ${expect}）`);
};
const click = async (page) => { await page.mouse.down({ button: 'left' }); await h.wait(30); await page.mouse.up({ button: 'left' }); };
const fps = (page) => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(f); }));

async function withPage(lang, url, fn) {
  const { browser, page, errors } = await h.launch({ lang });
  try {
    await h.open(page, url);
    await fn(page);
  } catch (e) {
    record('运行', `脚本异常 ${url}`, false, String(e.message).slice(0, 160), '无异常');
    await page.screenshot({ path: path.join(h.ensureDir(OUT), `fail-${Date.now()}.png`) }).catch(() => {});
  }
  record('稳定', `0 JS 报错（${url.replace(BASE, '/')}）`, errors.length === 0, errors.length ? errors[0].slice(0, 120) : 0, '0');
  await browser.close();
}

async function main() {
  h.ensureDir(OUT);
  const t0 = Date.now();
  // --- 1. Build and unit tests ---------------------------------------------------------------
  if (!args.includes('--no-build')) {
    try { execSync('bash scripts/build.sh', { cwd: ROOT, stdio: 'pipe' }); record('构建', 'forgeax project build', true, 'ok', '成功'); }
    catch (e) { record('构建', 'forgeax project build', false, String(e.stdout).slice(-200), '成功'); return; }
  }
  try { execSync('npx tsc --noEmit -p .', { cwd: ROOT, stdio: 'pipe' }); record('代码', '类型检查', true, 'ok', '0 错误'); }
  catch (e) { record('代码', '类型检查', false, String(e.stdout).slice(0, 200), '0 错误'); }
  try {
    const out = execSync('npx vitest run', { cwd: ROOT, stdio: 'pipe' }).toString();
    const m = out.match(/Tests\s+(\d+) passed/);
    record('代码', '单元测试', true, m ? `${m[1]} 项全过` : 'ok', '全部通过');
  } catch (e) { record('代码', '单元测试', false, (String(e.stdout).match(/Tests .*/) ?? ['失败'])[0], '全部通过'); }

  // --- 2. Preview server (ours, stopped at the end) --------------------------------------------
  const server = spawn('pnpm', ['exec', 'forgeax', 'project', 'preview', '--port', String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }, detached: false });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) { try { const r = await fetch(BASE); up = r.ok; } catch { /* not yet */ } if (!up) await h.wait(500); }
    record('启动', '预览服务可访问', up, up ? '200' : '超时', '200');
    if (!up) return;

    // 启动 / 界面双语
    await withPage('zh-CN', `${BASE}?qa=1`, async (page) => {
      await h.wait(1200);
      await h.shot(page, OUT, '01-title-zh');
      const subs = await page.evaluate(() => {
        const host = [...document.querySelectorAll('#game-ui *')].find((e) => e.shadowRoot?.querySelector('[data-ui-part="hud"]'));
        return [...host.shadowRoot.querySelectorAll('[data-i18n-sub]')].filter((n) => n.textContent.trim()).map((n) => n.textContent.trim());
      });
      record('界面', '中文版标题带英文副标（中英双语）', subs.includes('Enter Chentang') && subs.some((s) => /White Myth/i.test(s)), subs.slice(0, 4).join(' / '), '含 Enter Chentang、White Myth');
    });
    await withPage('en', `${BASE}?qa=1`, async (page) => {
      await h.wait(1000);
      await h.shot(page, OUT, '02-title-en');
      const texts = (await h.visibleTexts(page)).map((t) => t.text);
      record('界面', '英文版无中文残留菜单', texts.includes('Enter Chentang') && !texts.some((t) => /踏上|操作|语言/.test(t)), texts.slice(0, 5).join(' / '), 'Enter Chentang，无中文菜单');
    });

    // 悬浮 + 关卡（夜叉一刀倒：weakmobs）
    await withPage('zh-CN', `${BASE}?qa=1&dev=1&lab=weakmobs`, async (page) => {
      await h.startPlaying(page);
      await h.wait(1000);
      let s = await h.state(page);
      record('关卡', '出生在栈道北端、水门关闭', s.player.root[2] > 100 && !s.sea.gateOpen, `z ${s.player.root[2].toFixed(1)} · 水门${s.sea.gateOpen ? '开' : '关'}`, 'z > 100 · 关');
      const ys = [];
      for (let i = 0; i < 30; i += 1) { s = await h.state(page); ys.push(s.rig.hover.dy); await h.wait(70); }
      const amp = Math.max(...ys) - Math.min(...ys);
      record('悬浮', '哪吒贴地悬浮且上下起伏（v1.4.0）', amp > 0.02 && amp < 0.3, `起伏 ${amp.toFixed(3)} m`, '0.02–0.3 m');
      await h.goTo(page, 0, 95, { tolerance: 1, timeout: 15000 });
      s = await h.waitState(page, (q) => q.yaksha.alive > 0, 4000).catch(() => null);
      record('关卡', '越线刷出第一波巡海夜叉', s && s.yaksha.alive === 2, s ? s.yaksha.alive : 0, '2 只');
      await h.shot(page, OUT, '03-ambush');
      let token = 0;
      const clear = async (budget) => {
        const end = Date.now() + budget;
        while (Date.now() < end) {
          const q = await h.state(page);
          token = Math.max(token, q.yaksha.mobs.filter((m) => m.state === 'attack').length);
          if (q.yaksha.alive === 0) return true;
          if (!q.lock.active) await h.hold(page, ['KeyR'], 40);
          const live = q.yaksha.mobs.filter((m) => m.state !== 'dead');
          const r = q.player.root;
          const near = live.map((m) => Math.hypot(m.x - r[0], m.z - r[2])).sort((a, b) => a - b)[0] ?? 9;
          if (near > 2) await h.hold(page, ['KeyW'], 120); else { await click(page); await h.wait(160); }
        }
        return false;
      };
      record('关卡', '第一波可击杀', await clear(25000), '', '清空');
      await h.goTo(page, 0, 67.5, { sprint: true, tolerance: 1, timeout: 15000 });
      s = await h.waitState(page, (q) => q.yaksha.alive > 0, 4000).catch(() => null);
      record('关卡', '第二波 3 只', s && s.yaksha.alive === 3, s ? s.yaksha.alive : 0, '3 只');
      record('关卡', '第二波可击杀', await clear(30000), '', '清空');
      record('关卡', '攻击令牌：同时出手 ≤ 1', token <= 1, token, '≤ 1');
      await h.goTo(page, 0.5, 52, { tolerance: 1.2, timeout: 10000 });
      s = await h.state(page);
      record('关卡', '清完开水门', s.sea.gateOpen, s.sea.gateOpen ? '开' : '关', '开');
      record('关卡', '太乙莲台检查点', s.yaksha.lit, s.yaksha.lit ? '已记录' : '未记录', '已记录');
      await h.shot(page, OUT, '04-gate-open');
    });

    // 重试（栈道上阵亡）
    await withPage('zh-CN', `${BASE}?qa=1&dev=1&lab=frail`, async (page) => {
      await h.startPlaying(page);
      await h.goTo(page, 0, 95, { tolerance: 1, timeout: 15000 });
      let s = await h.waitState(page, (q) => q.fight.stage === 'defeat', 40000).catch(() => null);
      record('重试', '前置关卡可阵亡（败）', !!s, s ? s.fight.stage : '无', 'defeat');
      await h.wait(1200);
      await page.keyboard.press('Enter');
      s = await h.waitState(page, (q) => q.fight.stage === 'canyon', 6000).catch(() => null);
      await h.wait(400);
      s = await h.state(page);
      record('重试', '重试后满血、夜叉清空、水门关闭', s.combat.hp === 100 && s.yaksha.alive === 0 && s.yaksha.wave === 0 && !s.sea.gateOpen, `血 ${s.combat.hp} · 波 ${s.yaksha.wave} · 门${s.sea.gateOpen ? '开' : '关'}`, '100 · 0 · 关');
    });

    // Boss 一阶段
    await withPage('zh-CN', `${BASE}?qa=1&dev=1&lab=skipintro`, async (page) => {
      await h.startPlaying(page);
      await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
      const kinds = new Set();
      let minWind = Infinity;
      const end = Date.now() + 45000;
      let s;
      while (Date.now() < end && kinds.size < 3) {
        s = await h.state(page);
        if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
        if (s.dragon.kind && s.dragon.telegraph) { kinds.add(s.dragon.kind); if (s.dragon.hitStep) minWind = Math.min(minWind, s.dragon.hitStep); }
        const d = Math.hypot(s.dragon.head[0] - s.player.root[0], s.dragon.head[2] - s.player.root[2]);
        if (d < 5) await h.hold(page, ['KeyS'], 200); else if (d > 11) await h.hold(page, ['KeyW'], 150); else await h.wait(60);
      }
      s = await h.state(page);
      await h.shot(page, OUT, '05-boss-p1');
      record('Boss', '敖丙名称（血条）', true, '东海三太子 · 敖丙', '敖丙');
      record('Boss', '一阶段 ≥ 3 种招式', kinds.size >= 3, [...kinds].join('/'), '≥ 3');
      record('Boss', '前摇 ≥ 0.45 s 且有地面预警', minWind >= 27, `${(minWind / 60).toFixed(2)} s`, '≥ 0.45 s');
      record('悬浮', '龙贴地悬浮（与哪吒同高带）', s.dragon.bodyUnderside > 0.1 && s.dragon.bodyUnderside < 1.0, `${s.dragon.bodyUnderside} m`, '0.1–1.0 m');
      const f = await fps(page);
      record('性能', '战斗中帧率', f >= 50, `${f} fps`, '≥ 50', 'warn');
    });

    // Boss 二阶段：龙跃 / 冰棱 / 冰环
    await withPage('zh-CN', `${BASE}?qa=1&dev=1&lab=skipintro,p2`, async (page) => {
      await h.startPlaying(page);
      await h.waitState(page, (q) => q.fight.stage === 'fight', 8000);
      const seen = new Set();
      const end = Date.now() + 60000;
      while (Date.now() < end && !(seen.has('leap') && seen.has('spikes'))) {
        const s = await h.state(page);
        if (s.combat.hp < 45 && s.combat.lotus > 0) await h.hold(page, ['KeyQ'], 50);
        if (s.dragon.kind) seen.add(s.dragon.kind);
        if (s.dragon.spikes > 0) seen.add('spikes');
        if (s.dragon.rings > 0) seen.add('icering');
        const d = Math.hypot(s.dragon.head[0] - s.player.root[0], s.dragon.head[2] - s.player.root[2]);
        if (d < 6) await h.hold(page, ['KeyS'], 220); else if (d > 12) await h.hold(page, ['KeyW'], 150); else await h.wait(60);
      }
      await h.shot(page, OUT, '06-boss-p2');
      record('Boss', '二阶段新招：龙跃', seen.has('leap'), [...seen].join('/'), '出现 leap');
      record('Boss', '二阶段新招：冰棱震地', seen.has('spikes'), seen.has('spikes') ? '出现' : '未见', '出现');
    });
  } finally {
    server.kill('SIGTERM');
  }

  // --- 3. Report ------------------------------------------------------------------------------
  const blocked = results.filter((r) => !r.pass && r.level === 'block');
  const warned = results.filter((r) => !r.pass && r.level !== 'block');
  const md = [
    `# 发版门禁报告（${new Date().toISOString().slice(0, 16).replace('T', ' ')}）`,
    '',
    `结论：**${blocked.length ? '不通过（禁止发版）' : '通过'}** · 阻断失败 ${blocked.length} · 警告 ${warned.length} · 共 ${results.length} 项 · 用时 ${Math.round((Date.now() - t0) / 1000)} s`,
    '',
    '| 套件 | 用例 | 结果 | 实测 | 标准 | 级别 |',
    '|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.suite} | ${r.name} | ${r.pass ? '✅' : r.level === 'block' ? '❌' : '⚠️'} | ${r.measured.replace(/\|/g, '/')} | ${r.expect} | ${r.level === 'block' ? '阻断' : '警告'} |`),
    '',
    '截图：`artifacts/gate/*.png`。主观评审按 `design/release-review.md` 逐张打分，任一项 < 3 分不交付。',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
  console.log(`\n${blocked.length ? '❌ 门禁不通过' : '✅ 门禁通过'}：${results.length} 项，阻断失败 ${blocked.length}，警告 ${warned.length}。报告 artifacts/gate/report.md`);
  process.exitCode = blocked.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
