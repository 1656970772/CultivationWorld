# ADR-010：修炼场修炼行为（贡献换修炼加速）

> 日期：2026-05-29
> 状态：已接受 · 已实现 · 后续在 ADR-011 中由"可选优化"升级为"晋升刚需"（加速 25%→100%）
> 关联：ADR-008（建筑功能化与行为目标分散）、ADR-005（需求驱动 GOAP 架构）、ADR-011（修炼激励系统）

> **ADR-011 更新（2026-05-29）**：修炼场加速由 **+25% 提升至 +100%**（`speedBonusMultiplier: 2.0`），同时大幅拉长普通闭关耗时（约寿元 120%），使赴修炼场从"可选权衡"变为"正常晋升的刚需"。下文 25%/1.25 为历史值，现行值见 ADR-011 与 `cultivation.json`。

## 背景

ADR-008 为修炼场（`training`）建筑在 `TickManager.resolveTarget` 中补齐了目标解析分支，但当时把"修炼"行为留作 `self`（洞府原地闭关），**没有任何行为的 `targetResolver` 指向 `training`**。结果是修炼场建筑可见、可解析，却没有任何 NPC 会去——属于 ADR-008 自己点名的"可见但无功能"遗留。

用户诉求：让修炼场具备真实功能，并给角色一个**可选**的权衡——是免费原地闭关，还是花费门派贡献去修炼场加速修炼。

## 决策

新增 NPC 行为 `act_npc_train_chamber`（赴修炼场修炼）：

1. **目标指向修炼场**：`targetResolver: "training"`、`requiresTravel: true`，复用 ADR-008 的建筑解析（同势力就近选修炼场，缺失回退总部）。
2. **消耗门派贡献**：`preconditions` 要求 `hasFaction === true` 且 `contribution >= trainChamber.contributionCost`（默认 10）。贡献点来源于宗门弟子交付任务（见 `NPCTurnInQuestExecutor`），此前只增不减，本行为是其首个消耗出口。
3. **修炼速度 +25%**：执行器读取 `cultivation.json → actions.trainChamber.speedBonusMultiplier`（默认 1.25），作为额外倍率注入修炼速度。
4. **执行器复用核心逻辑**：`NPCTrainChamberExecutor extends NPCCultivateExecutor`，仅注入 `extraSpeedMultiplier` 与描述前缀，并在执行时扣减 `contribution`（单一职责 + 开闭：核心修炼计算不重复实现）。贡献不足时兜底回退为普通闭关，不扣贡献、无加成。

配置（`cultivation.json → actions.trainChamber`）：

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `contributionCost` | 10 | 单次赴修炼场消耗的门派贡献点 |
| `speedBonusMultiplier` | 1.25 | 修炼速度倍率（+25%） |

> 注意：`contributionCost`（配置）需与 `act_npc_train_chamber` 的 `contribution.gte` 前置阈值保持一致，二者目前均为 10。

## 后果

### 正面
- 修炼场建筑获得真实功能，地图上不再"可见但无人去"。
- 宗门贡献点有了消耗出口，"做任务攒贡献 → 花贡献加速修炼"形成正向循环，散修（无贡献、无势力）自然被该行为排除。
- 行为对散修无副作用（`hasFaction` 前置拦截），保留其"洞府闭关 / 悬赏谋生"的既有节奏。

### 规划倾向（weight 调校）
- **当前 GOAP 规划代价不含移动距离**：`getPlanCost() = weight + (duration - 1)`，未使用 `distanceCostPerTile`。
- 为让"有贡献的弟子优先去修炼场加速"，将 `act_npc_train_chamber` 的 `weight` 设为 **0.5**（低于 `act_npc_cultivate` 的 1）。二者 `duration` 同为 30，故规划代价为：
  - `act_npc_cultivate` = `1 + 29` = **30**
  - `act_npc_train_chamber` = `0.5 + 29` = **29.5**
- 结果：弟子 `contribution >= 10` 时 GOAP 优先选修炼场（代价更低）；贡献不足时前置条件拦截、自动回退原地闭关。差值仅 0.5，不会盖过其它行为之间的代价差异。

### 已知局限
- 规划代价仍未纳入实际移动距离，修炼场距离远近不影响选择倾向。若后续要让"远修炼场不如就近闭关"，需在规划代价中真正纳入 `distanceCostPerTile × 距离`。
- 建筑坐标在初始化后固定，若领地动态迁移需同步 `_factionBuildings`（沿用 ADR-008 的既有约束）。

## 涉及文件
- 改 `apps/game/js/engine/npc/npc-actions.js`（`NPCCultivateExecutor` 抽出可注入速度倍率；新增 `NPCTrainChamberExecutor` 并注册 `npc_train_chamber`）
- 改 `apps/game/data/actions/npc-actions.json`（新增 `act_npc_train_chamber` 行为定义）
- 改 `apps/game/data/balance/cultivation.json`（新增 `actions.trainChamber` 参数）
- 改 `apps/game/js/engine/npc/npc-entity.js`（默认 `actionIds` 加入 `act_npc_train_chamber`）
- 改 `docs/decisions/adr-008-building-function-and-action-routing.md`（补充说明遗留点）
