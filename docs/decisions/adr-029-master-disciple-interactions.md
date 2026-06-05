# ADR-029：师徒互动（关系网三期：传功/护徒/尽孝/继承遗志/夺舍）

最后更新：2026-06-01

状态：已实现（第三期：师徒关系边驱动 NPC 行为与遗志继承，默认开、可回退）

## 背景

ADR-027（一期）建立世界级 `RelationshipSystem` 单一真相源，ADR-028（二期）让关系边**驱动决策**（同门驰援、报恩、关系复仇、妖群协防、领地驱逐）。`master`/`disciple` 边在一期已由 `relationship-init.js` 按势力角色自动建立（掌门/长老→弟子），但二期**未让师徒边驱动任何专属行为**——师徒关系仅记录、不影响行为。

`关系系统后续扩展项` 将"师徒互动"列为后续主题。三期落地师徒关系的双重性（参考凡人修仙传"传承不仅是功法，更是意志的延续"，以及墨大夫"以收徒为名行夺舍之实"的阴暗面），范围与机制经用户确认。

## 决策

### 范围与机制（用户定调）

用户选定"师徒互动"为三期范围，并逐项确认六类行为：

1. **师傅传功（护徒·点化）**：师傅给徒弟 `insight`（游历感悟）增量助推突破（用户在"临时加速 buff"与"感悟增量"间**选感悟增量**，因其与既有 `totalProgress = cultivationProgress + insight` 突破机制天然契合）。
2. **师傅护徒（驰援）**：徒弟遭袭时师傅前往护卫（复用二期护短同门同款逻辑，优先级/范围更高）。
3. **徒弟尽孝（探望）**：徒弟低频探望师傅（复用二期报恩同款）。
4. **继承遗志·复仇**：师傅被杀，徒弟对凶手复仇（复用既有复仇链）。
5. **继承遗志·执念延续**：徒弟继承师傅未竟的非复仇执念（如夺宝/证道/长生），体现意志延续。（用户确认 4+5 **两者都要**。）
6. **夺舍（轻度）**：邪修师傅对高资质徒弟起"夺舍"执念→复用复仇击杀链夺其根基。（用户确认**先轻度实现、留待后续深挖成"夺舍流派"**。）

**核心原则**：复用二期成熟模式，**不引入新系统**，只在既有扩展点挂钩；全程受 `relationship.json -> goalsEnabled` gate，无 qualifying `master`/`disciple` 边即不产出（**默认关闭不改变既有行为**）。

### 行为→机制映射

| 行为 | 触发 | 复用机制 |
|------|------|----------|
| ① 师傅传功 | 高强度 `master` 边 + 徒弟修为偏低(`cultivationProgress+insight < 0.6`)且在范围(≤20) | 二期 Goal 单点锁定模式：`goal_teach_disciple` → `relationship_target` resolver → 新 `act_npc_teach_disciple` executor 给徒弟 `insightGain`(0.12) + 加深情谊 |
| ② 师傅护徒 | 徒弟遭袭(`hasRevengeTarget`)且在范围(≤24) | `goal_protect_disciple`（priority 8，高于护短同门6、传功7；范围 24 > 同门18）→ 新 `act_npc_protect_disciple` executor |
| ③ 徒弟尽孝 | 高强度 `disciple` 边，低频(0.02/tick) | `goal_visit_master`（priority 4）→ 新 `act_npc_visit_master` executor |
| ④ 继承遗志·复仇 | 师傅被杀 | `_collectDeaths` 钩子 → 徒弟 `inheritMasterLegacy` 写 `master_lost` 记忆 → `obsession.json acquired` 触发 `revenge` 执念（仿 `companion_lost`） |
| ⑤ 继承遗志·执念延续 | 师傅被杀（同上） | 把师傅未竟非复仇执念(`inheritableObsessionTypes`)按 `inheritObsessionIntensityMult`(0.7) 折扣复制给徒弟（`ObsessionSystem.add` 去重保强者） |
| ⑥ 夺舍（轻度） | 邪修(低 justice+低 loyalty)高境界师傅 + 高资质徒弟 | `_checkSeizeDiscipleObsession` 起 `seizure` 执念锁定徒弟 → `_resolveRevengeTarget` 认 `seizure` → 复用 hunt/kill 击杀链 |

**核心数据流**（与二期完全一致）：

```
RelationshipSystem(master/disciple 边)
  → NPCEntity._buildRelationshipGoals → _considerMasterDiscipleGoals（追加师徒候选，按 priority 单点锁定）
  → 写 state.targetRelationshipId → relationship_target resolver 解析坐标
  → executor 结算（传功给 insight / 护徒 / 尽孝，并加深关系边）
师傅死亡 → TickManager._collectDeaths（遍历 edgesOfType(master,'master') 找徒弟）
  → 徒弟.inheritMasterLegacy(凶手信息)：① master_lost 记忆→revenge 执念；② 继承未竟执念
夺舍 → NPCEntity.onPreTick._checkSeizeDiscipleObsession（活着时起执念）→ 复用复仇击杀链
全程 goalsEnabled gate；无 qualifying 边 → 不产出（默认关闭不改变既有行为）
```

### 一、配置与开关（数据驱动）

- `relationship.json` 新增 `masterDiscipleGoals` 段：`teachDisciple`/`protectDisciple`/`visitMaster`（各含 `priority`/范围/强度阈值/低频概率）、`inheritWill`（`revengeMemoryType`/`inheritObsessionIntensityMult`/`inheritableObsessionTypes`）、`seizeDisciple`（说明性占位，参数在 obsession.json）。
- `relationship.json -> init.masterDisciple.discipleRoles` 修正为 `["core_disciple", "disciple", "inner_disciple", "outer_disciple"]`——**修复一期遗留的数据对齐缺陷**：原配置仅 `["disciple","outer_disciple"]`，与实体数据主弟子角色 `core_disciple` 不匹配，导致 `master` 边实际从未建立（三期师徒功能依赖此边）。修正后实测 `master=55` 边。
- `memory.json` 新增 `master_lost`（恩师陨落，intensity 90，对凶手 grudgeGain 55）。
- `obsession.json acquired` 新增 `master_lost → revenge`（为师复仇，intensity 90）；`obsession.json` 顶层新增 `seizeDisciple` 块（夺舍触发参数：`maxJustice`/`maxLoyalty`/`minMasterRoleRank`/`minDiscipleTotalProgress`/`chancePerTick`/`intensity`）。
- `obsession-system.js` `ObsessionType` 新增 `SEIZURE: 'seizure'`。

### 二、NPC 关系驱动 Goal（`npc-entity.js`）

- `_buildRelationshipGoals` 末尾追加 `_considerMasterDiscipleGoals(consider, registry, here)`：复用二期 `consider`（取最高 priority）单点锁定。
  - **传功**：低频(`teachChancePerTick`)遍历 `master` 边，徒弟在世/在范围/修为偏低 → `goal_teach_disciple`（`goalState:{taughtDisciple:true}`）。
  - **护徒**：遍历 `master` 边，徒弟 `hasRevengeTarget` 且在范围 → `goal_protect_disciple`（`goalState:{protectedDisciple:true}`，优先级最高）。
  - **尽孝**：低频取 `topEdgeOfType(self,'disciple')`，师傅在世/在范围 → `goal_visit_master`（`goalState:{visitedMaster:true}`）。
- `_checkSeizeDiscipleObsession(worldContext)`（`onPreTick` 调用，紧邻 `_checkConditionalObsession`）：邪修+高境界+高资质徒弟+概率检定 → 起 `seizure` 执念锁定资质最高的徒弟。区别于无目标的条件执念（需关系感知锁定 `targetId`）。
- `inheritMasterLegacy(master, info)`：① `recordMemory('master_lost', {actorId:凶手})` 触发复仇执念；② 复制师傅可继承执念（折扣强度、去重）。封装在 NPCEntity 内（已 import `Obsession`），使 `TickManager` 死亡钩子保持精简（仿 `recordMemory` 调用风格）。
- `_refreshRevengeState`：`enemyKilled` 达成时一并清除 `seizure` 执念（夺舍与复仇同走击杀链）。
- `_initActions` 默认池补入 `act_npc_teach_disciple`/`act_npc_protect_disciple`/`act_npc_visit_master`（均由师徒 Goal gate，默认关闭不改变既有行为）。

### 三、新增 Action + Executor

- `npc-actions.json`：`act_npc_teach_disciple`（`relationship_target`，`effects:{taughtDisciple:true}`，`riskKey:null`）、`act_npc_protect_disciple`（`riskKey:pvp`）、`act_npc_visit_master`（`riskKey:null`）。
- `npc-actions.js`：`NPCTeachDiscipleExecutor`（给徒弟 `insightGain` + 加深 `master` 边）、`NPCProtectDiscipleExecutor`（加深 `master` 边）、`NPCVisitMasterExecutor`（加深 `disciple` 边），在 `registerNPCExecutors` 注册。
- `relationship_target` resolver 与 `_refreshRelationshipState` 二期已具备，**无需修改**即兼容三期新 Goal（均写 `targetRelationshipId`）。

### 四、遗志继承死亡钩子（`tick-manager.js`）

- `_collectDeaths` 在道侣 `companion_lost` 块后增 master→disciples 块：仅 `_relationGoalsEnabled()` 时，遍历 `relationshipSystem.edgesOfType(死者.id, 'master')` 找在世徒弟，逐个调 `disciple.inheritMasterLegacy(死者, {killerId,...})`。
- `_resolveRevengeTarget` 的执念匹配从 `type==='revenge'` 扩为 `type==='revenge' || type==='seizure'`（夺舍执念锁定徒弟、走同一 hunt/kill 链）。

### 五、Utility 调制 + 仿真统计（可选增益/观测）

- `utility.json considerationsBySource` 增 `goal_teach_disciple`（修为越高越有余力点化）、`goal_protect_disciple`（护徒御敌就绪度，基线高于护短同门）、`goal_visit_master`（恒定低风险尽孝）。仍受 `utility.enabled`（默认 false）二级开关。
- `npc-utility.js DEFAULT_GOAL_RISK_KEYS` 为 `goal_protect_disciple` 映射 `pvp`。
- `simulate-analysis.mjs` 增"师徒互动"统计行（传功/护徒/探望恩师触发计数）。
- `action-pool.js` 新增 `getExecutor(id)` 访问器（供测试直接调 executor.run）。
- `simulation-main.js` 师徒 Goal 复用二期 `relationship → '关系'` 标签（seizure 执念走 `obsession → '执念'`），**无需修改**。

## 数据与接口

- `apps/game/data/balance/relationship.json`：新增 `masterDiscipleGoals` 段；`init.masterDisciple.discipleRoles` 修正。
- `apps/game/data/balance/memory.json`：新增 `master_lost`。
- `apps/game/data/balance/obsession.json`：新增 `master_lost→revenge` acquired 规则 + `seizeDisciple` 块。
- `apps/game/data/actions/npc-actions.json`：新增 3 个师徒 action。
- `apps/game/data/balance/utility.json`：新增 3 个师徒考量因素。
- `apps/game/js/engine/abstract/obsession-system.js`：`ObsessionType.SEIZURE`。
- `apps/game/js/engine/npc/npc-entity.js`：`_considerMasterDiscipleGoals` + `_checkSeizeDiscipleObsession` + `inheritMasterLegacy` + `_refreshRevengeState` 清 seizure + 默认行为池补全。
- `apps/game/js/engine/npc/npc-actions.js`：3 个师徒 Executor + 注册。
- `apps/game/js/engine/npc/npc-utility.js`：`goal_protect_disciple` 风险键。
- `apps/game/js/engine/npc/npc-state.js`：`taughtDisciple`/`protectedDisciple`/`visitedMaster`。
- `apps/game/js/engine/world/tick-manager.js`：`_collectDeaths` master→disciples 块 + `_resolveRevengeTarget` 认 seizure。
- `apps/game/js/engine/pools/action-pool.js`：`getExecutor`。
- `apps/game/tools/simulate-analysis.mjs`：师徒触发统计。

## 后果

- 师徒边从"只记录"升级为"驱动行为与遗志继承"：传功点化、护徒驰援、尽孝探望、为师复仇、执念延续、夺舍阴谋成为可涌现行为。
- 默认开但严格默认关闭不改变既有行为：无 qualifying `master`/`disciple` 边时不产出（等价主路径）；`goalsEnabled=false` 完整回退。
- 修复一期 `discipleRoles` 数据对齐缺陷，使 `master` 边首次实际建立（实测 55 条）——同时也意味着二期"关系复仇认 enemy 边"等不受影响（独立于师徒边）。
- **夺舍为轻度实现**：复用复仇击杀链，未做真正的身体接管/境界继承/换壳重生。留作后续深挖为独立"夺舍流派"（见 `关系系统后续扩展项`）。
- 师徒驱动 Goal（传功/护徒/尽孝）与二期同门驰援/报恩一致，优先级低于生存/修炼等核心驱动，故在默认平衡下属**低频涌现**行为（单元测试证明机制正确，触发频率为后续优先级/阈值调参的杠杆）。

## 验证

- `node apps/game/tools/test-master-disciple.mjs`（goalsEnabled 开关默认关闭不改变既有行为、传功 Goal 产出/范围/修为门槛、护徒优先级、尽孝、继承遗志复仇+执念延续+死亡钩子遍历路径、夺舍执念正反例、传功 executor 结算，26 项）全绿。
- 回归：`test-goal-equivalence.mjs`（400 用例，现有目标规划路径默认关闭不改变既有行为）、`test-relationship-goals.mjs`、`test-revenge.mjs`、`test-relationship.mjs`、`test-obsession.mjs`、`test-utility.mjs`、`test-memory.mjs`、`test-bt.mjs`、`test-utility-divergence.mjs`、`test-monster-resource-loop.mjs`、`test-info-propagation.mjs` 全绿。
- `test-goal-equivalence.mjs` 摘要由 `16c7c409`（二期前基线）变为 **`5740e12a`**（新增 3 个师徒行为 + 3 个状态键后的新基线，已 `node test-goal-equivalence.mjs 5740e12a` 验证确定性稳定）。`test-goal-equivalence` 400 用例确认现有目标规划路径默认关闭不改变既有行为——摘要变化仅因行为数+状态键集合扩大导致固定场景回归 PRNG 采样错位，属"新增行为数据后应重新基线"的预期变更（参考 ADR-023/ADR-028）。
- `node apps/game/tools/simulate-analysis.mjs --days=200` 默认跑无报错、`master=55` 边涌现；`RELATIONSHIP_GOALS_ACTIVE=0` 无报错、师徒/关系驱动行为全部 dormant（默认关闭不改变既有行为回退）。

## 相关

- ADR-027（关系网一期：数据层 + 师徒边自动建立）。
- ADR-028（关系网二期：关系驱动决策）——本 ADR 复用其 Goal 单点锁定架构、`relationship_target` resolver、`_refreshRelationshipState`、护短同门逻辑、`goalsEnabled` gate。
- ADR-020（Consideration Utility + 复仇 PvP）——继承遗志·复仇与夺舍复用其 `_resolveRevengeTarget` 与 hunt/kill 行为链。
- ADR-019（GOBT 长期心智）——执念/记忆系统是继承遗志与夺舍的载体。
- 世界观参考：凡人修仙传（师徒情谊、传承、墨大夫夺舍）、大道争锋/遮天（传承道统、晚年收徒）。

