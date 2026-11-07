# 子任务 1 交接单：M1 开发准备（玩法轨）

> 用法：新开一个 WorkBuddy 对话，工作区选择 `/Users/cloud/WorkBuddy/2026-11-04-15-19-29`，把下方「开场指令」整段粘贴进去发送。

## 开场指令（复制以下全部内容）

```
你是《白神话：哪吒》项目「子窗口 1 · 玩法轨」的负责人。本窗口的任务是 M1 开发准备：先只做准备，交给我（老板）拍板之后再执行开发。

请先阅读以下文件（它们是事实来源，开始前全部读完）：
1. /Users/cloud/WorkBuddy/2026-11-04-15-19-29/design/handoffs/task1-m1-prep.md（本交接单，含环境注意事项）
2. /Users/cloud/WorkBuddy/2026-11-04-15-19-29/design/milestones/M1-foundation.md（M1 定义，已定稿）
3. /Users/cloud/WorkBuddy/2026-11-04-15-19-29/game-spec-nezha-boss.md（设计文档，按工作室三层分工组织）
4. /Users/cloud/WorkBuddy/2026-11-04-15-19-29/design/plan-and-progress.md（整体计划与进展）
5. /Users/cloud/WorkBuddy/2026-11-04-15-19-29/design/meetings/2026-11-05-m1-kickoff.md（M1 开工评审实录）

然后输出「M1 开发准备方案」交给我拍板。按交接单第 3 节列出的内容逐项写；我拍板之前不要创建工程，也不要写代码。
```

---

## 1. 工作约定（老板定的，必须遵守）
- **每走一步都要汇报**：先列整体计划逻辑，再简要说当前进展。每完成一步就更新 `design/plan-and-progress.md`。
- **涉及设计决策时开会**：用 `design/studio/agents/` 里的角色设定启动独立子代理，模拟真实工作室的会议流程（主持人简报 → 各角色按顺序发言 → 交叉讨论 → 制作人起草决议 → 老板拍板）。**每位角色发言完立刻同步给老板**，并追加写入会议实录；老板拍板之前不修改设计文档。会议纪要放在 `design/meetings/`。
- **交付验收**：必须用 forgeax CLI 创建工程、执行 `project build`；在构建版 `forgeax project preview` 中用真实键鼠逐条验收，每条附截图。单靠构建成功、URL 能打开或单测通过，不算交付。
- **双语**：所有界面文字都走语言表，用户手动选择的语言要记住；同时准备中英两版封面（M5 制作）。
- **跨窗口**：设计决策若需要改动其他轨道（例如龙王尺寸影响锁定），在 `plan-and-progress.md` 中注明，交由主窗口协调。

## 2. 环境与已知坑（已验证）
- **工具链**：使用前先执行 `export PATH="$HOME/.local/bin:$PATH"`，对应 pnpm 12.15.0、npm 12.2.1、bun 1.4.4。WorkBuddy 自带 Node 22.22.2。
- **SDK**：位于 `/Users/cloud/WorkBuddy/2026-11-04-15-19-29/forgeax-sdk`（0.4.19，已初始化）。初始化时用的是 Node 24，所以调用 SDK 的 bin 必须用 `/usr/local/bin/node bin/forgeax.mjs ...`，否则会报 `sdk-not-initialized`。
- **创建工程**：通过造化插件 MCP。
  1. 先调用 `game_builder_status`，`root_uri` 填 `file:///Users/cloud/WorkBuddy/2026-11-04-15-19-29/nezha-boss`，先建好空目录。
  2. 调用 `game_builder_display_template_selection`（文字模式），由老板确认引擎。
  3. 调用 `game_builder_create_current_directory`，参数 template_id=`forgeax/engine`、platform=`pc`，并设置 confirm_create。
  4. 按返回的引导，用 SDK 执行 `project new <目录> --template game-3d`。
  
  可参考已完成的练手项目 `snake-2d/`。
- **造化平台 SDK**：执行 `install-platform-sdk.mjs` 之前，必须先 `mkdir -p vendor/zaohua-platform-sdk`。原因是沙箱里 rename 失败时报 EIO 而不是 ENOENT，安装器会误判。安装后写入 `assets/runtime/zaohua-platform-init.js`。
- **沙箱限制**：
  - `forgeax dev start`、`project play` 在 WorkBuddy 内会崩溃（spawn EPERM / Target crashed）。官方 play 脚本请老板在自己的终端跑。
  - 在 WorkBuddy 内验收的方法：`project build`，再 `project preview --port <端口>`（后台运行），然后用 puppeteer-core 驱动系统 Chrome。
    - puppeteer-core 的 require 路径：`/Users/cloud/WorkBuddy/2026-10-31-16-30-00/qa/node_modules/puppeteer-core`
    - 启动参数：`--no-sandbox --disable-gpu-sandbox --enable-unsafe-webgpu`
    - 等页面出现 `html[data-forgeax-input="open"]` 后再操作
    - 参考脚本：`snake-2d/artifacts/built-preview/qa.cjs`
- **引擎 UI**：UI 层默认点击穿透，按钮必须设置 `pointer-events: auto`。`.ui.html.meta.json` 必须包含 `importSettings`。`AssetHandle` 类型从 `@forgeax/engine/types` 导入。
- **游戏规则**：
  - 游戏工程里的 `AGENTS.md` 是开发权威，开工前必读。
  - `forge.json#roots` 是唯一的插件入口。
  - 状态通过 `gameHost.gameProjection.registerRead` 暴露给验收脚本。
- **造化**：已登录。素材库地址为 https://zaohua.qq.com/library?engine=forgeax 。

## 3. 「M1 开发准备方案」需包含的内容
1. **工程方案**：game-3d 模板中哪些保留、哪些替换、哪些删除（Template Disposition），以及 `assets/` 下新增插件的划分，例如 hover-player、camera、lock-on、arena-greybox、ambient-float、i18n、debug-panel。
2. **开发任务拆解**：按 M1 定义中的开发顺序拆分（材质试验 → 角色控制器 → 镜头 → 浮动与红绫 → 锁定 → 镂空），每项写明产出和完成标志。
3. **tuning.json 初始参数表**：包括移动、镜头、浮动、锁定各项参数，并补齐评审遗留的两个数值：**海草数量、镜头最小距离**（由主策划给出建议值）。
4. **验收方案**：M1 过关清单 15 条逐条对应测法、投影字段和截图名；说明哪些在 WorkBuddy 内用 puppeteer 测，哪些请老板在终端用 `project play` 测。
5. **风险与兜底**：自定义材质（镂空）试验失败时的兜底方案、性能基线测法。
6. **需老板拍板的事项**：如果有，附上建议。

老板拍板后才执行开发；执行过程中每完成一个任务就汇报一次。
