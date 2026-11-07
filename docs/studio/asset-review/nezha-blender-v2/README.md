# 哪吒 · Blender 模型 v2（资产轨）

> 2026-11-06 22:00 老板对 v1 的意见：红缨加一倍、在枪头后面飘；火尖枪加长一倍；风火轮竖起来转；浮动幅度和龙一样，并适配玩法轨现有的战斗动作。
> 生成：`/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python build_nezha_v2.py -- <输出目录>`（约 2 分钟，含导出与两段视频）

## 文件
| 文件 | 内容 |
|---|---|
| `build_nezha_v2.py` | 生成脚本（模型、骨骼、15 段动作、渲染） |
| `nezha_v2.blend` | Blender 工程 |
| `nezha_v2.glb` | 蒙皮身体 + 火尖枪（挂 staffPivot）+ 两只风火轮（挂 lWheel / rWheel）；47 根骨骼；15 段动作 |
| `combat_reel.mp4` | 战斗动作合集 17.6 s，带 ±2 m 大浮动，镜头只跟一半浮动（同游戏镜头） |
| `float_with_dragon.mp4` | 侧视 + 高度标尺：哪吒与龙同样 ±2 m 浮动 |
| `render_01_hero_light3.png` / `render_03_hero_heavy.png` | 合集里的两帧 |
| `render_02_turnaround.png` | 静置正 / 侧 / 背三视图 |

## 本版改动
| 老板要求 | 做法 |
|---|---|
| 红缨加一倍，在后面飘 | 12 缕 → **24 缕**，长 0.17 → **0.68 m**（随枪 ×2，再 ×2）；挂 4 节缨骨，烘焙时用绳模拟，挥枪时向枪尾方向拖在枪头后面 |
| 武器加长一倍 | 火尖枪 2.4 → **4.8 m**，握点距枪尾 0.75 → 1.5 m，枪刃、倒钩、金箍同比放大 |
| 风火轮竖起来转 | 轮面竖直、绕横轴转；火焰沿轮缘向后卷；脚踩在轮子上方；运行时抵消腿弯保持竖直（照玩法轨写法） |
| 浮动幅度和龙一样 | **±2 m、4.5 s 一个周期**（与龙 `Swim` 相同），预览里以玩法轨空战高度 3.4 m 为中心（轮底 1.4～5.4 m） |
| 适配玩法轨战斗动作 | 骨架、姿势数据、时长、混合速率、悬浮层全部照 `nezha-boss/assets/nezha-rig/` 和 `combat/machine.ts` 复刻，见下 |

## 和玩法轨的对齐方式
- **骨架**：关节名、父子关系与 `rig-def.ts` 的 `JOINTS` 完全一致（hips、torso、head、rS/rE/rH、staffPivot、lS/lE/lH、lHip/lK/lMount/lWheel、rHip/rK/rMount/rWheel），位置 = `JOINTS × 0.86`（单位已是米，**rig 根节点不要再乘 0.86**）。
- **每个关节的静止旋转都是单位四元数**（导出后已逐个校验），与 v1.4.0 关节坐标系相同：`poseJoints()` 算出的欧拉角经 `qEuler` 后可直接写到这些关节上；hips 高度照 `hipsY` 写平移即可。
- 额外骨骼：`root`（整体浮动、跳跃、翻滚、回旋、倒地）、`sash_L/R_01～12`（两股红绫）、`tassel_01～04`（红缨），游戏里可以像现在的飘带一样用弹簧驱动。
- **15 段动作**（30 fps、原地、不含大浮动）：Idle、Glide、Light1～3、Light4_Spin（回旋枪）、Charge、Heavy、Roll、Hurt、Lotus、SashBind、Jump、PlungeAttack（跳劈）、Dead。姿势与时长取自 `P_IDLE`、`LIGHT_KF`、`LIGHT4_KF`+`spinOf`、`HC`/`HEAVY_KF`、`ROLL_TUCK`+`rollAngleDeg`/`rollHop`、`P_HURT`、`P_DRINK`、`P_CAST`、`JUMP_UP/DOWN`、跳劈关键帧、`P_DEAD`；步数取自 `machine.ts`（轻击 21/23/33/48、重击 33、翻滚 27、受击 24、莲子 60、缚 22、蓄力 72）；混合速率与悬浮层取自 `rig.pack.ts` 和 `HOVER_PROFILES`。

## 规格
- 面数：身体 10,628 + 枪 1,328 + 两轮 3,800 = **15,756 三角面**；骨骼 47 根。
- 身材按玩法轨骨架：轮底到发髻顶约 1.76 m，脚底到发髻顶约 1.5 m（比设计文档 1.65 m 矮一些，这是 v1.4.0 骨架本身的比例）。

## 已知不足
- 仍无贴图、无分指；大幅动作时甲裙、肩部绫带会和手臂有穿插。
- 红绫是两股长尾（老板认可的 v1 造型），玩法轨现在用的是 v1.4.0「两头系在肩后、飘成一个环」，二者不同。
- 未在天工引擎 0.4.19 里实际导入播放。
