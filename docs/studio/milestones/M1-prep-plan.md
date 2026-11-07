# M1 开发准备方案（玩法轨 · ✅ 老板 13:17 拍板：6 项全部按建议执行）

> 起草：子窗口 1 · 玩法轨，2026-11-05。依据：交接单 `design/handoffs/task1-m1-prep.md`、M1 定义 `design/milestones/M1-foundation.md`（已定稿）、设计文档、M1 开工评审实录、主策划补数发言 `design/meetings/2026-11-05-m1-prep-numbers.md`。
> 状态：✅ 老板 13:17 拍板「按建议来」，第 6 节 6 项均按建议执行，进入开发。按第 2 节顺序执行，每完成一个任务汇报一次并更新 `plan-and-progress.md`；阶段性产出（截图、预览、报告）随时在对话中同步展示，不阻塞进度。

---

## 0. 准备阶段发现的三件事（影响方案）

1. **已有一个旧版哪吒原型**：`/Users/cloud/WorkBuddy/2026-11-05-00-24-14/nezha-boss`（同为 0.4.19、game-3d 模板，旧设计：行走/奔跑、人形龙王，旧版 M1 34/34 验收通过）。其中有若干已在本机验证过的模块可以移植：关卡布局单一来源 `shared/layout.ts`、镜头射线拉近 `resolveBoom`、锁定数学 `lock-on.ts`、语言检测、带本地化加载画面的构建脚本 `scripts/build.sh` + `web/head.html`、puppeteer 验收库 `qa/lib.cjs`、`docs/feedback.md` 里的三条引擎坑。旧原型的移动、角色、龙王与新设计不符，不能整体复用。→ 见第 6 节决策 ①。
2. **镂空风险大幅下降**：0.4.19 渲染层内置 **Alpha Hash**（`Materials.standard({ ..., alphaHash: true })`），即抖动镂空。它走不透明队列、写深度、不需要透明排序，正好对应设计第 10 节「抖动镂空渐隐（仍走不透明通道）」。材质试验的重点从「能否做出来」变为「运行时能否逐物体改不透明度、阴影是否被一起镂空、描边能否叠加」。
3. **引擎能力已核对**：内置 i18next（UI 用 `*.ui.i18n.json`，i18next 格式），GPU 实例化、Scene Fog、Selection Outline（选择描边，可选开启）、弹簧骨骼、Ribbon 粒子都有。自定义 Surface 可输出 `opacity` / `alphaClipThreshold` / `emissive`。**未确认**：Surface 是否支持顶点位移（海草摆动），放进材质试验。

---

## 1. 工程方案

### 1.1 创建方式（按交接单，不变）
`game_builder_status`（root_uri=`file:///Users/cloud/WorkBuddy/2026-11-04-15-19-29/nezha-boss`，先建空目录）→ `game_builder_display_template_selection`（文字模式，**请老板确认引擎 forgeax/engine**）→ `game_builder_create_current_directory`（template_id=`forgeax/engine`，platform=`pc`，confirm_create）→ SDK `/usr/local/bin/node bin/forgeax.mjs project new <目录> --template game-3d` → 先读工程内 `AGENTS.md` → `mkdir -p vendor/zaohua-platform-sdk` 后安装造化 SDK。

### 1.2 Template Disposition（game-3d 模板处置表，开工第一步写入工程 README）

| 模板内容 | 处置 | 说明 |
|---|---|---|
| `forge.json`（roots: engine / frontend） | **保留** | 唯一插件入口；只改 id/name 为 nezha-boss |
| `assets/game.pack.ts`（引擎根） | **保留·改** | 挂 physics + world；去掉 vase 引用 |
| `assets/physics.pack.json`（Rapier） | **保留** | |
| `assets/world/world.pack.ts`（场景所有者） | **保留·改** | 子引用换成新插件 |
| `assets/scene.pack.ts` | **替换** | 内容换成龙宫灰盒；保留 `Player` / `Main Camera` 实体契约和「每个可见障碍都有静态 RigidBody+Collider」的规矩 |
| `assets/environment.pack.ts`（白天 HDR 天空） | **替换** | 改为深蓝水下环境光，冷色，无太阳天空 |
| `assets/geometry.pack.ts` | **替换** | 写法保留，网格换成灰盒几何 |
| `assets/materials.pack.ts` + `shaders/rusted-iron.wgsl` | **保留作试验基座 → 试验后删锈铁** | Surface 模块写法是材质试验的起点；新增冷色灰盒、橙金自发光、石柱 alphaHash、光束 additive 材质 |
| `assets/character.pack.ts` + `player/player-rig.ts`（骑士蒙皮+走路动画） | **替换** | M1 占位哪吒为刚性部件层级（身体、双丫髻、2.4 m 枪、两个风火轮），无骨骼、无走路动画 |
| `assets/player/player.ts`（行走/跳跃/奔跑） | **替换** | 改为悬浮控制器（见 hover-player） |
| `assets/player/player-input.ts` | **保留·改** | 保留键鼠快照采样；删跳跃、触屏；加 Shift 单击/按住判定、R 边沿 |
| `assets/camera/third-person.ts` | **保留·改** | 保留坐标轴、指针观察、俯仰钳制数学；加右肩偏移、射线拉近、最小距离、背墙上抬 |
| `assets/camera/camera.pack.ts` | **替换** | 保留指针锁定策略写法，逻辑重写 |
| `assets/fantasy-meshes.pack.ts` | **删除** | 展示品，连同场景引用、材质 key 一起删 |
| `assets/uv-primitives.pack.ts` + 测试 | **删除** | 确认无引用后删 |
| `assets/runtime-vase/*` + `ui/vase-controls.ts` | **删除** | 按 README 要求：world 引用、Pack、程序、UI 绑定一起删 |
| `assets/ui/player-controls.ts`（触屏摇杆） | **删除** | 平台为 PC 键鼠 |
| `assets/guide.ui.*` + `ui/guide-controller.ts` | **替换** | 改为开始/暂停菜单 UI（语言切换、操作说明），走 i18n |
| `assets/ui/ui.pack.ts`（前端根） | **保留·改** | 挂菜单、调试面板、造化 SDK、语言服务、QA 投影 |
| `assets/shared/scene-refs.ts` / `asset-refs.ts` | **保留·改** | |
| 测试：plugin-dependencies / plugin-cleanup | **保留** | 防插件泄漏 |
| 测试：starter / vase / uv / touch / temporal-alignment | **删除或改写** | 随对应内容 |
| `scripts/playthrough.mjs` | **替换** | M1 版，供老板终端 `project play` |
| `scripts/smoke-browser.mjs` / `smoke-dawn.mjs` / `localization-probe.mjs` | **保留·改** | |
| `scripts/mobile-controls-probe.mjs` / `runtime-vase-probe.mjs` | **删除** | |
| `docs/feedback.md` | **保留** | 先补入旧原型已确认的 3 条引擎坑 |
| `README.md` | **重写** | 本游戏的操作、处置表、构建验收命令 |

### 1.3 `assets/` 新插件划分

| 目录 | 运行域 | 职责 |
|---|---|---|
| `shared/` | 共用 | `layout.ts`（关卡布局唯一来源）、`tuning.ts`（参数结构与默认值校验）、`protocol.ts`（引擎↔前端消息）、`collision-groups.ts` |
| `data/tuning.json` | 共用 | 全部可调参数（第 3 节） |
| `hover-player/` | 引擎 | 根实体（运动学胶囊，贴海床）+ 模型子节点（抬高 0.3 m）；加减速、720°/s 转向、Shift 单击/按住；前倾；占位哪吒网格；**接触光**挂根节点 |
| `camera/` | 引擎 | 右肩镜头、球形射线拉近、最小距离、背墙上抬、锁定构图 |
| `lock-on/` | 引擎 | R 锁定/解除、25/30 m、环绕移动；**可调长条占位目标**（高 2～8 m、长 4～20 m） |
| `occlusion-fade/` | 引擎 | 石柱镂空渐隐（alphaHash 或兜底），描边（属镜头职责，单独成插件便于替换） |
| `arena-greybox/` | 引擎 | 峡道、广场、石柱、宫墙几何+碰撞；冷色灯光、深蓝距离雾、缓慢晃动的光束 |
| `ambient-float/` | 引擎 | 海草实例 3 组（峡道/广场边缘/远景）、悬浮颗粒，≤ 0.25 Hz 成片同向 |
| `float-fx/` | 引擎 | 哪吒程序化浮动（只作用模型子节点）+ 红绫（程序化条带 + 弹簧点链，两股） |
| `i18n/` | 前端 | 语言服务：浏览器检测、localStorage 记忆、pseudo、切换事件（转发给引擎侧）；语言表 `ui` / `terms` 两个命名空间 |
| `ui/` | 前端 | 前端根、开始/暂停菜单、语言切换 |
| `debug-panel/` | 前端（开发版） | 调参面板，打开即释放指针锁定；改值经端口下发到引擎 |
| `platform/` | 前端 | 造化 SDK initialize（capabilities 为空） |
| `telemetry/` | 引擎→前端 | 汇总各插件状态，`gameHost.gameProjection.registerRead({ id: 'nezha' })` |

工程外围：`qa/m1-acceptance.cjs` + `qa/lib.cjs`（puppeteer 驱动构建版预览）、`scripts/build.sh`（`--html-head web/head.html`，本地化加载画面）。

---

## 2. 开发任务拆解（按 M1 开发顺序；P 系列并行）

| # | 任务 | 产出 | 完成标志 |
|---|---|---|---|
| **T0** | 工程创建与模板处置 | 按 1.1 创建；按 1.2 删除/替换；造化 SDK 装好；tuning.json、telemetry、debug-panel 骨架 | `project check`、`pnpm test`、`typecheck`、`project build` 全绿；preview 打开后看到空灰盒地面；`registerRead('nezha')` 能读到 `ui.phase` |
| **T1** | 材质试验（半天，限时） | 试验报告 `artifacts/m1/experiments/report.md` + 截图。验证：① 石柱 alphaHash，运行时逐物体 1.0→0.35，0.2 s 渐变；② 阴影是否跟着镂空；③ 描边能否叠在镂空石柱上；④ Surface 能否做顶点位移（海草）；⑤ 橙金自发光在**关闭泛光**时仍可辨；⑥ 深蓝距离雾；⑦ 光束 additive；⑧ 接触光绘制层级（贴花层，低于预警）；⑨ 帧耗时与绘制调用的取数接口 | 每项给出「通过 / 走兜底」，镂空路线定为 A（alphaHash）或 B（兜底，见第 5 节），报老板 |
| **T2** | 角色控制器 + 占位哪吒 + 接触光 + 基础灰盒 | 根节点贴地运动学胶囊（0～1.9 m），模型子节点 +0.3 m；5 / 9 m/s，0.1 s 加速、0.15 s 停止，720°/s；Shift 按住 > 0.2 s 飞驰、单击 M1 不响应（预留闪身）；前倾 10° / 20°；占位哪吒 1.65 m、枪 2.4 m、双丫髻、风火轮三成亮度橙金自发光；接触光；峡道、广场、宫墙、石柱碰撞 | 单测覆盖运动学；preview 中 QA 投影读数满足过关第 1、2、4、7、8 条 |
| **T3** | 右肩镜头与射线拉近 | 右肩 0.6 m、焦点 1.6 m、自由 5.0 m、最小 1.2 m、背墙上抬；冷色灯光、深蓝雾、广场光束 | 过关第 5 条「贴墙」部分通过；峡道暗处截图 |
| **T4** | 浮动与红绫 + 环境浮动 | 哪吒浮动（±5 cm / 0.8 Hz + ±1.5° / 0.55 Hz，错相 90°，移动/飞驰递减）；红绫两股、自发光、向上飘、不过头顶；海草 480 株三组、颗粒 | 过关第 3、4 条；红绫不遮双丫髻（截图） |
| **T5** | 锁定 | R 锁定/解除、25 m 可锁 / 30 m 解除；锁定后 WASD 环绕/进退、面朝目标；锁定镜头 6.5 m / 焦点 1.8 m；长条目标尺寸调试面板可调 | 过关第 6 条（两端尺寸 × 12 角度） |
| **T6** | 镂空渐隐 | 按 T1 定的路线实现；描边；不遮挡哪吒火光 | 过关第 5 条「石柱」部分 + 截图评审第 13 条素材 |
| **P1** | 双语（与 T2～T6 并行） | 语言表（`区域.界面.用途` 键名，`terms` 命名空间，缺键回退英文）、首次跟随浏览器→之后读 localStorage、开始/暂停界面切换、pseudo（+30% 并加括号）、切换事件（引擎侧可收到）、加载画面本地化 | 过关第 9 条；刷新后语言保持 |
| **P2** | 造化 SDK（并行） | `platform/` 插件 initialize，capabilities 为空 | 控制台无报错；投影 `platform.initialized=true` |
| **P3** | 调试面板 + tuning.json + QA 投影（T0 搭骨架，各任务往里加） | 第 3 节全部参数可实时调；打开面板释放指针锁定；投影字段见 4.2 | 面板改移速后投影速度随之变化 |
| **T7** | 集成验收 | `scripts/build.sh` → `project preview --port 4190`（后台）→ `node qa/m1-acceptance.cjs` → `artifacts/m1/report.md` + 截图；请老板终端跑 `project play`；老板试玩 | 第 4 节 15 条全部有结论 |

每个任务结束：汇报一次（做了什么 / 证据 / 下一步），更新 `plan-and-progress.md`。

---

## 3. tuning.json 初始参数表

> 「锁定值」= 设计文档已定稿的数值，面板可调但默认值不改；「建议值」= 本方案提出，老板拍板即生效。

### 3.1 移动（hover-player）
| 键 | 默认 | 面板范围 | 来源 |
|---|---|---|---|
| `move.walkSpeed` | 5.0 m/s | 3～8 | 锁定 |
| `move.sprintSpeed` | 9.0 m/s | 6～14 | 锁定 |
| `move.accelTime` | 0.10 s（到满速） | 0.03～0.4 | 锁定 |
| `move.decelTime` | 0.15 s（停下，约滑行 0.4 m） | 0.05～0.5 | 锁定 |
| `move.turnRate` | 720 °/s | 360～1440 | 锁定 |
| `move.sprintHoldThreshold` | 0.20 s | 0.1～0.4 | 锁定 |
| `move.hoverHeight` | 0.30 m | 0.1～0.6 | 锁定 |
| `move.leanWalk` / `leanSprint` | 10° / 20° | 0～30 | 锁定 |
| `move.leanBlendTime` | 0.15 s | 0.05～0.4 | 建议 |
| `move.capsuleHeight` / `capsuleRadius` | 1.9 m / 0.35 m | — / 0.25～0.5 | 高度锁定、半径建议 |

### 3.2 镜头（camera，主策划建议值）
| 键 | 默认 | 范围 |
|---|---|---|
| `camera.shoulderOffset` | 0.6 m（右） | 0～1.0（锁定） |
| `camera.focusHeight` / `focusHeightLocked` | 1.6 / 1.8 m | 1.4～2.0 |
| `camera.distance` | 5.0 m（可一键切 5.4） | 4.0～6.0 |
| `camera.distanceLocked` | 6.5 m | 5.5～8.0 |
| `camera.minDistance` | **1.2 m（评审遗留数值）** | 1.0～1.6 |
| `camera.collisionMargin` | 0.3 m（球形投射） | 0.15～0.5 |
| `camera.wallLiftMax` | 1.05 m（背墙上抬） | 0～1.5 |
| `camera.fovY` | 55° | 50～65 |
| `camera.pitchMin` / `pitchMax` / `pitchDefault` | 仰 25° / 俯 60° / 俯 12° | — |
| `camera.sensitivity` | 0.10 °/像素（无加速、无平滑） | 0.03～0.30 |
| `camera.pullInTime` | 0（瞬时） | — |
| `camera.returnDelay` / `returnTime` | 0.1 s / 0.4 s 缓出 | 0～0.3 / 0.25～0.8 |
| `camera.lockLookAtRatio` | 0.3（哪吒→目标连线 30% 处） | 0～0.5 |

### 3.3 浮动与红绫（float-fx）
| 键 | 默认 | 来源 |
|---|---|---|
| `float.idleAmp` / `idleFreq` | 0.05 m / 0.8 Hz | 锁定 |
| `float.swayDeg` / `swayFreq` / `swayPhase` | 1.5° / 0.55 Hz / 90° | 锁定 |
| `float.moveAmp` / `sprintAmp` | 0.03 / 0.015 m（飞驰去摆荡） | 锁定 |
| `float.blendTime` | 0.3 s（幅度切换过渡） | 建议 |
| `sash.lagCycles` | 0.25 周期 | 锁定 |
| `sash.strands` / `segments` / `length` | 2 / 12 / 1.1 m | 建议 |
| `sash.stiffness` / `damping` / `buoyancy` | 40 / 6 / 2.5 m/s² 向上 | 建议（试玩调） |
| `sash.maxHeight` | 不超过头顶（≤ 模型 1.95 m） | 锁定 |
| `wheel.emissive` | 0.30（三成亮度，橙金） | 锁定 |
| `glow.radius` / `glow.intensity` | 0.9 m / 恒定 | 半径建议 |

### 3.4 锁定（lock-on）
| 键 | 默认 | 范围 / 来源 |
|---|---|---|
| `lock.acquireRange` / `breakRange` | 25 / 30 m | 锁定 |
| `lock.target.height` / `length` | 5 / 12 m | 2～8 / 4～20（锁定范围） |
| `lock.minOrbitGap` | 1.5 m（离目标表面） | 建议 |
| `lock.target.spawn` | 广场中央偏宫门 | 建议 |

### 3.5 环境浮动与场景（ambient-float / arena-greybox）
| 键 | 默认 | 来源 |
|---|---|---|
| `ambient.seaweed.canyon` / `edge` / `far` | **240 / 180 / 60 = 480**（评审遗留数值） | 主策划，可调 0～1200 |
| `ambient.seaweed.swayHz` | 0.18 Hz（上限 0.25） | 建议 |
| `ambient.seaweed.maxHeight` | 1.2 m | 主策划 |
| `ambient.particles.count` / `driftHz` | 1000 / 0.12 Hz，非冰青色 | 建议（上限 3000） |
| `scene.fog.color` / `density` | 深蓝 / 由近及远变暗 | 试验后定 |
| `scene.beam.swayPeriod` | 12 s（≈ 0.08 Hz） | 建议 |
| `occlusion.fadeOpacity` / `fadeTime` | 0.35 / 0.2 s | 锁定 |

---

## 4. 验收方案

### 4.1 测试环境分工
- **WorkBuddy 内（puppeteer-core + 系统 Chrome 驱动构建版 `project preview`）**：第 1～11 条自动判定 + 第 12～14 条截图素材。启动参数 `--no-sandbox --disable-gpu-sandbox --enable-unsafe-webgpu`，等待 `html[data-forgeax-input="open"]`；指针锁定先 CDP `Emulation.setFocusEmulationEnabled` + `bringToFront`。截图写 `artifacts/m1/`，失败/调试帧写 `.forgeax/diag/`。
- **老板终端**：`pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json`（官方 play，用 `play.advance` 逐帧复核第 1～4 条）；第 11 条若 WorkBuddy 内拿不到真实 GPU 适配器则在此测；第 15 条试玩。我会给出可直接粘贴的命令。
- 测试只读投影、只用真实键鼠，不为测试改游戏逻辑。尺寸切换、pseudo 语言通过开发开关（见决策 ③）进入，属于调试入口而非测试专用逻辑。

### 4.2 QA 投影 `registerRead({ id: 'nezha' })` 字段
`t`（游戏时间）、`frame`；`ui{phase, pointerLocked, debugOpen}`；`player{root, capsule, modelOffsetY, facingYaw, speed, mode, samples[]}`（samples 为最近 4 s 固定步环形缓冲：`{t, speed, yaw, modelY, capsuleY}`）；`float{amp, freq}`；`glow{pos, radius, intensity}`；`silhouette{height, spearLength, screenBox}`；`camera{pos, yaw, pitch, distance, desired, minDistance, blocked, lifted}`；`occlusion{pillars[{id, opacity, since}], nezhaVisibleRatio}`；`lock{active, distance, hint, target{height, length, screenBox}, nezhaInFrame}`；`ambient{seaweed{canyon, edge, far}, swayHz, particles}`；`i18n{lang, source, pseudo, lastEvent}`；`platform{initialized}`；`perf{frameMsP95, drawCalls, adapter}`；`tuning{overrides}`。

### 4.3 过关清单逐条对应

| # | 条目 | 测法 | 投影字段 | 截图名 | 环境 |
|---|---|---|---|---|---|
| 1 | 移速 5 / 飞驰 9 / 转向 720°/s，±5% | 广场空旷处按住 W 2 s 取稳态速度；按住 Shift+W 2 s；反向输入测 yaw 变化率（180° 应 0.25 s） | `player.samples`、`player.mode` | `speed.png` | WB + 老板 play 复核 |
| 2 | 0.1 s 到 95%、0.15 s 停下，±1 帧 | 用 samples 的游戏时间戳计算 t95 与停止时刻，不依赖真实时钟 | `player.samples` | `accel.png` | WB；老板 play 用 `play.advance` 逐帧复核 |
| 3 | 模型离根 0.3 m；静止 ±5 cm、0.8 Hz ±10%；海草 ≤ 0.25 Hz | 静止 5 s 采样 modelY，求均值、峰峰值/2、过零频率；海草读一株摆角时序求频率 | `player.samples.modelY`、`ambient.swayHz` | `hover.png` | WB |
| 4 | 胶囊位移 ≤ 1 mm | 静止 5 s，胶囊 y 与 xz 的最大偏差 | `player.samples.capsuleY`、`player.capsule` | `capsule.png` | WB |
| 5a | 贴墙不穿模 | 峡道内背靠礁壁后退、转镜头扫墙；判定镜头到墙距离 ≥ 留边且近裁面不入墙，截图人工复核 | `camera.*` | `wall.png` | WB |
| 5b | 石柱 0.2 s 内不透明度 ≤ 0.4，哪吒可见 ≥ 90% | 走位使石柱挡在镜头与哪吒之间，读不透明度时序；可见率 = 哪吒模型上 ≥ 200 个采样点从镜头射线检测，未被「未镂空的实体」挡住的比例（镂空石柱视为透过） | `occlusion.*` | `pillar.png` | WB |
| 6 | 2×4 与 8×20 两端尺寸，12 角度哪吒完整入画 | 调试开关切尺寸 → 锁定 → 按住 A 环绕，每 30° 读哪吒屏幕包围盒是否完全在视口内 | `lock.*` | `lock-2x4-00..11.png`、`lock-8x20-00..11.png` | WB |
| 7 | 接触光偏离根 ≤ 1 cm | 静止、移动、飞驰中各采样，比较 glow.pos 与 root（水平） | `glow`、`player.root` | `glow.png` | WB |
| 8 | 身高 1.65 / 枪 2.4，±3% | 读网格包围盒（去掉悬浮偏移） | `silhouette` | `silhouette.png` | WB |
| 9 | 英文无中文残留，pseudo 无溢出 | en-US 启动扫描 DOM 文本中的 CJK（跳过调试面板）；pseudo 下 1280×720 / 1280×600 检查溢出、重叠；切换后刷新验证记忆；验证引擎侧收到切换事件 | `i18n.*` | `lang-en.png`、`lang-zh.png`、`lang-pseudo.png` | WB |
| 10 | 控制台报错 0 | 全程收集 console error 与 pageerror | — | `console.png`（最后一帧） | WB |
| 11 | 真实 GPU、1080p p95 ≤ 5 ms、绘制 ≤ 300 | 1920×1080 视口，确认适配器非 SwiftShader；峡道、广场、锁定+石柱三处各采 600 帧；另记海草 0 / 480 / 1200 三档 | `perf.*` | `perf-canyon.png`、`perf-plaza.png`、`perf-lock.png` | WB；拿不到真实 GPU 则老板终端 |
| 12 | 剪影辨识度 | 灰模模式（开发开关，材质统一中灰）下镜头置于 30 m 外 | — | `review-silhouette-30m.png` | 截图评审 |
| 13 | 半透明能否代替镂空 | 同一机位分别拍 alphaHash 与兜底效果（若两条路线都做了） | — | `review-pillar-fade.png` | 截图评审 |
| 14 | 峡道暗处一眼找到哪吒 | 峡道最暗处自由镜头 + 远 15 m 两机位 | — | `review-canyon-dark.png` | 截图评审 |
| 15 | 操作跟手感 | 老板试玩清单：起步/急停、飞驰、转身、贴墙、穿石柱、锁定环绕、中英切换；面板可现场调参并一键导出 tuning.json | — | — | 老板试玩 |

---

## 5. 风险与兜底

| 风险 | 兜底 |
|---|---|
| **镂空（alphaHash）不可用**：运行时无法逐物体改不透明度，或效果噪点过重 | **B1**：每根石柱准备「不透明 / 镂空」两份材质，渐隐时切换并按 4 档（1.0→0.75→0.5→0.35）在 0.2 s 内分步；**B2**（已定稿兜底）：35% 透明度半透明材质 + 描边，哪吒的自发光后画、不被压暗。均不改用镜头拉近。进入正式美术前换回抖动镂空。 |
| alphaHash 把阴影也一起镂空（设计要求「阴影照常」） | 石柱阴影交给一个只投影、不可见的代理体；若做不到，灰盒阶段接受，记入 feedback.md，M5 前复核 |
| 描边与镂空叠加不出来 | 灰盒阶段只保留镂空，描边改为石柱边缘的冷色自发光细线（材质内实现） |
| Surface 不支持顶点位移（海草摆动） | 480 株按「丛」驱动实例变换，CPU 每帧更新（约 40 丛）；或使用引擎 MorphWeights 计算流 |
| WorkBuddy 内 Chrome 拿不到真实 GPU（只有软件渲染） | 第 11 条转老板终端；WorkBuddy 内只记录绘制调用数 |
| 性能代理基线超标 | 先查绘制调用（目标 ≤ 300），再按老板已定的降级顺序：颗粒减半 → 泛光 → …；哪吒浮动、红绫、接触光不参与降级 |
| 龙王体型未定 | 长条目标两端尺寸都过第 6 条，龙王怎么改都不推翻 M1 |
| 已知引擎坑 | materialSlots 的 sourceKey 必须唯一（加单测）；UI CSS 禁用 text-overflow；按钮 `pointer-events: auto`；`.ui.html.meta.json` 含 `importSettings`；射线 filterMask 用 Rapier 分组格式 |

**性能基线测法**：构建版预览，1920×1080，真实 GPU（记录适配器名），关闭开发面板；三个固定机位（峡道中段、广场中央、锁定 + 石柱遮挡）各稳定 2 s 后连续采 600 帧，取引擎报告的帧耗时 p95 与绘制调用数（具体取数接口在 T1 确认；若只能拿到 rAF 间隔则在 vsync 关闭条件下测并注明）；海草 0 / 480 / 1200 三档各测一次，写入 `artifacts/m1/perf.json`。

---

## 6. 需老板拍板的事项（✅ 13:17 全部按建议）

| # | 事项 | 建议 |
|---|---|---|
| ① | **旧原型怎么用**（`2026-11-05-00-24-14/nezha-boss`） | **按规定流程新建工程，只移植已验证的独立模块**（布局、射线拉近、锁定数学、语言检测、构建脚本+本地化加载画面、QA 库），逐个改造；不整体拷贝，避免旧设计（行走、人形龙王）混入 |
| ② | 背靠墙的极端情况（主策划） | 镜头上抬俯视，哪吒始终可见；备选「贴近 + 哪吒淡化」会与「暗处一眼找到哪吒」冲突 |
| ③ | 开发开关的入口：调试面板、pseudo 语言、灰模模式、目标尺寸 | 构建版里用 URL 参数 `?dev=1` 开启，默认隐藏；M5 发布检查时移除。这样验收能在构建版里完成，也符合「开发版提供」 |
| ④ | 1200 株压测是否卡关（主策划） | 只记录不卡关；p95 > 5 ms 立即上报 |
| ⑤ | 自由镜头 5.0 m 还是 5.4 m（主策划） | 默认 5.0，面板一键切换，老板试玩时定 |
| ⑥ | 语言表的上下文说明放哪（本地化负责人在评审中提出的返工风险） | 放在 `assets/i18n/context.json`，与语言表键一一对应，单测强制每个键都有说明 |

**跨窗口事项（请主窗口协调）**：主策划要求「M1 灰盒通行区内不出现低于 3 m 的顶部遮挡」，资产轨后续做沉船残骸、倒塌石柱等场景素材时需要遵守。
