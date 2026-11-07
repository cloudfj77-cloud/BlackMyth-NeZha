# 白神话：哪吒 · White Myth: Nezha

写实东方神话风格的 3D 第三人称动作 Boss 战网页游戏，中英双语，用电脑键鼠操作。
A realistic Eastern-myth 3D third-person action boss fight for the web, bilingual (中文 / English), keyboard and mouse.

- **在线游玩 Play**：https://cloudfj77-cloud.github.io/WhiteMyth-NeZha/
- **旧版 three.js v1.4.0**：https://cloudfj77-cloud.github.io/WhiteMyth-NeZha/legacy/
- **引擎 Engine**：天工引擎 ForgeAX 0.4.19（TypeScript + WebGPU）；从 v2.0.0 起全部用天工引擎开发
- **项目总汇报 Report**：[docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md)

## 一局流程 / One run
陈塘关海岸栈道 → 两波巡海夜叉伏击 → 太乙莲台检查点 → 镇海水门 → 镇海台入场演出 → 空中对战 **东海三太子·敖丙**（一阶段：三段连斩、回旋横扫、突进；二阶段「龙化·万龙甲」：冰棱震地、寒潮连突、龙跃、冰环；破势）→ 结算评级 → 自由游览。

## 操作 / Controls
| 按键 Key | 作用 Action |
|---|---|
| W A S D | 悬浮移动 Hover move |
| Shift | 飞驰 Sprint |
| 鼠标 Mouse | 转镜头（先点一下画面锁定鼠标）Camera |
| 左键 LMB | 轻击，4 段连招，最后一段是回旋枪 Light combo (4th: spin) |
| 右键按住 RMB hold | 蓄力重击 Charged heavy |
| 空格 Space | 风火轮翻滚，卡在出招瞬间按是完美闪避 Roll / perfect dodge |
| F / Ctrl | 跳跃，空中左键是跳劈 Jump / plunge |
| R | 锁定 Lock on |
| Q | 服食莲子回血 Lotus seed (heal) |
| 1 | 混天绫·缚 Sash Bind |
| M | 静音 Mute |
| Enter | 跳过开场 / 再战 Skip / retry |
| Esc | 暂停 Pause |

## 开发 / Development
```bash
pnpm install                      # 天工引擎 0.4.19（锁定版本）
bash scripts/build.sh             # 构建 dist/
pnpm exec forgeax project preview --port 4191   # 本地预览 http://localhost:4191/
npx vitest run                    # 单元测试
node qa/gate.cjs                  # 发版门禁：构建 + 类型 + 单测 + 真实键鼠实机
scripts/release.sh minor "说明"   # 发版：门禁 → 升版本 → 更新日志 → Pages 站点 → 提交 → 推送 → 打标签
```
资产轨出新模型时：`python3 scripts/convert-asset-glb.py <源.glb> assets/models/<名>.glb`，然后 `pnpm exec forgeax asset import assets/models/<名>.glb --root .`。

## 目录 / Layout
| 路径 | 内容 |
|---|---|
| `assets/` | 天工引擎工程：资源与插件包 `*.pack.ts`、战斗 / AI 逻辑、WGSL 着色器、UI、数值 `data/tuning.json`、模型 `models/*.glb` |
| `qa/` | 真实键鼠实机验收脚本与发版门禁 |
| `site/` | GitHub Pages 发布内容（构建产物 + `legacy/` 旧版） |
| `docs/studio/` | 设计资料：进度簿、会议纪要、里程碑、AI 工作室角色卡、美术方向板、参考图、资产评审（Blender 源文件） |
| `legacy/threejs-v1.4.0/` | three.js 版完整归档 |

## 版本 / Versions
- **v2.0.0**（2026-11-07）：迁移到天工引擎，并把 v1.4.0 的全部内容移植过来；接入 Blender 正式模型；仓库更名为 WhiteMyth-NeZha。
- v1.0.0～v1.4.0：three.js 版（见 `legacy/threejs-v1.4.0/`）。
- 详见 [CHANGELOG.md](CHANGELOG.md)。
