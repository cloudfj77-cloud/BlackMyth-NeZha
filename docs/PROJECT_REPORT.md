# 《白神话：哪吒》White Myth: Nezha · 项目总汇报（2026-11-07 节点）

> 节点版本：**v2.0.0**（天工引擎 ForgeAX 0.4.19 · WebGPU）。上一代是 **v1.4.0**（three.js r149 · WebGL），已归档在 `legacy/threejs-v1.4.0/`。
> 从这个节点起，项目统一用天工引擎开发。

---

## 一、最新进展（截至 11-07）

| 里程碑 | 内容 | 结论 |
|---|---|---|
| M1 场景与移动 | 灰盒场景、悬浮移动、镜头、遮挡淡化、双语菜单 | ✅ 14/15 通过（帧耗时并入 M5 实测） |
| M2 玩家战斗 | 连招、蓄力重击、翻滚 / 完美闪避、莲子、混天绫·缚、打击感 | ✅ 老板试玩通过 |
| M3 神龙 | 41 点脊柱长龙、三招、AI、预警 = 伤害区 | ✅ 老板试玩通过 |
| M4 完整一局 | 入场演出、转阶段、二阶段、战败重来、结算评级 | ✅ 老板通过 |
| v1.4.0 移植（3 批） | 关节哪吒、音乐音效、栈道 + 夜叉两波 + 莲台 + 水门 + 镇海台、敖丙全套招式、灵息、完美闪避、武器拖尾、回旋枪 | ✅ |
| 资产轨模型接入 | Blender 哪吒 v2、龙 v1 接进游戏；两者都带残影 | ✅ v0.6.0 |
| 收尾 | 龙眼发光、红缨大幅飘动、《只狼》式战斗界面、标题字号加大 | ✅ v0.6.1 |

当前可玩内容：标题（中英双语）→ 陈塘关海岸栈道 → 两波巡海夜叉 → 太乙莲台检查点 → 镇海水门 → 镇海台入场演出 → 空中对战东海三太子·敖丙（两个阶段）→ 结算 → 自由游览。

质量现状：单元测试 136 项全过；发版门禁 `node qa/gate.cjs` 30～31 项全过（构建、类型检查、单测，加上真实键鼠实机测关卡、重试、Boss、空战、性能、报错）；60 帧；控制台 0 报错。

---

## 二、总体计划

```
阶段 A 设计（✅ 完成）   →   阶段 B 开发 M1→M5（M1–M4 ✅，M5 待开）   →   阶段 C 发布（⬜）
需求 · 角色会 · 变更会         每个里程碑：实现 → 构建 → 构建版里真键鼠验收            中英封面 → 造化发布检查
· 开工评审（老板拍板）          → 截图 + 报告 → 老板试玩 → 修改                       → 上传 → 分享链接
```

**下一步：M5「视听打磨与整合」**（开工前先开音频会和封面会）
1. 材质：给礁石、木板、龙鳞、哪吒加贴图或程序噪声（本轮主观评审里「材质」只得 2 分，是唯一不及格项）。
2. 模型：正式龙头（嘴里的结构、须和尾穗的骨骼）、哪吒加分指和贴图；甲裙、肩绫和手臂的穿插要修。
3. 音频会：BGM、预兆音效，台词用字幕还是配音。
4. 性能：在集成显卡上实测帧耗时（M1 第 11 条遗留）。
5. 发布：中英两版封面，造化平台发布检查与上传。

---

## 三、工作室视角（49 个 AI 角色）

工作室结构来自开源模板 **Claude Code Game Studios**（49 个专职 AI 角色，分三层：总监 / 部门主管 / 专员）。本项目没有把整套模板装进引擎工程，只按需调用角色。实际运转方式是三个窗口加 9 张角色卡：

| 窗口 | 相当于 | 负责 |
|---|---|---|
| 主窗口（总控） | 制作人 producer | 计划、跨轨协调、进度簿 `docs/studio/plan-and-progress.md` |
| 子窗口 1 · 玩法轨 | 程序部（lead / gameplay / engine / ui / tools programmer） | 天工工程全部代码、构建、实机验收 |
| 子窗口 2 · 资产轨 | 美术部（art director / technical artist / 建模） | 参考图、美术方向板、Blender 模型 |

开会时调用的角色卡（`docs/studio/agents/`）：创意总监、制作人、主策划（game-designer）、美术总监、叙事总监、QA 主管、本地化主管、技术美术、动画师。其余专员职能，比如关卡设计、系统设计、音效、性能分析，由这三条轨在执行中承担。

### 按职能分项

| 职能 | 由谁负责 | 做了什么 | 产出与格式 |
|---|---|---|---|
| **策划** | 主策划 + 创意总监 | 需求文档、10 节设计文档、M1–M4 定义与验收条目、所有数值（伤害、帧数、距离），每项由老板拍板 | Markdown：`docs/studio/milestones/*.md`、`meetings/*.md`；数值落到 `assets/data/tuning.json`（运行时可调，开发面板 F2） |
| **叙事** | 叙事总监 | 敖丙「奉命而来」方向；开场、转阶段、战败、倒下、胜利台词 | `meetings/2026-11-06-aobing-dialogue.md` → `assets/ui/menu.ui.i18n.json`（i18next 中 / 英）+ `assets/i18n/context.json`（给译者的语境） |
| **本地化** | 本地化主管 | 中英双语，中文版主要文字下带一行英文；字幕时间按英文长度定 | 同上；单测检查每行 ≤ 42 字、按钮 ≤ 16 字 |
| **美术方向** | 美术总监 | 美术方向板 v2：色板（龙身 #7FA295 / #587A6D / #25342E、预警冰青）、冷暖对立、剪影规则 | `art-direction-board.md / .html`；参考图库 `references/`（jpg / png） |
| **原画 / 概念** | 美术总监 + 资产轨 | 没有手绘原画，用参考图 + 方向板 + 规格单代替；龙头规格单冻结接口 | `assets-specs/dragon-head-spec.md`；参考图 `references/` |
| **角色（哪吒）** | 角色设计会 + 资产轨 | 15～16 岁少年、双丫髻、混天绫、火尖枪、风火轮；v2 枪长 4.8 m，红缨 24 缕 | Blender 生成脚本 `asset-review/nezha-blender-v2/build_nezha_v2.py` → `.blend` → `.glb` |
| **Boss（敖丙）** | 角色设计会 2 + 龙王重设计会 + 叙事 | 身份是东海三太子·敖丙，外形是 18 m 长龙；一阶段 3 招，二阶段「龙化·万龙甲」，破势 | Blender 脚本 `asset-review/dragon-blender-v1/build_dragon.py` → `.glb`；AI 与招式 `assets/dragon/aobing.ts` |
| **模型 / 资产** | 资产轨（技术美术） | 程序化建模、顶点色、蒙皮、导出、结构校验、渲染预览图和视频 | `.blend`、`.glb`（glTF 2.0 二进制）、`.png`、`.mp4`；进游戏前跑 `scripts/convert-asset-glb.py` |
| **动作 / 动态** | 动画师 + 玩法轨 | 姿态全部由代码实时驱动（见第四节）；资产轨也烘焙了 15 段动作，作参考和兜底 | `assets/nezha-rig/rig-def.ts`（姿态库）、`rig.pack.ts`（每帧驱动） |
| **绑骨** | 技术美术 | 哪吒 47 根骨，名字与代码关节一致；龙 62 根骨（40 节脊柱 + 头 / 颌 / 须 / 鬃） | glb 里的 skin（逆绑定矩阵）→ 引擎 Skin 组件；绑定数据 `assets/models/skins.ts` |
| **场景 / 关卡** | 玩法轨（关卡、世界设计职能） | 陈塘关海岸栈道 → 莲台 → 水门 → 镇海台；海面、漩涡、盘龙柱、远景龙宫 | 程序化网格 `assets/sea/sea-geometry.ts` + WGSL 着色器 + 场景包 `assets/scene.pack.ts` |
| **程序** | 玩法轨 | 21 个资源 / 插件包、约 1.5 万行 TypeScript、15 个 WGSL 着色器 | `assets/**/*.pack.ts`、`*.ts`、`shaders/*.wgsl` |
| **UI** | 玩法轨 + 美术总监 | 标题参考 Duelyst；战斗界面参考《只狼》 | `assets/ui/menu.ui.html / .css`（引擎 UI 编写规范）+ `menu-controller.ts` |
| **音频** | 玩法轨（v1.4.0 移植） | 合成音乐（探索 / 战斗 / 二阶段 / 胜利）和全部音效，没有音频文件 | `assets/ui/audio.ts`（WebAudio 合成）；音频会尚未开 |
| **QA** | QA 主管 | 每个里程碑一份验收报告；真键鼠实机；发版门禁 + 主观评审表 | `qa/*.cjs`（puppeteer）、`artifacts/*/report.md`、`docs/studio/release-review.md` |

---

## 四、动作、动态和绑骨是怎么实现的

1. **姿态库（来自 v1.4.0）**：v1.4.0 的每个动作是一组关节欧拉角关键帧，比如三段连斩 `L1a / L1b`、回旋枪 `L4a`、蓄力 `HC`、翻滚、受击、喝莲子、施法、跳劈，原样移植到 `rig-def.ts`。
2. **战斗状态机**（`combat/machine.ts`，纯逻辑，每秒 60 步）决定当前动作和帧号，rig 插件按「动作进度」在关键帧之间插值，再以 30/秒的速率平滑混合（v1.4.0 的手感）。
3. **悬浮层 HoverMotion**（v1.4.0 原样）：用弹簧阻尼算出离地高度、两种频率叠加的起伏、惯性前倾、转弯侧倾、骨盆滞后、头部预判和双摆腿；空战时再叠加 ±2 m、4.5 秒一周期的空中浮动。
4. **写到模型上**：每帧算出 18 个关节的四元数，同时写给资产轨模型里同名的骨骼。引擎的 **Skin 组件**用这些骨骼的世界矩阵乘以逆绑定矩阵，在 GPU 上完成蒙皮。风火轮骨骼每帧抵消腿弯、保持竖直，按速度旋转。
5. **次级动态**：两股红绫（12 节骨）和红缨（4 节骨）按速度往后拖、沿骨链传波浪、移动时大幅甩动；绕臂绫、腰绫和发带用 v1.4.0 的 Verlet 物理飘带。
6. **龙**：敖丙 AI（`aobing.ts`）每步算出一条 41 点、18 m 长的脊柱，受击判定、预警区和渲染都用这同一条线。40 节脊柱骨按弧长每 0.4 m 取一个点，用四元数朝向对齐；龙头骨转向 AI 给出的头方向，下颌在出招前张开。
7. **残影**：在 CPU 上按当时的骨骼姿态算出一份模型（CPU 蒙皮），10 份或 8 份合进一个网格，只占一次绘制。哪吒走路时留浅色、翻滚时留深色；龙游动时留浅色、出招时留深冰蓝。
8. **资产轨烘焙的 15 段动作**目前不播放，只作参考和对齐基准。动作全部由代码驱动，这样判定、预警和动作永远同步，手感参数也能实时调。

---

## 五、场景是怎么做的

- 全部程序化生成，没有外部场景文件。`sea-geometry.ts` 用引擎的网格构建器 MeshKit，按 v1.4.0 的布局缩放 0.86 倍搭出：栈道木板、栏杆、牌坊和「陈塘关」匾、太乙莲台、镇海水门、镇海台石鼓与栏杆、盘龙柱、远景龙宫与海蚀柱。
- 着色器（WGSL）负责海面（Gerstner 波，从 v1.4.0 移植）、镇海台中间一人深的海漩涡（螺旋浪花，一直在转）、冰环与水墙、光柱、遮挡淡化、红绫、风火轮火、残影、武器拖尾。
- 物理用引擎自带的 Rapier：角色控制器配胶囊体、地面和栏杆碰撞体；水门关着时挡路，清完夜叉才打开。
- 光照：方向光加天光、雾，战斗时的光照档位、风火轮与龙眼的点光源。

---

## 六、格式迁移对照（迁移前 → 迁移后）

| 东西 | 迁移前 v1.4.0（three.js） | 迁移后 v2.0.0（天工引擎） |
|---|---|---|
| 引擎 / 渲染 | three.js r149，WebGL，一个 `three.min.js` 全局脚本 | ForgeAX 0.4.19，WebGPU；引擎在 Worker 里跑（ECS + 插件） |
| 工程形态 | `wukong/index.html` + 6 个 `.js`（约 4000 行），不用构建，直接打开 | pnpm 工程；`assets/**/*.pack.ts` 资源 / 插件包（21 个）+ `*.ts` 逻辑（约 1.5 万行）；`forgeax project build` 打包成 `dist/` |
| 角色模型 | 代码里用 three.js 基本体（球、胶囊、圆环、盒子）拼成关节层级，没有外部模型 | ① 先移植成代码关节模型（`rig-def.ts` → MeshKit 网格）；② 现在用 Blender `.glb`：glTF 2.0 二进制，顶点色 COLOR_0 + 蒙皮 JOINTS_0 / WEIGHTS_0 + 逆绑定矩阵 |
| 资产导入 | 无 | `scripts/convert-asset-glb.py`：去掉 glb 材质，发光写进顶点色透明通道 → `forgeax asset import` 生成 `.glb.meta.json`（子资源 GUID：mesh / skeleton / skin / scene / 动作）→ 打包时烘焙进包缓存 → 运行时按 GUID 加载 |
| 材质 / 着色器 | three.js 材质 + GLSL 片段（ShaderMaterial） | `materials.pack.ts` 里的 Materials.standard / unlit + 15 个 WGSL Surface 模块；蒙皮版本走 `forgeax::pbr-skin` |
| 动作 | 关节欧拉角关键帧 + 弹簧悬浮，直接改 Object3D 旋转 | 同一套姿态数据转成四元数写到骨骼实体（Transform 组件），引擎 Skin 组件做 GPU 蒙皮 |
| 飘带 | Verlet 飘带，three.js BufferGeometry | 同算法，`ribbons.ts` 纯逻辑，写进一个共享网格（一次绘制） |
| 关卡 / 场景 | `sea.js` / `world.js` 代码生成 | `sea-geometry.ts`（MeshKit）+ `scene.pack.ts`（场景实体、碰撞体） |
| 战斗与 AI | 写在 `game.js` 一个大循环里，按秒推进 | 纯逻辑模块（`combat/machine.ts`、`dragon/aobing.ts`、`yaksha/*`、`fight/run.ts`），固定每秒 60 步，单测覆盖 |
| 数值 | 散在代码里 | `assets/data/tuning.json` + 调参范围表，F2 面板实时调 |
| UI / 文案 | HTML + CSS 写在 `index.html` 里，只有中文 | 引擎 UI 资源 `menu.ui.html / .css` + i18next 资源 `menu.ui.i18n.json`（中 / 英）+ 译者语境 `context.json` |
| 音频 | WebAudio 合成（`audio.js`） | 同算法移植进 `assets/ui/audio.ts`，按游戏事件触发 |
| 测试 / 发版 | `qa/run.js`（puppeteer 48 项）+ `scripts/release.sh` | vitest 单测 136 项 + `qa/gate.cjs`（真键鼠实机 30+ 项）+ `scripts/release.sh`（门禁不过不发版）+ 主观评审表 |
| 在线版本 | GitHub Pages 直接托管 `wukong/` | GitHub Pages 托管构建好的 `site/`（`--base /WhiteMyth-NeZha/`）；旧版仍可在 `site/legacy/` 玩 |

---

## 七、仓库结构（v2.0.0）

```
WhiteMyth-NeZha/
├─ assets/              天工引擎工程：资源 / 插件包、逻辑、着色器、UI、数值、模型（models/*.glb）
├─ qa/                  实机验收与发版门禁（gate.cjs）
├─ scripts/             构建、发版、glb 转换、Pages 构建
├─ site/                GitHub Pages 发布内容（构建产物 + legacy 旧版）
├─ docs/
│  ├─ PROJECT_REPORT.md 本汇报
│  └─ studio/           设计资料：进度簿、设计会纪要、里程碑、角色卡、美术方向板、参考图、资产评审（Blender 源文件）
├─ legacy/threejs-v1.4.0/  three.js 版完整归档（源码、旧 QA、旧文档）
├─ skills/  vendor/  web/  天工模板自带：引擎技能文档、造化 SDK、启动画面
└─ README.md  CHANGELOG.md  VERSION
```
