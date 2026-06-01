# ADR-030：核心引擎类重构（tick-manager / npc-actions / npc-entity 按职责拆分）

最后更新：2026-06-01

状态：已实现（三个上帝类按单一职责拆分为服务/策略/协作者模块，对外接口不变，行为零漂移）

## 背景

体检报告 `docs/reports/2026-05-30-项目分析与下一步建议.md`（P2 节）识别出三个严重违反单一职责（SRP）的"上帝类"，按行数统计：

- `tick-manager.js`（2139 行）：tick 主循环 + 全套势力 AI（扩张/攻伐/结盟/贸易/军事计算，内联在约 400 行的 `_buildWorldContext`）+ 晋升/月考/宗门活动 + 死亡收集 + 婚育 + 信息传播/觊觎 + 妖兽重生 + 寻路工具，至少 8 大职责挤在一个类。
- `npc-actions.js`（1552 行）：约 30 个 `ActionExecutor` 类 + 共享 helper，混合修炼/任务/经济/PvP/机会/流派/师徒所有业务域。
- `npc-entity.js`（1010 行）：实体构造 + 目标抽取 + 突破/死亡/继任 + 执念触发，业务逻辑与实体定义混杂。

项目对"行为零漂移"极度敏感（满是黄金指纹回归保证）。`npc-utility.js`（ADR-021）已是一个成功范例：把决策逻辑抽成纯函数模块 `decorateGoalConsiderations(entity, goal, worldContext, config)`，`NPCEntity` 只保留一行转发。本次重构全程复用此范例。

## 决策

按单一职责把三个类拆分为边界清晰、可独立扩展和测试的模块；**对外接口保持不变**（调用方零改动），以黄金指纹 + 重构基线指纹双重回归保证零漂移。

### 保持不变的接口契约（红线）

- `planner-node.js` 鸭子调用 `entity.collectExtraGoals()` / `modulateGoal()` / `decorateGoalConsiderations()`。
- `tick-manager.js` 鸭子调用 `npc.recordMemory()` / `faction.onPreTick()` / `entity.tick()`。
- `world-engine.js` 调用 `tickManager.tick()` / `multiTick()` / `getTickHistory()`，并通过 `_createTickManager()` 注入 20+ 依赖；`import { registerNPCExecutors } from './npc/npc-actions.js'` 路径不变。
- `simulate-analysis.mjs` 读 `engine.tickManager.companionLog/birthLog`（在 TickManager 上保留 getter 转发）。
- 单测直接调用的方法保持可用：`tickManager._spawnNewsFromEvents`（委托 InfoCoordinator）、`NPCHuntEnemyExecutor`/`NPCKillEnemyExecutor`/`killNPCByPvP`（从 `npc-actions.js` re-export）、`npcEntity._checkSeizeDiscipleObsession`（一行转发）。

### 一、tick-manager.js 拆分（最高优先级）

保留 `TickManager.tick()` 的 11 步模板方法骨架（好的模板方法模式），把每步实现委托给独立服务。新增目录 `engine/world/services/`：

| 服务 | 职责 | 吸收的原方法 |
|------|------|-------------|
| `world-context-builder.js` | 每 tick 装配纯数据 `worldContext`（worldState/registry/config/index/各子系统引用 + 转发回调） | `_buildWorldContext` 的对象装配部分 |
| `faction-ai-service.js`（策略） | 全套势力决策（扩张/攻伐/结盟/贸易/威胁与军事计算/`promoteByLadder`） | `_buildWorldContext` 内联的势力 AI 回调 |
| `promotion-service.js` | 晋升底层原语 + 月考/宗门活动/晋升定时事件 | `_setRole`/`_promoteRole`/`_applyPromote`/`_processMonthlyContribution`/`_processSectEvents`/`_processPromotions`/`_countRolesInFaction`/`_factionRoleQuota` 等 |
| `population-service.js` | 婚配/生育，持有 `birthLog`/`companionLog` | `_matchDaoCompanions`/`_processBirths` |
| `death-collector.js` | 死亡收集、遗志继承、关系图清理 | `_collectDeaths` 及遗志继承逻辑 |
| `info-coordinator.js` | 信息传播/机会/觊觎编排（编排既有 `InfoPropagationSystem`/`OpportunitySystem`） | `_tickInfoSystems`/`_spawnNewsFromEvents`/`_propagateChannels`/`_tickCovet`/`_enrichInfoEvents` |
| `monster-respawn-service.js` | 妖兽重生 + 入群 | `_respawnMonsters`/`_linkRespawnedToPacks` |

- `TickManager` 在构造时实例化这些服务并注入依赖（传 `this` 作为 `host`），服务通过 `this.host` 调用 TickManager 保留的共享底层工具（`_entityPos`/`nearestTerrainTile`/`_npcCombatPower`/`_resolveRevengeTarget` 等），保持 `this` 绑定语义与零漂移。
- `tick()` 只负责按序调用服务（`this.deathCollector.collect(tickLog)` 等）；`setFactionAI`/`getTickHistory`/`getLatestTick` 等公共方法保留。
- `birthLog`/`companionLog` 改为委托 `populationService` 的 getter；`_bestOpportunityFor`/`_spawnNewsFromEvents` 保留薄转发以兼容 `WorldContextBuilder` 与现有测试。
- 结果：`tick-manager.js` 由 2139 行降至约 734 行。

### 二、npc-actions.js 拆分

按业务域把约 30 个 Executor 拆到 `engine/npc/actions/`，共享 helper 提取到 `npc-action-utils.js`（`settleRisk`/`applyRiskEffect`/`computeActionValue`/`estimateRiskCost`/`rollAndGrantReward`/`killNPCByPvP`/配置读取/任务候选筛选 等）：

| 文件 | Executor |
|------|----------|
| `cultivation-actions.js` | Cultivate / TrainChamber / SeekElixir / Challenge / Heal |
| `quest-actions.js` | AcceptQuest / DoQuest / TurnInQuest（含猎妖结算） |
| `economy-actions.js` | DonateMaterials / Redeem*/Use* 系列 |
| `combat-actions.js` | ServeFaction / AssistFaction / Explore / HuntEnemy / KillEnemy / RaidTreasure |
| `archetype-actions.js` | Seclude / TakeDisciple / SeizePower（流派执念 ADR-023） |
| `relationship-actions.js` | GotoOpportunity / AssistAlly / VisitBenefactor / TeachDisciple / ProtectDisciple / VisitMaster（ADR-024/028/029） |

- `npc-actions.js` 退化为**统一注册入口 + re-export 门面**：`registerNPCExecutors()` 聚合各域 Executor 按原顺序注册；并 re-export 全部 Executor 与共享工具（`estimateRiskCost`/`computeActionValue`/`computeDecisionCost`/`killNPCByPvP`/`rollAndGrantReward`），使 `npc-entity.js`/`npc-utility.js`/`info-actions.js`/单测的历史导入路径 `'./npc-actions.js'` 全部继续可用。
- `npc-entity.js` 原 `import { estimateRiskCost, computeActionValue }`（实际未使用）一并清理。
- 结果：1552 行拆为 1 个工具文件（401 行）+ 6 个域文件（最大 291 行）+ 143 行门面。

### 三、npc-entity.js 拆分

`NPCEntity` 已用组合模式持有 `memory`/`obsessions`/`emotions`/`relationships` 子系统（保留）。把内联业务逻辑提取为纯函数协作者（仿 `npc-utility.js`），Entity 保留一行转发：

| 模块 | 导出纯函数 | NPCEntity 转发方法 |
|------|-----------|-------------------|
| `npc-goals.js` | `collectExtraGoals` / `relationshipGoalsEnabled` / `buildRelationshipGoals` / `considerMasterDiscipleGoals` / `checkSeizeDiscipleObsession` / `buildOpportunityGoal` | `collectExtraGoals` / `_buildRelationshipGoals` / `_checkSeizeDiscipleObsession` / `_buildOpportunityGoal` |
| `npc-lifecycle.js` | `tryBreakthrough` / `getBreakthroughRate` / `handleDeath` / `triggerSuccession` / `successionScoreOf` | `_tryBreakthrough` / `_handleDeath` |
| `npc-obsession-trigger.js` | `rollInnateObsession` / `checkAcquiredObsession` / `checkConditionalObsession` / `matchStateCondition` | `_rollInnateObsession` / `_checkAcquiredObsession` / `_checkConditionalObsession` |

- 全部纯函数以 `entity` 为首参，仅读写 `entity` 的子系统/状态/配置，并回调其自身保留的方法（如 `entity.refreshCultivationCapPreconditions()`/`entity._rollBreakthroughPathOrder()`），不改变任何随机序列或写入顺序。
- `inheritMasterLegacy`/`_refreshRevengeState`/`_refreshRelationshipState`/`_refreshEconomyMaterialState`/初始化 helper 等仍留在 `NPCEntity`（与实体定义强耦合）。
- 结果：`npc-entity.js` 由 1010 行降至约 608 行。

## 设计模式映射

- **模板方法**：`TickManager.tick()` 保留 11 步骨架，步骤实现委托服务。
- **策略**：`FactionAIService` 承载势力决策，预留按 `factionType` 扩展（OCP）。
- **组合 + 委托（Mixin/Host）**：服务持有 `host`（TickManager）引用调用其共享工具，保持 `this` 语义。
- **纯函数协作者**：npc-goals/lifecycle/obsession-trigger 以 entity 为首参，Entity 一行转发（同 `npc-utility.js`）。
- **门面（Facade）/ Re-export**：`npc-actions.js` 退化为注册入口 + 兼容门面，减小改动面。

## 数据与接口

- 新增 `apps/game/js/engine/world/services/`：`world-context-builder.js` / `faction-ai-service.js` / `promotion-service.js` / `population-service.js` / `death-collector.js` / `info-coordinator.js` / `monster-respawn-service.js`。
- 新增 `apps/game/js/engine/npc/actions/`：`npc-action-utils.js` / `cultivation-actions.js` / `quest-actions.js` / `economy-actions.js` / `combat-actions.js` / `archetype-actions.js` / `relationship-actions.js`。
- 新增 `apps/game/js/engine/npc/`：`npc-goals.js` / `npc-lifecycle.js` / `npc-obsession-trigger.js`。
- 改写 `apps/game/js/engine/world/tick-manager.js`（编排骨架 + 共享工具 + 公共方法/getter 转发）。
- 改写 `apps/game/js/engine/npc/npc-actions.js`（注册入口 + re-export 门面）。
- 改写 `apps/game/js/engine/npc/npc-entity.js`（实体定义 + 组合子系统 + 一行转发）。
- 不改动任何数据 JSON、不改动任何对外 API 签名。

## 后果

- 三个上帝类按单一职责落地：每个文件聚焦一个业务域，便于独立扩展（新增势力类型/新行为/新 tick 步骤只加文件，不改骨架）与独立测试。
- 调用方零改动：`world-engine.js`/`planner-node.js`/单测的导入路径与调用签名全部不变。
- 严格零漂移：拆分为纯代码搬移 + 委托/转发，未改任何逻辑、随机序列与写入顺序。
- 引入临时回归工具 `tools/refactor-baseline.mjs`（确定性 PRNG + 紧凑指纹），与 GOAP 黄金测试互补，覆盖整个 tick 编排；其头部固化了本次基线指纹，供后续重构比对。

## 验证

- `node apps/game/tools/test-goap-golden.mjs` 指纹 **`5740e12a`**，三个类拆分后均保持不变（与 ADR-029 基线一致）。
- `node apps/game/tools/refactor-baseline.mjs 200`（默认态 `4f9cf473`）、`MODE=utility`（`caf46512`）、`MODE=info`（`56720249`）三态指纹，在 npc-actions 与 npc-entity 拆分后均断言通过（`refactor-baseline.mjs 200 <指纹>` 退出码 0）。
- 全量单测全绿（17 项）：`test-bt`/`test-goal-equivalence`/`test-goap-golden`/`test-info-propagation`/`test-jps`/`test-master-disciple`/`test-memory`/`test-monster-resource-loop`/`test-npc-consumption-chain`/`test-obsession`/`test-quest-reward-economy`/`test-relationship-goals`/`test-relationship`/`test-revenge`/`test-utility-divergence`/`test-utility`/`verify-promotion`。

## 相关

- 体检报告 `docs/reports/2026-05-30-项目分析与下一步建议.md`（P2：上帝类问题）。
- ADR-021（Utility-GOAP 职责分离）——`npc-utility.js` 是本次"纯函数模块 + Entity 一行转发"范例的来源。
- `docs/architecture/design-patterns.md`（策略/模板方法/组合）与 `docs/architecture/file-structure.md`（新目录职责）已同步。
