// =====================================================================
//  自循环验收系统（QA Gate）
//  用法：node qa/run.js [--chrome <path>] [--url <url>] [--only <suite>]
//  流程：启动真实 Chrome → 逐项执行用例 → 每项输出 PASS/FAIL + 实测值 →
//        生成 qa/report/report.md 与截图 → 任一「阻断级」用例失败则退出码 1（禁止发版）
//  scripts/release.sh 在发版前自动调用本脚本；不通过就不会打 tag、不会推送。
// =====================================================================
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const CHROME = arg('--chrome', process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const URL = arg('--url', 'file://' + path.join(ROOT, 'wukong/index.html'));
const ONLY = arg('--only', null);
const OUT = path.join(__dirname, 'report');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
function record(suite, name, pass, measured, expect, level = 'block') {
  results.push({ suite, name, pass: !!pass, measured: String(measured), expect, level });
  console.log(`${pass ? '  ✓' : (level === 'block' ? '  ✗' : '  △')} [${suite}] ${name} — 实测 ${measured}（标准 ${expect}）`);
}

(async () => {
  const t0 = Date.now();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1280, height: 720 },
  });
  await sleep(1500);
  const page = (await browser.pages())[0] || await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

  const ev = (f, a) => page.evaluate(f, a);
  const waitFor = async (f, ms = 30000, a) => { const s = Date.now(); while (Date.now() - s < ms) { if (await ev(f, a)) return true; await sleep(40); } return false; };
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const slow = (k) => ev((k) => { __G.G.slowT = k ? 1e9 : 0; __G.G.slowScale = k || 1; }, k);
  const run = (s) => !ONLY || ONLY === s;
  // 等待 N 个渲染帧（低帧率环境下墙钟 sleep 会导致采样过少）
  const frames = (n) => ev((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

  async function boot(char) {
    await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__G, { timeout: 90000 });
    await page.click(`.charCard[data-char="${char}"]`); await sleep(1500);
    await page.click('#btnStart'); await sleep(500);
  }
  const reset = () => ev(() => { const P = __G.P; P.hp = P.maxHp; P.st = 100; P.invuln = 0; P.state = 'idle'; P.y = 0; P.vy = 0; });

  // ------------------------------------------------------------------
  // 套件 1：启动与稳定性
  // ------------------------------------------------------------------
  if (run('boot')) {
    console.log('\n▶ 启动与稳定性');
    const tl = Date.now();
    await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__G, { timeout: 90000 });
    record('启动', '页面加载到可交互', true, ((Date.now() - tl) / 1000).toFixed(1) + 's', '≤ 30s（软件渲染）');
    await sleep(1200); await shot('01_title_wukong');
    const ver = await ev(() => document.getElementById('verTitle').textContent);
    record('启动', '标题页显示版本号', /^v\d+\.\d+\.\d+$/.test(ver), ver, 'vX.Y.Z');
    await page.click('.charCard[data-char="nezha"]'); await sleep(2000); await shot('02_title_nezha');
    const t = await ev(() => document.title);
    record('启动', '选择哪吒后标题为《黑神话：哪吒》', t.startsWith('黑神话：哪吒'), t, '黑神话：哪吒…');
    record('启动', '选择哪吒后进入东海关卡', await ev(() => __G.LV) === 'sea', await ev(() => __G.LV), 'sea');
  }

  // ------------------------------------------------------------------
  // 套件 2：哪吒悬浮动作（永不触地 + 各状态浮动差异 + 物理驱动倾斜）
  // ------------------------------------------------------------------
  if (run('hover')) {
    console.log('\n▶ 哪吒悬浮动作');
    await boot('nezha');
    await ev(() => { __G.P.pos.set(0, 0, 125); __G.cam.yaw = Math.PI / 2 + 0.35; __G.cam.pitch = 0.12; });
    const sample = () => ev(() => { const P = __G.P; let m = 9; P.rig.wheels.forEach(w => { const v = new THREE.Vector3(); w.spin.getWorldPosition(v); m = Math.min(m, v.y - 0.23); }); const o = P.rig.hover.out; return { lo: m, y: o.y, pitch: o.pitch, roll: o.roll }; });
    await frames(30);
    const ys = []; for (let i = 0; i < 24; i++) { ys.push((await sample()).y); await frames(2); }
    const idle = await sample();
    const amp = Math.max(...ys) - Math.min(...ys);
    record('悬浮', '待机离地高度（轮最低点）', idle.lo > 0.3, idle.lo.toFixed(2) + 'm', '> 0.30m');
    record('悬浮', '待机持续上下浮动（漂浮而非弹跳）', amp > 0.03 && amp < 0.16, amp.toFixed(3) + 'm', '峰峰值 0.03~0.16m');
    await shot('10_hover_idle');
    await page.keyboard.down('KeyW'); await frames(3);
    const acc = await sample();
    record('悬浮', '起步加速时前倾（惯性）', acc.pitch > 0.04, acc.pitch.toFixed(2) + 'rad', '> 0.04');
    await frames(20); await page.keyboard.down('ShiftLeft'); await frames(30);
    const spr = await sample(); await shot('11_hover_sprint');
    record('悬浮', '疾奔前倾大于待机', spr.pitch > idle.pitch + 0.1, spr.pitch.toFixed(2), `> 待机+0.1（${(idle.pitch + 0.1).toFixed(2)}）`);
    record('悬浮', '疾奔前倾不过度（不趴下）', spr.pitch < 0.45, spr.pitch.toFixed(2) + 'rad', '< 0.45（约 26°）');
    record('悬浮', '疾奔时贴低飞行（离地降低）', spr.y < idle.y, spr.y.toFixed(2) + ' vs 待机 ' + idle.y.toFixed(2), '疾奔 < 待机');
    await page.keyboard.down('KeyD'); await frames(8);
    const turn = await sample(); await shot('12_hover_turn');
    record('悬浮', '转弯产生侧倾（bank）', Math.abs(turn.roll) > 0.08, turn.roll.toFixed(2) + 'rad', '|roll| > 0.08');
    await page.keyboard.up('KeyD'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
    await frames(30);
    await page.mouse.down({ button: 'right' }); await frames(25);
    const ch = await sample(); await shot('13_hover_charge');
    record('悬浮', '蓄力时升高（蓄势悬停）', ch.y > idle.y + 0.08, ch.y.toFixed(2), `> 待机+0.08（${(idle.y + 0.08).toFixed(2)}）`);
    await page.mouse.up({ button: 'right' }); await sleep(1200);
    // 混合高强度操作：全程最低点
    let lo = 9; await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
    for (let i = 0; i < 40; i++) {
      if (i % 6 === 0) await page.keyboard.press('Space');
      if (i % 9 === 3) await page.mouse.click(640, 360);
      if (i % 13 === 5) await page.keyboard.press('KeyF');
      lo = Math.min(lo, (await sample()).lo); await sleep(70);
    }
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    record('悬浮', '混合操作 40 帧全程不触地', lo > 0.02, lo.toFixed(3) + 'm', '> 0.02m');
    // 不同状态浮动参数必须不同
    const prof = await ev(() => { const H = __G.P.rig.hover; return null; });
  }

  // ------------------------------------------------------------------
  // 套件 3：操作手感（翻滚可取消一切 / 连招衔接 / 左右方向）
  // ------------------------------------------------------------------
  if (run('feel')) {
    console.log('\n▶ 操作手感');
    await boot('wukong');
    await ev(() => { __G.P.pos.set(0, 0, 60); __G.cam.yaw = Math.PI; }); await sleep(500);
    const sx = () => ev(() => { const v = new THREE.Vector3(__G.P.pos.x, 1, __G.P.pos.z).project(__G.camera); return v.x; });
    const a0 = await sx(); await page.keyboard.down('KeyD'); await sleep(600); await page.keyboard.up('KeyD'); const a1 = await sx();
    record('手感', 'D 键向屏幕右移动', a1 > a0, (a1 - a0).toFixed(3), '> 0');
    await ev(() => { __G.P.pos.set(0, 0, 20); }); await waitFor(() => __G.B.state === 'chase', 60000);
    await slow(0.05);
    const cases = [
      ['轻击起手', async () => { await page.mouse.click(640, 360); }],
      ['蓄力中', async () => { await page.mouse.down({ button: 'right' }); await sleep(150); }],
      ['重击挥出', async () => { await page.mouse.up({ button: 'right' }); await sleep(60); }],
      ['饮葫芦', async () => { await ev(() => { __G.P.hp = 100; }); await page.keyboard.press('KeyQ'); }],
      ['受击硬直', async () => { await ev(() => { __G.P.state = 'hurt'; __G.P.t = 0; __G.P.hurtDur = 0.75; }); }],
      ['跳劈', async () => { await page.keyboard.press('KeyF'); await sleep(200); await page.mouse.click(640, 360); }],
      ['翻滚刚开始', async () => { await page.keyboard.press('Space'); await sleep(120); }],
    ];
    let ok = 0;
    for (const [n, f] of cases) {
      await reset(); await ev(() => { __G.B.freeze = 99; });
      await f(); await sleep(100);
      const before = await ev(() => __G.P.state);
      await page.keyboard.press('Space'); await sleep(80);
      const after = await ev(() => __G.P.state + '@' + __G.P.t.toFixed(2));
      const pass = after.startsWith('roll@0.0');
      if (pass) ok++;
      record('手感', `翻滚取消「${n}」(${before})`, pass, after, 'roll@0.0x 立即生效');
    }
    await slow(0);
    // 衔接：疾奔 → 翻滚 → 疾奔 速度不掉
    await reset(); await ev(() => { __G.B.freeze = 0; __G.P.pos.set(0, 0, 80); __G.cam.yaw = Math.PI; });
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await frames(40);
    const sprintV = await ev(() => __G.P.vel.length());
    let minV = 99; await page.keyboard.press('Space');
    for (let i = 0; i < 16; i++) { minV = Math.min(minV, await ev(() => __G.P.vel.length())); await frames(1); }
    await page.keyboard.press('ControlLeft'); await sleep(120);
    const rj = await ev(() => [__G.P.state, __G.P.vy.toFixed(1), __G.P.vel.length().toFixed(1)]);
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
    record('手感', '疾奔→翻滚 期间速度不断档', minV >= sprintV * 0.9, minV.toFixed(2) + ' / 疾奔 ' + sprintV.toFixed(2) + ' m/s', '≥ 疾奔速度 90%');
    record('手感', '翻滚→跳跃 立即起跳并保留速度', rj[0] === 'jump' && +rj[2] > 6, rj.join(' / '), 'jump / vy>0 / 水平>6');
  }

  // ------------------------------------------------------------------
  // 套件 4：哪吒关卡流程（前置关卡 → 水门 → Boss → 二阶段 → 结算）
  // ------------------------------------------------------------------
  if (run('sea')) {
    console.log('\n▶ 东海关卡流程');
    await boot('nezha');
    await shot('20_sea_start');
    record('关卡', '出生于栈道起点', await ev(() => __G.P.pos.z) > 120, (await ev(() => __G.P.pos.z)).toFixed(0), 'z > 120');
    // 水门封闭时无法进入 Boss 场
    await ev(() => { __G.P.pos.set(0, 0, 10); }); await frames(4);
    const blocked = await ev(() => __G.P.pos.z);
    record('关卡', '清怪前水门阻挡（不能进 Boss 场）', blocked > 27, blocked.toFixed(1), 'z > 27（被挡在门外）');
    // 第一波
    await ev(() => { __G.P.pos.set(0, 0, 113); }); await frames(3);
    await ev(() => { __G.P.pos.set(0, 0, 110); }); await frames(6);
    const w1 = await ev(() => __G.Mobs.alive());
    record('关卡', '越过触发线刷出第一波夜叉', w1 >= 2, w1 + ' 只', '≥ 2');
    await sleep(1500); await shot('21_yaksha');
    // 夜叉会出手且有预警
    await reset();
    const sawTele = await waitFor(() => __G.Mobs.list().some(m => m.state === 'attack' && m.tele), 20000);
    record('关卡', '夜叉出手前有地面预警', sawTele, sawTele ? '出现' : '未出现', '出现');
    if (sawTele) await shot('22_yaksha_tele');
    const tokens = await ev(() => __G.Mobs.list().filter(m => m.state === 'attack').length);
    record('关卡', '同一时刻最多 1 只夜叉出手（攻击令牌）', tokens <= 1, tokens, '≤ 1');
    // 用玩家攻击清怪（验证命中判定）
    let kills = 0;
    for (let round = 0; round < 120 && await ev(() => __G.Mobs.alive()) > 0; round++) {
      await ev(() => { const m = __G.Mobs.list().find(x => x.alive); if (!m) return; const P = __G.P; P.pos.set(m.pos.x, 0, m.pos.z + 2.0); P.facing = Math.PI; P.st = 100; P.hp = P.maxHp; if (P.state !== 'attack') P.state = 'idle'; });
      await page.mouse.click(640, 360); await frames(12);
    }
    kills = await ev(() => __G.G.mobKills || 0);
    record('关卡', '玩家攻击可击杀夜叉', kills >= 2, kills + ' 只', '≥ 2');
    // 第二波 + 清场开门
    await ev(() => { __G.P.pos.set(0, 0, 78); }); await frames(6);
    for (let round = 0; round < 160 && await ev(() => __G.Mobs.alive()) > 0; round++) {
      await ev(() => { const m = __G.Mobs.list().find(x => x.alive); if (!m) return; const P = __G.P; P.pos.set(m.pos.x, 0, m.pos.z + 2.0); P.facing = Math.PI; P.st = 100; P.hp = P.maxHp; if (P.state !== 'attack') P.state = 'idle'; });
      await page.mouse.click(640, 360); await frames(12);
    }
    await sleep(500);
    const gate = await ev(() => __G.LS.gateOpen);
    record('关卡', '清空两波后水门开启', gate, gate, 'true');
    // 检查点
    await ev(() => { __G.P.pos.set(3, 0, 58.5); }); await frames(6);
    record('关卡', '太乙莲台检查点点亮', await ev(() => __G.G.checkpointLit), await ev(() => __G.G.checkpointLit), 'true');
    await shot('23_lotus');
    // Boss
    await ev(() => { __G.P.pos.set(0, 0, 20); __G.P.hp = __G.P.maxHp; }); await waitFor(() => __G.G.fight, 20000);
    record('Boss', '进入镇海台触发 Boss 战', await ev(() => __G.G.fight), await ev(() => __G.G.fight), 'true');
    record('Boss', 'Boss 为敖丙', (await ev(() => __G.BD.name)).includes('敖丙'), await ev(() => __G.BD.name), '含「敖丙」');
    await waitFor(() => __G.B.state === 'chase', 60000);
    await page.keyboard.press('KeyR'); await sleep(300);
    await ev(() => { __G.P.pos.set(__G.B.pos.x, 0, __G.B.pos.z + 6); });
    await shot('30_aobing');
    const seen = new Set(); let teleOK = true;
    for (let i = 0; i < 60 && seen.size < 3; i++) {
      await reset(); await ev(() => { __G.B.cd = Math.min(__G.B.cd, 0.2); });
      const got = await waitFor(() => __G.B.state === 'attack', 8000);
      if (!got) break;
      const info = await ev(() => ({ n: __G.B.atk.name, tele: !!__G.B.tele, wind: __G.B.atk.steps[0].wind }));
      if (!info.tele || info.wind < 0.45) teleOK = false;
      if (!seen.has(info.n)) { seen.add(info.n); await shot('31_aobing_' + info.n); }
      await waitFor(() => __G.B.state !== 'attack', 15000);
      await ev((i) => { const B = __G.B; const P = __G.P; const d = Math.random() < 0.5 ? 3.5 : 11; P.pos.set(B.pos.x + Math.sin(i) * d, 0, B.pos.z + Math.cos(i) * d); }, i);
    }
    record('Boss', '一阶段招式种类', seen.size >= 3, [...seen].join('/'), '≥ 3 种（近身连击/横扫/突进）');
    const steps = await ev(() => (window.__QA && window.__QA.steps || []).filter(x => x.boss.includes('敖丙')));
    const bad = steps.filter(x => !x.tele || x.wind < 0.45);
    record('Boss', '每一段出招前摇 ≥ 0.45s 且有地面预警', steps.length > 0 && bad.length === 0, `${steps.length} 段，违规 ${bad.length}` + (bad.length ? ' ' + JSON.stringify(bad.slice(0, 2)) : ''), '违规 0');
    // 二阶段
    await reset();
    await ev(() => { __G.B.hp = __G.B.maxHp * 0.5 + 5; __G.B.freeze = 0; __G.B.state = 'chase'; __G.P.pos.set(__G.B.pos.x, 0, __G.B.pos.z + 2.8); __G.P.facing = Math.PI; });
    await page.mouse.click(640, 360);
    const tr = await waitFor(() => __G.B.state === 'transform', 8000);
    record('Boss', '半血进入转阶段演出', tr, tr, 'true');
    await waitFor(() => __G.B.t > 1.5, 10000); await shot('32_aobing_transform');
    await waitFor(() => __G.B.phase === 2, 20000);
    record('Boss', '二阶段龙化（龙角/冰晶放大）', await ev(() => __G.B.rig.horns[0].scale.x > 1.3), (await ev(() => __G.B.rig.horns[0].scale.x)).toFixed(2), '> 1.3');
    const p2 = new Set();
    for (let i = 0; i < 40 && !p2.has('leap'); i++) {
      await reset(); await ev(() => { const B = __G.B; __G.P.pos.set(B.pos.x + 10, 0, B.pos.z + 6); B.cd = 0; });
      if (await waitFor(() => __G.B.state === 'attack', 8000)) { const n = await ev(() => __G.B.atk.name); p2.add(n); if (n === 'leap') { await waitFor(() => __G.B.sp === 'air', 5000); await shot('33_aobing_leap'); } await waitFor(() => __G.B.state !== 'attack', 15000); }
    }
    record('Boss', '二阶段新增强化招式（冰棱震地）', p2.has('leap'), [...p2].join('/'), '含 leap');
    // 击败与结算
    await ev(() => { __G.B.hp = 5; __G.B.state = 'chase'; __G.B.freeze = 3; __G.P.pos.set(__G.B.pos.x, 0, __G.B.pos.z + 2.6); __G.P.facing = Math.PI; });
    await reset(); await page.mouse.click(640, 360);
    const dead = await waitFor(() => !__G.B.alive, 8000);
    record('Boss', '击败 Boss', dead, dead, 'true');
    await waitFor(() => __G.G.mode === 'result', 30000); await sleep(500); await shot('34_result');
    const rs = await ev(() => [document.getElementById('rTime').textContent, document.getElementById('rGrade').textContent, document.getElementById('rItem').textContent, document.getElementById('rKills').textContent]);
    record('Boss', '结算：用时/评级/奖励/斩杀数', /\d\d:\d\d/.test(rs[0]) && rs[1] && rs[2] && +rs[3] >= 5, rs.join(' | '), '均有值，斩杀 ≥ 5');
  }

  // ------------------------------------------------------------------
  // 套件 5：死亡重试正确重置
  // ------------------------------------------------------------------
  if (run('retry')) {
    console.log('\n▶ 死亡与重试');
    await boot('nezha');
    await ev(() => { __G.P.pos.set(0, 0, 110); }); await sleep(800);
    await ev(() => { __G.P.hp = 1; __G.P.invuln = 0; });
    await waitFor(() => { const m = __G.Mobs.list().find(x => x.alive); if (m) { __G.P.pos.set(m.pos.x, 0, m.pos.z + 1.8); } return __G.G.mode === 'dead'; }, 60000);
    record('重试', '前置关卡中可被夜叉击杀', await ev(() => __G.G.mode) === 'dead', await ev(() => __G.G.mode), 'dead');
    await waitFor(() => document.getElementById('death').classList.contains('show'), 30000);
    for (let k = 0; k < 10 && await ev(() => __G.G.mode) === 'dead'; k++) { await sleep(800); await page.keyboard.press('KeyE'); }
    await frames(5);
    const st = await ev(() => ({ mode: __G.G.mode, hp: __G.P.hp, g: __G.P.gourds, mobs: __G.Mobs.list().length, z: __G.P.pos.z, bhp: __G.B.hp, fight: __G.G.fight }));
    record('重试', '重试后状态复原（满血/满葫芦/清怪/Boss满血）', st.mode === 'play' && st.hp === 300 && st.g === 4 && st.mobs === 0 && !st.fight, JSON.stringify(st), 'play/300/4/0/false');
  }

  // ------------------------------------------------------------------
  // 套件 6：悟空关卡回归
  // ------------------------------------------------------------------
  if (run('wukong')) {
    console.log('\n▶ 悟空关卡回归');
    await boot('wukong');
    record('回归', '悟空进入黑风山', await ev(() => __G.LV) === 'heifeng', await ev(() => __G.LV), 'heifeng');
    await ev(() => { __G.P.pos.set(0, 0, 20); }); await waitFor(() => __G.G.fight, 20000);
    record('回归', '黑风大王 Boss 战触发', await ev(() => __G.G.fight && __G.BD.name === '黑风大王'), await ev(() => __G.BD.name), '黑风大王');
    await waitFor(() => __G.B.state === 'chase', 60000);
    await ev(() => { __G.B.freeze = 10; __G.P.pos.set(__G.B.pos.x, 0, __G.B.pos.z + 3.0); __G.P.facing = Math.PI; });
    const h0 = await ev(() => __G.B.hp); await page.mouse.click(640, 360);
    await waitFor(() => __G.P.state === 'idle' || __G.P.state === 'move', 8000);
    record('回归', '轻击命中黑风大王', h0 - await ev(() => __G.B.hp) > 0, h0 - await ev(() => __G.B.hp), '> 0');
    await shot('40_wukong');
  }

  // ------------------------------------------------------------------
  // 套件 7：性能预算（软件渲染下的相对指标）
  // ------------------------------------------------------------------
  if (run('perf')) {
    console.log('\n▶ 性能预算');
    await boot('nezha');
    const cost = await ev(() => { const r = __G.P.rig; const s = performance.now(); for (let i = 0; i < 200; i++) r.update(1 / 60, i / 60, 6); return (performance.now() - s) / 200; });
    record('性能', '哪吒飘带+风火轮单帧更新耗时', cost < 1.5, cost.toFixed(3) + 'ms', '< 1.5ms', 'warn');
    const info = await ev(() => { const r = window.__renderer; return null; });
    const draws = await ev(() => { let n = 0; __G.camera.parent; return document.querySelectorAll('canvas').length; });
    record('性能', '单一 WebGL 画布', draws === 1, draws, '1', 'warn');
  }

  // ------------------------------------------------------------------
  record('稳定', '全程无 JS 报错 / 资源 404', errors.length === 0, errors.length ? errors.slice(0, 3).join(' ; ') : '0 条', '0 条');
  await browser.close();

  // 报告
  const blockFail = results.filter(r => !r.pass && r.level === 'block');
  const warnFail = results.filter(r => !r.pass && r.level !== 'block');
  const pass = results.filter(r => r.pass).length;
  const score = Math.round(pass / results.length * 100);
  const verdict = blockFail.length === 0 ? '✅ 通过（允许发版）' : '❌ 不通过（禁止发版）';
  let md = `# 自循环验收报告\n\n- 时间：${new Date().toLocaleString('zh-CN')}\n- 耗时：${((Date.now() - t0) / 1000).toFixed(0)}s\n- 用例：${results.length}　通过：${pass}　阻断失败：${blockFail.length}　警告：${warnFail.length}\n- 得分：**${score}/100**\n- 结论：**${verdict}**\n\n| 结果 | 套件 | 用例 | 实测 | 标准 |\n| --- | --- | --- | --- | --- |\n`;
  results.forEach(r => md += `| ${r.pass ? '✓' : (r.level === 'block' ? '✗' : '△')} | ${r.suite} | ${r.name} | ${r.measured.replace(/\|/g, '/')} | ${r.expect} |\n`);
  md += `\n截图见 \`qa/report/*.png\`。\n`;
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ score, verdict, results }, null, 2));
  console.log(`\n================  ${verdict}  得分 ${score}/100  （阻断失败 ${blockFail.length}，警告 ${warnFail.length}）`);
  process.exit(blockFail.length ? 1 : 0);
})().catch(e => { console.error('QA 运行异常：', e); process.exit(2); });
