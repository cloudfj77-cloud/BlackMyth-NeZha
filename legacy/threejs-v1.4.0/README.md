# 白神话：哪吒 / 悟空（网页 Boss 战）

一款写实东方神话风格的 3D 第三人称动作 Boss 战网页游戏，纯浏览器运行，无需安装。

- **在线游玩**：https://cloudfj77-cloud.github.io/BlackMyth-NeZha/
- **仓库地址**：https://github.com/cloudfj77-cloud/BlackMyth-NeZha
- **当前版本**：见 [`VERSION`](VERSION)，更新记录见 [`CHANGELOG.md`](CHANGELOG.md)

## 可选角色

| 角色 | 武器 | 法术 | 特点 |
| --- | --- | --- | --- |
| 天命人 · 悟空 | 金箍棒 | 定身术 | 稳扎稳打的四段棍法 |
| 哪吒 · 三太子 | 红缨枪 | 混天绫·缚 | 脚踏风火轮滑行（移速 +12%）、跳得更高；混天绫、发带、枪缨实时物理飘动 |

在标题页点击角色卡（或按 ← →）切换，选择会被记住。

## 关卡与 Boss

| 角色 | 关卡 | 前置关卡 | Boss |
| --- | --- | --- | --- |
| 悟空 | 黑风山 · 古道与古寺 | 古道、土地庙 | 黑风大王（二阶段：怒焰） |
| 哪吒 | 东海 · 陈塘关 | 海岸栈道两波巡海夜叉 → 太乙莲台 → 镇海水门 | 东海三太子 · 敖丙（二阶段：龙化·万龙甲） |

哪吒全程悬浮于风火轮上，不同动作有不同的浮动形态（待机漂浮、疾奔贴低前倾、转弯侧倾、蓄力升空、受击下沉）。

## 质量门禁（自循环验收）

```bash
cd qa && npm i && cd ..
node qa/run.js            # 全量验收，报告见 qa/report/report.md
node qa/run.js --only sea # 只跑某个套件：boot / hover / feel / sea / retry / wukong / perf
```

`scripts/release.sh` 发版前会自动运行验收，**任一阻断级用例失败即中止发版**。设计与验收标准详见 [`docs/PROMPT_ENGINEERING.md`](docs/PROMPT_ENGINEERING.md)。

## 操作

| 按键 | 动作 | 按键 | 动作 |
| --- | --- | --- | --- |
| W A S D | 移动 | 鼠标 | 旋转镜头 |
| 左键 | 多段轻击（空中＝跳劈） | 右键（按住） | 蓄力重击 |
| 空格 | 翻滚 / 空中空翻 | Ctrl / F | 跳跃 |
| Shift（按住） | 疾奔 | R | 锁定 Boss |
| Q | 饮葫芦回血 | 1 | 法术（定身术 / 混天绫·缚） |
| B | 切换 Boss 血条位置 | H / M / Esc | 隐藏提示 / 静音 / 暂停 |

## 本地运行

直接用浏览器打开 `wukong/index.html` 即可（推荐 Chrome）。

## 目录结构

```
wukong/              游戏本体（GitHub Pages 发布此目录）
  index.html         页面与 HUD
  js/game.js         玩家控制、Boss AI、战斗、镜头、流程
  js/world.js        场景一：黑风山（地形、古寺、断墙、石灯、树林、远山）
  js/sea.js          场景二：东海陈塘关（海面、栈道、龙柱、镇海台、远景龙宫）
  js/characters.js   角色模型（悟空/哪吒/黑风大王/敖丙/夜叉）、物理飘带、悬浮运动系统
  js/audio.js        程序化音效与循环 BGM
  js/version.js      版本号（发版脚本自动更新）
  lib/three.min.js   Three.js r149
scripts/release.sh   一键发版脚本（内置质量门禁）
qa/run.js            自循环验收系统
docs/                Prompt 工程文档
.github/workflows/   自动部署 Pages、自动创建 Release
```

## 版本更新流程

日常改动直接提交推送，`main` 分支每次推送都会自动重新部署在线版：

```bash
git add -A && git commit -m "调整 Boss 突进距离" && git push
```

需要正式发一个版本时，用发版脚本（自动升版本号、写更新日志、打 tag、推送，并在 GitHub 生成 Release 和游戏压缩包）：

```bash
scripts/release.sh patch "修复锁定镜头抖动"          # 修订：1.1.0 → 1.1.1
scripts/release.sh minor "新增棍花；新增第二个 Boss"  # 新功能：1.1.0 → 1.2.0
scripts/release.sh major "第二回 黄风岭"              # 大版本：1.1.0 → 2.0.0
```

## 技术说明

- Three.js r149（本地引入，可离线运行）
- 所有模型、贴图、音效与音乐均为代码程序化生成，无外部美术资源
