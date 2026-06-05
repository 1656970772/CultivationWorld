# ADR-047：修炼选行均衡（缺啥补啥、换着做）+ 凡人血量修正

最后更新：2026-06-03

状态：已采纳并实施（2026-06-03）。确定性摘要同种子可复现（`66b24755`，120 天 110 存活）；3000 天天才长程模拟显示行为多样化、进度稳步增长、不再早夭。本次为**有意改变 AI 决策行为**，非机制迁移，故不追求默认关闭不改变既有行为（项目验证规则只禁止"旧摘要回归自证"，要求真实长程模拟统计为准）。

> 关联：[ADR-039](adr-039-qi-progress-decoupling.md)（真气/进度解耦）、[ADR-040](adr-040-cultivation-pace-and-qi-pill-decay.md)（修炼节奏）、[ADR-042](adr-042-gameplay-ability-system.md)（GAS 战斗）、[ADR-041](adr-041-combat-survival-system.md)（战斗生存）。

## 背景

复盘天才 NPC（林天骄，灵根=heaven/体质=dao_body）一生，发现三个叠加病灶让其**第 61 天即死、进度永远卡在 0.025、终生不突破**：

### 病灶 1：修炼目标"想一次规划到完成"，撞 cultivationCap 后卡死

`need_npc_cultivation` 的 goalState 是终极目标 `totalProgress >= 1.0`。GOAP A\* 用 `_repeatToReachGoal` 把"闭关一次推进 0.001"折叠成"闭关约 1000 次到 1.0"，cost 极低 → A\* 恒选闭关。但闭关受 `cultivationCap` 上限约束（执行层夹取），**规划层看不到 cap**，撞 cap 后 `cultivationProgress` 不再涨，`totalProgress` 卡住 → 永远闭关、`insight` 恒 0、永不突破。

（此前 `cultivationCap.mortal/disciple` 误设为 `1.0`，使 cap 前置 `cultivationProgress < cap×0.999` 几乎永远满足，加剧此问题；已先行改回 `0.3`。）

### 病灶 2：贪心兜底"只挑最便宜"，闭关恒压制游历

A\* 失败退化到 `_tryGreedyFallback` 时，旧逻辑按 cost 升序选第一个。闭关(weight≈1)恒比游历(weight≈3)便宜 → 永远闭关，从不游历攒 insight。

### 病灶 3：凡人血量过低，被任意妖兽一击秒杀

凡人 `maxHp=30`、`0 减伤`。对比 grade1-2 妖兽（`monster-vs-npc.mjs` 数据）：

| 受击者 | grade1 单击占血 | grade2 单击占血 | 结果 |
|--------|----------------|----------------|------|
| 凡人(旧 30血/0减伤) | 202%~325% | 433%~713%（≥maxHp×4 触发**伤害碾压**，保命符失效） | 任意妖兽 1 击毙命 |

凡人一出门游历必撞安全带内的 grade1-2 妖兽，**一击即死，遁地/锁血符都救不了**。游历 duration=90 天，没归来就死 → insight 永不结算。

## 决策

### 1. 修炼目标改增量式（incrementOf/step）

`ConfigurableEvaluator` 支持 goalState 条目标 `incrementOf`：目标值 = `实体[incrementOf] + step`（夹 `max`）。每次只规划"推进一小步"、做完重评估、下轮再往前——根除"想一次折叠到完成"。

```json
"totalProgress": { "op": "gte", "incrementOf": "totalProgress", "step": 0.01, "max": 1.0 }
```

### 2. 修炼需求改"贪心选行"策略（selectStrategy: greedy）

新增 `Goal.selectStrategy`（`'astar'` 缺省 / `'greedy'`），由需求配置 `selectStrategy` 驱动（经 `Need` → `NeedPool` → `Goal.fromNeed` 传递）。`need_npc_cultivation` 标 `"selectStrategy": "greedy"`：**跳过 A\* 折叠，直接在可执行行为间加权随机选一步**。

原因：修炼是"重复累积、无唯一最优、应换着做"的目标。A\* 是最优搜索，因游历单步推进量(0.005)远大于闭关(0.001)而恒偏游历、行为一边倒。greedy 随机选才能"缺啥补啥、换着做"。

### 3. 贪心选行按"软化权重"加权随机（_pickByProgressValue）

`_tryGreedyFallback` 不再"只挑最便宜"。多个能推进同一目标的可执行行为，按权重 `1 + sqrt(推进量/cost)` 加权随机选：

- **均等基底 1**：各可行行为基本等概率被选（真正换着做，不一边倒）。
- **sqrt 性价比微调**：略偏高效行为，但不压制其他。
- 随机走 `worldContext.rng`，**确定性可复现**（ADR-038）。
- 撞 cap 后闭关不可执行 → 候选只剩游历，自然转游历。

### 4. 凡人/弟子血量与减伤上调（不动妖兽）

`combat.json`：`baseHp.mortal/disciple` `30 → 120`，`baseDef.mortal/disciple` `0 → 0.15`。

效果（`monster-vs-npc.mjs` 复核）：凡人对 grade1 妖兽从"1 击死"变为"2-3 击死"（有反应/逃跑窗口）；grade2 单击占血降到 92%~152% 且 < `maxHp×4` 不再碾压 → **保命符可生效**；grade3 仍 order 差碾压（合理，凡人不该招惹）。

## 验证（真实长程模拟，非旧摘要回归）

- **确定性**：`verify-determinism` 同种子两次摘要一致（`66b24755`），加权随机走 rng 不破坏可复现。
- **天才 3000 天**：从"第 61 天死、卡 0.025"变为**活到模拟结束**，行为多样化（游历 57.9% + 修炼场 34.4% + 闭关 7% + 疗伤），进度稳步 `0.023 → 0.95`。
- **全量 152 NPC / 500 天**：所有 NPC 从"卡死单一闭关"变为游历+修炼+做任务+疗伤交替分布，有突破（掌门→元婴、妖王→化神），人口稳定（110/114 存活），关系网/师徒互动活跃，无崩盘。

## 已知遗留（后续单独处理，不在本 ADR 范围）

1. **修炼节奏偏慢**：天才 8 年(模拟内)进度才到 0.95、仍未突破到炼气；真气却涨到 2675（远超需求）。真气涨速与进度涨速不匹配，属 ADR-040 修炼节奏调参范畴。
2. **游历时间占比偏高(~67%)**：因游历单次 duration=90 天是闭关(30 天)的 3 倍，即使选择次数均等，按 tick 统计的时间占比仍偏游历。属合理涌现，如需进一步均衡可调 duration。

