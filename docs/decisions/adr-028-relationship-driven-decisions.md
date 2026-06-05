# ADR-028：关系驱动决策（关系网二期：NPC 关系 Goal + 妖群/领地）

最后更新：2026-06-01

状态：已实现（第二期：关系边驱动 NPC Goal / 妖兽护群护领地，默认开、可回退）

## 背景

ADR-027（第一期）建立了世界级 `RelationshipSystem` 单一真相源——随事件维护人际/人妖/妖妖三层关系边、衰减、可视化、存档，但**明确不驱动决策**。第一期遗留两项最高优先待办（见 `关系系统后续扩展项`）：

1. **关系驱动的 Goal/行为**：关系边只记录、不影响 NPC/妖兽行为。
6. **妖群/领地关系自动建边**：`pack_member`/`territory_threat` 类型仅预留，无自动建边与对应行为。

二期让这些边**真正驱动决策**，范围与启用方式经用户确认。

## 决策

### 范围与启用（用户定调）

- **范围**：`关系系统后续扩展项` 第 1 项（关系驱动 Goal/行为）+ 第 6 项（妖群/领地自动建边）。其余（信任度/背叛、隐秘关系暴露、灵宠养成、化形建势力、跨图重建）仍留待后续。
- **启用**：新增 `relationship.json -> goalsEnabled`，**默认开（直接全量启用，可回退）**。`goalsEnabled=false` 回退一期纯数据态。`simulate-analysis` 支持 `RELATIONSHIP_GOALS_ACTIVE=1/0` 环境覆盖做对照。
- **复仇取向**（用户定调）：多数恩怨为利益/面子 → 走**现有复仇链**（`_resolveRevengeTarget` 已读 `topGrudge()`）；唯有"深关系被杀"（道侣/血亲/师徒）才升格为**执念**（沿用 `companion_lost`→执念路径）。故二期**不另造复仇系统**，仅补全复仇链：把 `act_npc_hunt_enemy`/`act_npc_kill_enemy` 纳入默认行为池，并让 `_resolveRevengeTarget` 也认高强度 `enemy` 边。
- **妖群生成**（用户选 force_swarm）：`swarmBehavior=true` 物种在生成时强制成簇；其余物种按 `family` + 老巢邻近有机建 `pack_member` 边。
- **领地防御取向**（用户定调）：仅 tier2+ 妖兽触发领地防御（强者入侵也群起而攻），tier1 维持纯本能只猎弱者，避免低阶妖兽冲高阶修士送死。

### 一、配置与开关（数据驱动）

`relationship.json` 顶层新增 `goalsEnabled` 与三段参数块：

- `npcGoals`：`assistSectMate`（护短同门：`priority`/`minSectAffinityStrength`/`maxAssistRange`）、`repayBenefactor`（报恩：`priority`/`minBenefactorStrength`/`visitChancePerTick`）、`relationRevenge`（关系复仇：`priority`/`minEnemyStrength`）。
- `monsterPack`：`packRadius`/`buildPackLeader`/`swarmClusterRadius`/`swarmClusterSize`/`maxPackSize`。
- `territory`：`defendEnabled`/`minTierForDefense`/`intrusionUsesWanderRadius`/`intrusionRadius`。

新增 `eventBindings`：`pack_init`（pack_member）、`pack_leader_init`（pack_leader）、`territory_intrusion`（territory_threat）。

`goalsEnabled` 判定遵循一期 `enabled` 风格（`!== false` 为开）。`NPCEntity` 存 `this._relationshipConfig`；`TickManager`/`WorldEngine` 各有 `_relationGoalsEnabled()` 总开关助手（数据层 enabled 且 goalsEnabled 且系统就绪）。

### 二、NPC 关系驱动 Goal（`npc-entity.js`）

- `goal.js` 新增 `GoalSource.RELATIONSHIP`。
- `collectExtraGoals` 末尾追加 `_buildRelationshipGoals(worldContext)`：`goalsEnabled` 关或无 qualifying 边时返回 `null`（**默认关闭不改变既有行为**：无合格关系即不产出，等价主路径）。仿机会 Goal **单点锁定**（按优先级取最高一个，写 `state.targetRelationshipId`）：
  - **护短同门 `goal_assist_sect_mate`**：高强度 `same_sect`/`ally` 对象本 tick 陷入争斗（`hasRevengeTarget=true`）且在 `maxAssistRange` 内 → 前往支援（`goalState: { assistedAlly: true }`）。
  - **报恩 `goal_repay_benefactor`**：对高强度 `benefactor`/`gratitude` 对象，按 `visitChancePerTick` 低频探望（`goalState: { visitedBenefactor: true }`）。
  - **关系复仇**：不新建 Goal，而是确保复仇链可跑——默认行为池补 `act_npc_hunt_enemy`/`act_npc_kill_enemy`，并让 `_resolveRevengeTarget` 在 `enemy` 边强度 ≥ `minEnemyStrength` 时纳入复仇目标。
- `onPreTick` 增 `_refreshRelationshipState`（紧邻 `_refreshRevengeState`）：关系对象死亡/失联即清空 `targetRelationshipId`，关系行为链前置失效，GOAP 自然回归日常。
- `_initActions` 默认池补入 `act_npc_hunt_enemy`/`act_npc_kill_enemy`/`act_npc_assist_ally`/`act_npc_visit_benefactor`（均由关系 Goal/复仇派生状态 gate，默认关闭不改变既有行为）。

### 三、新增 Action + Executor + Resolver

- `npc-actions.json`：`act_npc_assist_ally`（`relationship_target`，`effects:{assistedAlly:true}`，`riskKey:pvp`）、`act_npc_visit_benefactor`（`relationship_target`，`effects:{visitedBenefactor:true}`，`riskKey:null`）。
- `npc-actions.js`：`NPCAssistAllyExecutor`（抵达后加深 `same_sect` 情谊）、`NPCVisitBenefactorExecutor`（抵达后加深 `gratitude`），在 `registerNPCExecutors` 注册。
- `tick-manager.js` `resolveTarget` 增 `relationship_target` case：读 `state.targetRelationshipId` → 注册表 → tile。

### 四、妖兽 pack_member/territory_threat 自动建边

- `relationship-init.js` 新增 `initMonsterRelationships(rs, monsters, packConfig)`：同 `family` 且老巢距离 ≤ `packRadius` 互建 `pack_member`（对称），簇内最高 grade 建 `pack_leader` 臣服边。`world-engine._createMonsters` 后调用（仅 goalsEnabled）。
- **群居成簇生成**：`monster-spawner.js` 对 `swarmBehavior===true` 物种，在落点 `swarmClusterRadius` 内补刷 `swarmClusterSize-1` 只同种（受 `totalMonsters` 上限约束）。`monsterPackConfig` 为 `null`（goalsEnabled 关）时不成簇（一期散点）。
- **领地威胁**：`monster-entity._senseTerritory`（挂在 `monsterSense` 内，仅 goalsEnabled）对进入 `home±wanderRadius` 的 NPC 经 `worldContext.recordTerritoryThreat` 建 `territory_threat` 边（`decay=2` 使 NPC 离开后自然消失），并缓存最近入侵者到 `state.intruderNpcId`。
- **种群补刷并入**：`tick-manager._respawnMonsters` 增 `_linkRespawnedToPacks`，把新生妖兽与同 family 邻近妖兽建 `pack_member` 边。

### 五、妖兽护群/护领地行为（`monster-bt-presets.js` + `monster-entity.js`）

- `monsterCallPack` 从计数 stub 升级为**协防**：goalsEnabled 时读 `edgesOfType(self, 'pack_member')`，把本兽当前目标同步给附近**空闲**同群妖兽（群起而攻）。关闭时仅计数（回退一期）。
- 新增 `monsterDefendTerritory` 钩子（tier2/tier3 BT 的 `repel-intruder` 分支）：存在 `intruderNpcId` 且本兽 tier ≥ `minTierForDefense` 时，锁定入侵者为目标（**区别于 `_findPrey` 的弱猎物——强者入侵领地也会被攻击**）。tier1 不变（纯本能）。
- 全部受 `relationship.json` gate；关闭时妖兽 BT 回退一期纯猎食/巡逻（`monsterDefendTerritory` 返回 FAILURE 整支跳过）。

### 六、Utility 调制 + 仿真开关（可选增益，受 utility.enabled 约束）

- `utility.json` `considerationsBySource` 增 `goal_assist_sect_mate`（修为越足越敢驰援）、`goal_repay_benefactor`（恒定低风险善举）。仍受 `utility.enabled`（默认 false）二级开关，不强制。
- `npc-utility.js` `DEFAULT_GOAL_RISK_KEYS` 为 `goal_assist_sect_mate` 映射 `pvp` 风险键。
- `simulate-analysis.mjs`：增 `RELATIONSHIP_GOALS_ACTIVE` 环境覆盖；报告输出关系边类型统计（人际/妖群/领地）与驰援/探望触发计数。
- `simulation-main.js` goalSource 标签增 `relationship → '关系'`、`opportunity → '机会'`。

## 数据与接口

- `apps/game/data/balance/relationship.json`：新增 `goalsEnabled` + `npcGoals`/`monsterPack`/`territory` 段 + 3 个 `eventBindings`。
- `apps/game/data/actions/npc-actions.json`：新增 `act_npc_assist_ally`/`act_npc_visit_benefactor`。
- `apps/game/data/balance/utility.json`：新增 `goal_assist_sect_mate`/`goal_repay_benefactor` 考量因素。
- `apps/game/js/engine/abstract/goal.js`：`GoalSource.RELATIONSHIP`。
- `apps/game/js/engine/npc/npc-entity.js`：`_relationshipConfig` + `_buildRelationshipGoals` + `_refreshRelationshipState` + 默认行为池补全。
- `apps/game/js/engine/npc/npc-actions.js`：`NPCAssistAllyExecutor`/`NPCVisitBenefactorExecutor`。
- `apps/game/js/engine/npc/npc-utility.js`：风险键映射。
- `apps/game/js/engine/npc/npc-state.js`：`targetRelationshipId`/`assistedAlly`/`visitedBenefactor`。
- `apps/game/js/engine/world/relationship-init.js`：`initMonsterRelationships()`。
- `apps/game/js/engine/world/tick-manager.js`：`_relationGoalsEnabled` + `relationship_target` resolver + `_resolveRevengeTarget` 认 enemy 边 + `recordTerritoryThreat`/`relationGoalsEnabled` worldContext + `_linkRespawnedToPacks` + worldContext 暴露 `relationshipConfig`。
- `apps/game/js/engine/monster/monster-entity.js`：`_senseTerritory` + `monsterCallPack` 协防 + `monsterDefendTerritory`。
- `apps/game/js/engine/monster/monster-state.js`：`intruderNpcId`。
- `apps/game/js/engine/monster/monster-spawner.js`：`monsterPackConfig` + 群居成簇 `_spawnSwarmCluster`。
- `apps/game/js/engine/monster/monster-bt-presets.js`：tier2/tier3 增 `repel-intruder` 分支。
- `apps/game/js/engine/world-engine.js`：`_relationshipGoalsEnabled` + 传 `monsterPackConfig` + 调 `initMonsterRelationships`。

## 后果

- 关系边从"只记录"升级为"驱动决策"：同门驰援、知恩图报、关系复仇、妖群协防、领地驱逐成为可涌现行为。
- 默认开但严格默认关闭不改变既有行为：无 qualifying 关系边时不产出 Goal（等价主路径）；`goalsEnabled=false` 完整回退一期。
- 妖兽生态更立体：群居物种天然成群、领地意识（强者入侵也护territory）。
- 200 天端到端（默认 + 激活态）无报错；妖群/领地边自然涌现（pack_member ~310、territory_threat ~95，随机种子浮动）。

## 验证

- `node apps/game/tools/test-relationship-goals.mjs`（关系 Goal 产出/开关/驰援范围/enemy 门槛/失效清理/妖群建边/成簇/领地建边衰减，23 项）。
- 回归：`test-relationship.mjs`、`test-revenge.mjs`、`test-goal-equivalence.mjs`（400 用例默认关闭不改变既有行为）、`test-obsession.mjs`、`test-bt.mjs`、`test-utility.mjs`、`test-memory.mjs` 全绿。
- `test-goal-equivalence.mjs` 摘要 `16c7c409`（新增 2 个关系行为后的新基线；`test-goal-equivalence` 400 用例确认现有目标规划路径默认关闭不改变既有行为——摘要变化仅因行为数+键集合变化导致 PRNG 采样错位，属"新增行为数据后应重新基线"的预期变更，参考 ADR-023）。
- `node apps/game/tools/simulate-analysis.mjs --days=200` 默认跑确认无报错、妖群/领地边涌现（实测 pack_member=314 / pack_leader=1 / territory_threat=95）；`RELATIONSHIP_GOALS_ACTIVE=0` 确认 pack_member=0 / pack_leader=0 / territory_threat=0（人际边不受影响，默认关闭不改变既有行为回退）。

## 相关

- ADR-027（关系网第一期：数据层）——本 ADR 在其上叠加决策驱动。
- ADR-020（Consideration Utility + 复仇 PvP）——关系复仇复用其 `_resolveRevengeTarget` 与复仇行为链。
- ADR-024（信息传播与机会点）——关系 Goal 接入方式参考机会 Goal（查询→锁目标→resolver→executor）。
- 世界观参考：凡人修仙传（同门情谊/恩怨/族群报复）、遮天（妖兽领地守卫/族群）。

