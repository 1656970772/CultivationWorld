# ADR-016: 游历感悟与风险系统（突破进度双源 + 数据驱动风险）

> 日期：2026-05-30
> 状态：已采纳

## 背景

修炼突破原本只看 `cultivationProgress`（闭关进度），目标 `cultivationProgress >= 1.0`。
这导致弟子只会闭关/进修炼场，世界缺乏"外出寻机缘、互相厮杀、发现洞天福地/法宝材料"的活力。

用户诉求：让弟子也会"出门游历"，且游历应与修炼进度挂钩——**闭关最多只能积累一部分进度，剩余必须靠游历补足**，
游历是后续模拟"大世界机缘、厮杀、夺宝"的入口。

难点：游历没有单一固定属性目标，难以直接表达为 GOAP 的 `goalState`。

## 决策

### 1. 突破进度双源化（让 GOAP 自然推导出游历）

突破总进度拆为两个来源，**相加制**：

```
totalProgress = cultivationProgress（闭关）+ insight（游历感悟）
突破条件：totalProgress >= 1.0
```

- 闭关进度 `cultivationProgress` 有**境界上限 `cultivationCap`**（见 `cultivation.json`）：低境界 1.0、越高越低（化神 0.3）。
- 游历感悟 `insight` 只能通过 `act_npc_explore` 积累，无闭关来源。
- 修炼需求 `goalState` 改为 `totalProgress >= 1.0`。

**关键机制**：闭关行为(`act_npc_cultivate`/`act_npc_train_chamber`)的 GOAP 前置注入动态 cap：`cultivationProgress < cap`。
当 A* 搜索把 `cultivationProgress` 推到 cap 后，闭关前置不再满足，A* 只能转而选游历(产出 insight)继续推进 totalProgress。
**因此无需独立的"游历需求"——游历由现有"修炼需求"在闭关撞顶后自然涌现。** cap 前置在实体 `_initActions`
按当前境界注入，突破后 `refreshCultivationCapPreconditions()` 重新注入。

`totalProgress` 作为派生字段：在 `NPCState.set('cultivationProgress'|'insight')` 时自动重算落库（供数据驱动需求评估器读取），
并在 `toGOAPState()` 注入（供 GOAP 使用）。

### 2. 游历机缘事件表（数据驱动，预留扩展）

`act_npc_explore` 归来时按 `cultivation.actions.explore.fortuneEvents` 加权 roll 一次事件：
平安归来 / 略有感悟 / 顿悟机缘 / 洞天福地 / 拾得遗宝。每个事件含 `insightMultiplier`/`qiMultiplier`。
当前事件仅产出 insight/真气；洞天福地、遗宝预留后续扩展（修炼加速 buff、掉落法宝/材料/药草进 inventory）。

GOAP 的 explore effect 取 insight 保守期望值(0.005)，使其每单位进度代价高于闭关，
保证低境界弟子优先廉价闭关、撞顶后才游历。

### 3. 风险系统（独立配置表 risk.json，权重 + 性格加成）

新建 `data/balance/risk.json`。游历归来时逐项独立结算风险分项：

| 分项 | 效果 | 受境界减免 | 性格加成 |
|------|------|-----------|---------|
| 受伤风险 | injuryLevel + | 是(rankMitigation) | courage↑→概率↑ |
| 资源掉落风险 | 扣灵石 | 否 | — |
| 职位挑战失败风险 | morale - | 否 | —（预留，baseChance=0） |
| 死亡风险 | 真死亡(走继任流程) | 是 | courage≥70→概率↑ |

- 每分项触发概率 = `baseChance × 境界减免 × (1 + 性格加成)`，逐项独立 roll。
- `totalRisk` = 各分项 baseChance 之和（用于展示"总风险百分比"）。
- 性格加成数据驱动：`personalityModifiers` 引用 `personality.json` 新增的 `courage`(勇敢) 维度。
- 死亡风险初期权重很低(0.005)，避免大量减员；后续按目的地危险度/战力差放大。

## 代码位置

- 配置：`data/balance/cultivation.json`(cultivationCap/fortuneEvents)、`data/balance/risk.json`(新)、`data/balance/personality.json`(courage)
- 行为：`data/actions/npc-actions.json`（闭关 cap 前置、游历产 insight）
- 需求：`data/needs/npc-needs.json` + `js/engine/npc/npc-needs.js`（goalState 改 totalProgress）
- 状态：`js/engine/npc/npc-state.js`（insight、totalProgress 同步、toGOAPState 注入）
- 执行器：`js/engine/npc/npc-actions.js`（NPCExploreExecutor 机缘表+风险结算、闭关 cap 封顶、settleRisk 助手）
- 实体：`js/engine/npc/npc-entity.js`（cap 前置动态注入、突破用 totalProgress、突破后重置 insight）
- 移动：`js/engine/world/tick-manager.js`（补全 `_randomWanderTarget` 实现 wander_far 解析）
- 加载：`js/core/config-loader.js` + `js/engine/world-engine.js`（接入 balanceRisk）

## 后果

- 正面：游历由 GOAP 自然涌现，无需特殊需求；闭关上限/风险/机缘全部数据驱动，可调可扩展。
- 正面：为后续"大世界机缘、厮杀、洞天福地、法宝材料药草"提供统一入口（机缘事件表 + 风险分项）。
- 风险：游历持续 90 天且修炼极慢，弟子需很长时间才会撞顶触发游历——属预期（修为本就漫长），可按需调 cap/速度。
- 风险：分析工具 `simulate-analysis.mjs` 此前未传 balance 配置，本次已补齐使其与真实游戏一致。

## 待扩展

- 洞天福地的限时修炼加速 buff；遗宝掉落法宝/材料/药草进 inventory。
- 职位挑战失败风险接入真实战力对比；游历途中 NPC 间厮杀。
- 目的地危险度分级（不同区域风险权重不同）。
- 更多性格维度对风险/机缘的加成（如谨慎↓受伤、机敏↑机缘）。
