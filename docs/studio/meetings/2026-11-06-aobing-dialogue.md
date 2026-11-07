# 敖丙台词重写 · 叙事总监稿（2026-11-06）

> 依据：老板 11-06 17:11 指令「叙事总监重写台词，然后用上去」——老板已授权，稿成即上线，不再单独拍板。
> 角色：叙事总监（`design/studio/agents/narrative-director.md`）。玩法轨记录、落地。

## 1. 要解决的问题
- Boss 已由东海龙王换成**东海三太子·敖丙**（外形沿用长龙，招式与特效用 v1.4.0 敖丙）。旧台词全部建立在「龙王、为子报仇、我儿（敖丙已死）」上，现在敖丙活着、亲自出手，原台词全部作废。
- 关卡变了：先过陈塘关海岸栈道、两波巡海夜叉、太乙莲台，再上镇海台。台词要接得上这条路。
- 二阶段叫「龙化·万龙甲」，台词要给这个名字一个由头。

## 2. 约束（沿用 M4 已定规则）
- 台词时间表不变（`fight/run.ts` 的 `LINES`）：开场敖丙 288 步 + 哪吒 164 步；转阶段各约 280 步；战败一句；倒下一句 + 哪吒一句。
- 字数：每行 ≤ 42 字符，最多两行（`i18n.test.ts` 会查）；中文短句、留白，不喊口号。
- 语气基准：黑神话式的克制。人物不解释设定，只说态度。
- 内部键名仍叫 `dialogue.dragonKing.*`（只是代码里的名字，不显示给玩家）；改了只增加风险，留到 M5 统一清理。

## 3. 三个方向（叙事总监给出的选项）
| 方向 | 敖丙是什么人 | 优点 | 风险 |
|---|---|---|---|
| A 奉命而来 | 奉龙族之命水淹陈塘关，自己并不情愿 | 有层次，倒下那句最有余味；贴近 2019 动画版「宿命对手」的印象 | 要靠很少的字把「不情愿」说出来 |
| B 纯反派 | 骄傲的龙族太子，看不起凡人 | 直接、好打 | 扁平；和长龙外形的压迫感重复 |
| C 复仇 | 为龙族旧怨而来 | 冲突强 | 和旧龙王稿的「为子报仇」撞车 |

**叙事总监建议 A**：敖丙不是坏人，是被龙族的「债」推上台的。万龙甲 = 龙族千年的债，穿上它就是认了命；哪吒的回答把「债」和「命」拆开。倒下时说「岸上是暖的」，与旧稿龙王的「海底太冷」形成呼应（同一片海，两种冷暖）。
按老板授权，直接采用 A。

## 4. 定稿（中 / 英）
| 时机 | 说话人 | 中文 | English |
|---|---|---|---|
| 开场 | 敖丙 | 陈塘关的潮，是我放的。<br>哪吒——你来得正好。 | The tide on Chentang Pass is mine.<br>Nezha—you came just in time. |
| 开场 | 哪吒 | 夜叉我收了。<br>剩下的，收你。 | Your yaksha are done.<br>You're next. |
| 转阶段 | 敖丙 | 这身万龙甲，<br>是龙族千年的债。 | This Myriad-Dragon Armour<br>is my clan's thousand-year debt. |
| 转阶段 | 哪吒 | 债是你们的，<br>命是陈塘关的。 | The debt is yours.<br>The lives are Chentang's. |
| 战败 | 敖丙 | 回去吧。下一潮，你挡不住。 | Go home. You can't stop the next tide. |
| 倒下 | 敖丙 | ……原来，岸上是暖的。 | …So the shore is warm after all. |
| 胜利 | 哪吒 | 潮退了。回家吧，三太子。 | The tide's out. Go home, Third Prince. |

## 5. 连带改动
- 名称：Boss 全名「东海三太子 · 敖丙」/ Ao Bing, Third Prince of the East Sea；血条「东海三太子 · 敖丙」/「Ao Bing · Third Prince」；说话人「敖丙」/「Ao Bing」。二阶段血条名「敖丙 · 龙化 · 万龙甲」/「Ao Bing · Dragon Form」。
- 标题副标题：「哪吒踏风火轮，过陈塘关海栈，独上镇海台。」/ "Riding the Wind-Fire Wheels, Nezha crosses the Chentang boardwalk to the Sea-Calming Terrace."
- 结算奖励「龙王逆鳞」→「敖丙龙鳞」/ "Ao Bing's Dragon Scale"（只展示）。
- 二阶段提示：「敖丙龙化：冰棱震地 · 寒潮连突 · 龙跃冰环」。
- 给翻译的上下文说明（`i18n/context.json`）同步改写，去掉「我儿」「不点名敖丙」等旧限制。
