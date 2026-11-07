# GitHub 开源战斗角色 / Boss 资源调研

> 调研日期：2026-11-02。仓库数据来自 GitHub API；许可证均读取了仓库内的 LICENSE / CREDITS 原文；"实测"一列是把 .glb 文件下载下来解析出的面数、骨骼数和动画片段。
> 判断标准：能否**放进我们这个公开的 GitHub 仓库并在线发布**（不只是"能不能用"）。

## 一、结论速览

| 分级 | 资源 | 许可 | 能否进我们的公开仓库 |
| --- | --- | --- | --- |
| ✅ 首选 | KayKit 角色包（冒险者 / 骷髅）+ KayKit 动画包 | CC0 | 可以，无需署名 |
| ✅ 可用 | Khronos glTF 示例、three.js 的 RobotExpressive | CC0 | 可以（偏演示，不适合战斗） |
| ⚠️ 有条件 | Quaternius（Universal Animation Library、Ultimate Monsters 等） | 官网已改为 QAL v1.0，旧下载为 CC0 | 能用在游戏里，但**不能把原始模型文件当素材散发**；公开仓库里放原文件有风险 |
| ⚠️ 需署名 | Godot TPS Demo 美术、Ancient Dragon 的龙 | CC-BY 3.0 / 4.0 | 可以，但必须保留署名与许可链接 |
| ❌ 不能用 | Bandai Namco 动捕数据、Ubisoft La Forge 动作数据 | CC BY-NC / BY-NC-ND | 禁止商用（Ubisoft 还禁止修改） |
| ❌ 不能用 | Ready Player Me 动画库 | 自有许可 | 只能配 RPM 头像用，禁止再分发 |
| ❌ 不能用 | three.js 自带的 Soldier / Xbot / Michelle | 来源为 Mixamo | 仓库内无单独授权；Mixamo 允许在项目里使用，但不允许再分发原文件 |
| ❌ 不能用 | dance-of-flames（龙 Boss） | PolyForm Noncommercial | 禁止商用 |
| ❓ 不明 | rotten-souls 的 Boss「Vharen」 | 未在署名文件中列出（AI 平台生成） | 授权不清，不要拿 |

**一句话**：开源世界里"可商用 + 带完整战斗动作 + 能放进公开仓库"的成套资源，几乎只有 **KayKit（CC0）** 一家最干净；Quaternius 动作更全，但许可已收紧。**东方神话风格（哪吒、敖丙、黑熊精）的开源角色基本不存在**，搜 `nezha 3d` 只有无关项目。

## 二、可直接用的角色 / 动作

### 1. KayKit（Kay Lousberg）— 首选
- 仓库：`KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0`（62★）、`…-Skeletons-1.0`（28★）；动画包在 itch.io
- 许可：仓库 `LICENSE.txt` 原文为 **CC0**，无需署名
- 实测（取自开源游戏 cairnfall 收录的同款文件）：

| 文件 | 大小 | 面数 | 骨骼 | 动画片段 |
| --- | --- | --- | --- | --- |
| Knight.glb（骑士） | 3.5MB | 6,952 | 41 | 76 |
| Skeleton_Warrior.glb（骷髅战士） | 4.6MB | 5,934 | 41 | 95 |

- 动作覆盖：单手/双手劈、斜斩、横斩、刺、旋转斩、跳劈、格挡、闪避、受击、死亡、施法等，全部是战斗可用的
- 局限：Q 版低多边形卡通风，与"写实东方神话"不搭；所有角色共用一套骨骼，动作可以互通

### 2. Quaternius — 动作最全，但许可已变
- 产品：Universal Animation Library 1（120+ 动作）、UAL 2（130+，含 3/4 段近战连招）、Ultimate Monsters（50 只带攻击/死亡动画的怪物）
- 许可现状（已读官网 license 页原文）：
  - 官网现行 **Quaternius Asset License (QAL) v1.0**：可免费商用、无需署名，但**禁止把资源本身（原样或修改后）作为素材、模板再分发**
  - 部分包页面和 FAQ 仍写 CC0；QAL 第 7 条说明**不追溯**，之前以 CC0 下载的版本仍按 CC0
  - GitHub 上 `J-Ponzo/gltf-universal-animation-library`（CC0-1.0）保存了 2025-06-10 的免费版 glTF
- 实测：
  - rotten-souls 用的 UAL 角色：14,639 面、53 骨骼、46 个片段（含 `Sword_Attack`、`Roll`、`Hit_Chest`、`Death01`）
  - Ultimate Monsters 的龙：仅 1,344 面、5 个片段（待机/攻击/受击/死亡），太简单，当不了 Boss
- 风险：我们的仓库是公开的，`.glb` 原文件可以被直接下载，可能被认定为"再分发资源"。要用的话，建议只用 CC0 时期的版本并保留来源记录

### 3. 其它 CC0 / 宽松资源
- **Khronos glTF-Sample-Assets**（1142★）：CC0 / CC-BY 4.0 双许可，主要是渲染测试模型，只有 Fox 等少量带动画
- **three.js RobotExpressive**：Quaternius 制作，CC0；453KB、14 个片段，只有一个 `Punch` 算战斗动作
- **100Avatars**（PolygonalMind，172★）：约 200 个低模人形，有资料称 CC0，但仓库没有 LICENSE 文件，且是 Mixamo 绑定，需逐个核实

## 三、可参考的开源 Boss 战项目（看设计和代码，不搬美术）

| 项目 | 引擎 | 许可 | 值得看的地方 |
| --- | --- | --- | --- |
| `igorjohn/rotten-souls` | Three.js r185 + WebGPU | 代码 MIT | 浏览器类魂 Boss 战，和我们技术栈最接近；有画质分级和性能记录（Boss 蒙皮网格让帧时间从 5.2ms 涨到 14.6ms） |
| `euuuuuuan/cairnfall-public` | Godot 4.7 | 代码 Apache-2.0，美术见 CREDITS.md | 10 个三阶段 Boss；黄色可闪/红色必须离开的预警语法；完善的素材授权台账（值得照抄这个做法） |
| `catprisbrey/Third-Person-Controller--SoulsLIke-Godot4` | Godot 4 | MIT | 类魂第三人称控制器：翻滚、锁定、连招状态机 |
| `NovemberDev/novemberdev_soulslike_darksouls_godot` | Godot 3 | MIT | 早期黑魂复刻（2021 年后已不更新） |
| `salandered/Godot-Souls-like-Game-Template` | Godot 4 | 未标准识别 | 带完整署名文件，美术多为 Sketchfab CC-BY |
| `LIy-hub/AncientDragon` | Java | 代码 MIT，美术 CC-BY 4.0 | 天空 + 地面两段的龙 Boss；龙模型来自 Sketchfab，需署名 |

## 四、不能用的（避坑）
- **Bandai Namco 动捕数据集**（3377★）：有拳、踢、斩等专业动捕，但 **CC BY-NC 4.0，禁止商用**，且是 BVH 格式需要重定向
- **Ubisoft La Forge 动作数据集**（1639★）：含格斗动作，**CC BY-NC-ND 4.0**，禁止商用、禁止修改
- **Ready Player Me 动画库**（597★）：许可写明只能配 RPM 头像使用、禁止再分发
- **three.js 的 Soldier / Xbot / Michelle**：常被当作"MIT 可用"转载，但来源是 Mixamo，three.js 仓库里没有给它们单独授权，不要放进我们的仓库
- **dance-of-flames**：龙 Boss 只有 1 个飞行动画，许可为 PolyForm Noncommercial
- **AI 生成模型**：Hunyuan3D-2 许可**排除欧盟、英国、韩国**；Stable-Fast-3D 年收入超 100 万美元需另外授权并标注 "Powered by Stability AI"

## 五、对《黑神话：哪吒》的建议

1. **角色外形继续自己做**。开源圈没有可用的哪吒、敖丙、黑熊精，现成的西式 Q 版低模放进来会和现有画风冲突。
2. **最值得引入的是"动作"，不是"模型"**。KayKit 动画包（CC0）有完整的单双手劈、斩、刺、旋转斩、跳劈、受击、死亡。可以写一个小工具，把这些片段的关节旋转重定向到我们现有的程序化骨骼上，替代现在手写的关键帧，攻击动作会自然很多。哪吒的枪法可以从"双手刺 / 旋转斩"改出来。
3. **如果要换成真蒙皮模型**，参考 rotten-souls 的做法：先用 CC0 占位角色把整套战斗跑通，再换最终美术；同时注意蒙皮网格的性能开销。
4. **建立素材授权台账**：仿照 cairnfall 的 `CREDITS.md`，每引入一个文件都登记来源、许可、能否再分发；并把"仓库内每个媒体文件都有授权记录"加进我们的自循环验收，没登记就不允许发版。

## 附：数据来源
- GitHub API（仓库元数据、文件树）与各仓库 LICENSE / CREDITS / README 原文
- quaternius.com/license.html（QAL v1.0 全文）、quaternius.com/faq.html、kaylousberg.itch.io
- 自行下载并解析的 glb：Knight、Skeleton_Warrior、Dragon（Quaternius）、UAL 角色、RobotExpressive、Soldier、vharen、dance-of-flames 的 dragon/knight

## 附录：完整开源仓库清单（不按许可筛选，2026-11-02 GitHub API 数据）

### 角色 / 动作 / 怪物素材
| 仓库 | ★ | 许可 | 内容 |
| --- | --- | --- | --- |
| [KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | 62 | CC0 | 冒险者角色 + 武器，带近战动作 |
| [KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | 28 | CC0 | 骷髅战士/法师/弓手等，95 个动作 |
| [J-Ponzo/gltf-universal-animation-library](https://github.com/J-Ponzo/gltf-universal-animation-library) | 2 | CC0-1.0 | Quaternius 通用动画库免费版 glTF |
| [trebeljahr/quaternius-showcase](https://github.com/trebeljahr/quaternius-showcase) | 9 | 未标明 | Quaternius 全部免费包的在线浏览/下载 |
| [PolygonalMind/100Avatars](https://github.com/PolygonalMind/100Avatars) | 172 | 未标明 | 约 200 个开源低模人形 |
| [ToxSam/open-source-avatars](https://github.com/ToxSam/open-source-avatars) | 107 | 未标明 | 开源 VRM 头像索引 |
| [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) | 1142 | CC0/CC-BY | glTF 官方示例模型 |
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | 117390 | MIT | 示例里有 RobotExpressive（CC0）等带动画模型 |
| [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 2251 | MIT | three.js 加载 VRM 角色 |
| [readyplayerme/animation-library](https://github.com/readyplayerme/animation-library) | 597 | 自有许可 | 240 个人形动画 |
| [BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset) | 3377 | CC BY-NC | 专业动捕：拳、踢、斩 |
| [ubisoft/ubisoft-laforge-animation-dataset](https://github.com/ubisoft/ubisoft-laforge-animation-dataset) | 1639 | CC BY-NC-ND | 动捕，含格斗动作 |
| [rehan-remade/animated-asset-skill](https://github.com/rehan-remade/animated-asset-skill) | 25 | MIT | 一句话生成绑定好、带动作的体素角色 |
| [teamgravitydev/gamedev-free-resources](https://github.com/teamgravitydev/gamedev-free-resources) | — | — | 免费游戏素材汇总清单 |

### 类魂 / Boss 战 / 动作游戏源码
| 仓库 | ★ | 许可 | 引擎 | 内容 |
| --- | --- | --- | --- | --- |
| [catprisbrey/Cats-Godot4-Modular-Souls-like-Template](https://github.com/catprisbrey/Cats-Godot4-Modular-Souls-like-Template) | 435 | Unlicense | Godot 4 | 模块化类魂模板 + 素材 |
| [Relintai/broken_seals](https://github.com/Relintai/broken_seals) | 416 | MIT | Godot | 第三人称动作 RPG，支持联机 |
| [Turing-Project/Black-Myth-Wukong-AI](https://github.com/Turing-Project/Black-Myth-Wukong-AI) | 401 | Apache-2.0 | — | 用强化学习打《黑神话》Boss 的 AI |
| [NotYetGames/WarriOrb](https://github.com/NotYetGames/WarriOrb) | 342 | MIT | Unreal | 已上架类魂动作游戏完整源码 |
| [leotgo/bright-souls](https://github.com/leotgo/bright-souls) | 331 | 未标明 | Unity | 类魂游戏 |
| [Antikythera-Studios/epicfight](https://github.com/Antikythera-Studios/epicfight) | 244 | GPL-3.0 | Minecraft 模组 | 类魂战斗系统 |
| [ZsoltMolnarrr/BetterCombat](https://github.com/ZsoltMolnarrr/BetterCombat) | 200 | 未标明 | Minecraft 模组 | 连招近战系统 |
| [catprisbrey/Third-Person-Controller---Godot-Souls-like](https://github.com/catprisbrey/Third-Person-Controller---Godot-Souls-like) | 124 | MIT | Godot 3.5 | 类魂第三人称控制器 |
| [mariumbacchus/Soulslike-Weaponry](https://github.com/mariumbacchus/Soulslike-Weaponry) | 74 | CC0-1.0 | Minecraft 模组 | 新 Boss 与传奇武器 |
| [NovemberDev/novemberdev_soulslike_darksouls_godot](https://github.com/NovemberDev/novemberdev_soulslike_darksouls_godot) | 73 | MIT | Godot 3 | 3D 黑魂复刻 |
| [georgehuan1994/Unreal-Melee-Combat-System](https://github.com/georgehuan1994/Unreal-Melee-Combat-System) | 66 | MIT | UE 5.1 | 蓝图类魂近战系统 |
| [catprisbrey/Third-Person-Controller--SoulsLIke-Godot4](https://github.com/catprisbrey/Third-Person-Controller--SoulsLIke-Godot4) | 49 | MIT | Godot 4 | 上面控制器的 Godot 4 版 |
| [Gigadros/SoulsLike](https://github.com/Gigadros/SoulsLike) | 48 | 未标明 | Unity | 第三人称类魂 |
| [victorfisac/Dissolver](https://github.com/victorfisac/Dissolver) | 40 | MIT | Unity | 第三人称砍杀游戏 |
| [liulong1994/MeleeWander](https://github.com/liulong1994/MeleeWander) | 28 | 未标明 | UE5 | 近战 + 跑酷 |
| [vincent/three-arena](https://github.com/vincent/three-arena) | 25 | 未标明 | three.js | 3D 砍杀游戏框架 |
| [TCPHijinks/Unity3D-Advanced-Hack-n-Slash-Template](https://github.com/TCPHijinks/Unity3D-Advanced-Hack-n-Slash-Template) | 24 | 未标明 | Unity | 砍杀模板 |
| [Humpalumps/Cadle](https://github.com/Humpalumps/Cadle) | 19 | MIT | 浏览器 | 网页 FPS-RPG |
| [CornflakeWoof/BreadbinEngine](https://github.com/CornflakeWoof/BreadbinEngine) | 18 | MIT | Godot 4 | 类黑魂/血源动作 RPG 框架 |
| [vishwah13/UE5_MeleeCombat_System](https://github.com/vishwah13/UE5_MeleeCombat_System) | 14 | MIT | UE5 | 清版近战系统 |
| [salandered/Godot-Souls-like-Game-Template](https://github.com/salandered/Godot-Souls-like-Game-Template) | 10 | 未标明 | Godot 4 | 类魂演示，带完整署名 |
| [igorjohn/rotten-souls](https://github.com/igorjohn/rotten-souls) | 4 | MIT | three.js WebGPU | 浏览器类魂 Boss 战 |
| [euuuuuuan/cairnfall-public](https://github.com/euuuuuuan/cairnfall-public) | 2 | Apache-2.0 | Godot 4.7 | 10 个三阶段 Boss |
| [euuuuuuan/hollowmere-public](https://github.com/euuuuuuan/hollowmere-public) | 1 | Apache-2.0 | 浏览器 | 等距视角动作 RPG |
| [travisjones-dev/frostfell](https://github.com/travisjones-dev/frostfell) | 1 | 未标明 | three.js | 北欧风 3D 动作 RPG（单 HTML） |
| [Sonali-Sharma-tech/exilum](https://github.com/Sonali-Sharma-tech/exilum) | 6 | MIT | three.js | 零美术资源的等距动作 RPG |
| [VictorZakharov/last-stand](https://github.com/VictorZakharov/last-stand) | 3 | MIT | 浏览器 | 3D 波次生存动作 RPG |
| [LIy-hub/AncientDragon](https://github.com/LIy-hub/AncientDragon) | 0 | MIT + CC-BY | Java | 空中/地面两段龙 Boss |
| [phd1000x-ux/dance-of-flames](https://github.com/phd1000x-ux/dance-of-flames) | 1 | PolyForm NC | Babylon.js | 龙战斗动作游戏 |
| [godotengine/tps-demo](https://github.com/godotengine/tps-demo) | 1391 | CC-BY 3.0 | Godot | 高品质第三人称射击演示 |
| [veloren/veloren](https://github.com/veloren/veloren) | 7671 | GPL-3.0 | Rust | 开放世界体素 RPG |
| [flareteam/flare-game](https://github.com/flareteam/flare-game) | 1335 | 未标明 | FLARE | 奇幻动作 RPG |
| [Quaint-Studios/Reia](https://github.com/Quaint-Studios/Reia) | 985 | AGPL-3.0 | Godot + Rust | 动作冒险 MMO |

### AI 生成与自动绑定
| 仓库 | ★ | 许可 | 用途 |
| --- | --- | --- | --- |
| [Tencent-Hunyuan/Hunyuan3D-2](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) | 15284 | 腾讯自有（排除欧盟/英国/韩国） | 图/文生成高精度 3D 模型 |
| [VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR) | 7276 | MIT | 单图快速重建 3D |
| [VAST-AI-Research/UniRig](https://github.com/VAST-AI-Research/UniRig) | 1920 | MIT | 任意模型自动绑骨骼 |

## 附录二：3D 游戏角色仓库（2026-11-02 补充）

| 仓库 | ★ | 许可 | 内容 |
| --- | --- | --- | --- |
| [makehumancommunity/makehuman](https://github.com/makehumancommunity/makehuman) | 1632 | 未标明 | 开源写实人体角色生成器 |
| [makehumancommunity/mpfb2](https://github.com/makehumancommunity/mpfb2) | 677 | 未标明 | Blender 版 MakeHuman，生成带骨骼的人体 |
| [makehuman-js/makehuman-js](https://github.com/makehuman-js/makehuman-js) | 329 | 未标明 | 浏览器里生成 3D 人体 |
| [NitroxNova/humanizer](https://github.com/NitroxNova/humanizer) | 295 | AGPL-3.0 | MakeHuman 角色转 Godot 4 |
| [kblood/CharacterCreator](https://github.com/kblood/CharacterCreator) | 2 | GPL-3.0 | 写实角色生成，输出 GLB 给 Three.js |
| [M3-org/CharacterStudio](https://github.com/M3-org/CharacterStudio) | 369 | MIT | 网页版 VRM 角色捏人平台 |
| [nirholas/three.ws](https://github.com/nirholas/three.ws) | 264 | Apache-2.0 | 文字/照片生成带骨骼动画的角色 |
| [godotengine/godot-demo-projects](https://github.com/godotengine/godot-demo-projects) | 9738 | MIT | Godot 官方示例，含 3D 角色控制 |
| [gdquest-demos/godot-4-3d-character-sophia](https://github.com/gdquest-demos/godot-4-3d-character-sophia) | 4 | 未标明 | 现成 3D 角色 Sophia（带动画） |
| [gdquest-demos/godot-4-3d-character-gdbot](https://github.com/gdquest-demos/godot-4-3d-character-gdbot) | 3 | 未标明 | 现成 3D 角色 GDbot |
| [gdquest-demos/godot-4-3d-character-gobot](https://github.com/gdquest-demos/godot-4-3d-character-gobot) | 3 | 未标明 | 现成 3D 角色 Gobot |
| [gdquest-demos/godot-4-3d-character-beetle-bot](https://github.com/gdquest-demos/godot-4-3d-character-beetle-bot) | 2 | 未标明 | 现成怪物 Beetle bot |
| [gdquest-demos/godot-4-3d-character-round-bat](https://github.com/gdquest-demos/godot-4-3d-character-round-bat) | 2 | 未标明 | 现成怪物 Round Bat |
| [iwenzhou/kenney](https://github.com/iwenzhou/kenney) | 5 | CC0-1.0 | Kenney 素材合集（含角色） |
| [shorepine/kenney](https://github.com/shorepine/kenney) | 10 | 未标明 | Kenney CC0 素材整理版 |
| [LuanDucate/Ducz.CharacterCreator](https://github.com/LuanDucate/Ducz.CharacterCreator) | 0 | 未标明 | 用 Quaternius 模块拼装低模角色 |
| [dexedrne/radbros-3d](https://github.com/dexedrne/radbros-3d) | 1 | 未标明 | 4 个带骨骼动画的 glTF 角色 |
| [4onstudios/AutoTPose](https://github.com/4onstudios/AutoTPose) | 3 | MIT | 人形 GLB/FBX 自动绑骨骼、转 T 姿势 |
| [Sheggyb/AnimStudio](https://github.com/Sheggyb/AnimStudio) | 1 | AGPL-3.0 | 浏览器角色绑骨与动画编辑 |
| [Alex-DG/threejs-character-controls](https://github.com/Alex-DG/threejs-character-controls) | 23 | 未标明 | three.js 加载带动画 FBX 角色并操控 |
| [stalomeow/StarRailMotionCapture](https://github.com/stalomeow/StarRailMotionCapture) | 92 | MIT | 代码 MIT，但驱动的是商业游戏角色模型，模型本身不可用 |
