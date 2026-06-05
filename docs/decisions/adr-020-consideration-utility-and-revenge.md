# ADR-020: Consideration 乘法式 Utility 选目标层 + 复仇 PvP 行为链 + killerId 闭环

> 日期：2026-05-30
> 状态：已采纳

## 背景

ADR-018/019 落地了 GOBT 三层架构与长期心智（记忆/执念/情绪/恩怨），但对照标准 Utility AI（《模拟人生》《环世界》）仍有差距：

1. **「选目标」层仍是纯加法 priority**：没有把「修炼需求 × 瓶颈程度 × 资源充足度」这类多因素乘法式效用引入目标评分。
2. **时间价值 / 风险只在 GOAP step cost 层**（选「怎么做」），没有进入「选什么目标」层——老年金丹与少年炼气对「延寿/突破」的渴望应当不同。
3. **执念只是高 priority Goal**，没有对「同方向行为/需求」的乘法放大（飞升执念应让日常修炼也被放大）。
4. **复仇执念只复用「变强」代理目标**，没有真正的「追踪→击杀仇人」对人行为；`_deathInfo` 多数路径不写 `killerId`，恩怨锁定闭环断裂。

## 决策

### 1. Consideration 乘法式 Utility（`abstract/consideration.js`）

- 新增 `Consideration { id, inputKey, source, curve, params }`，把某输入经**响应曲线**映射到 `[0,1]`。曲线数据驱动，枚举 `CurveType`：`linear / quadratic / inverse / threshold / logistic`。
- 输入来源枚举 `InputSource`：`entity`（状态键）/ `world`（世界上下文）/ `derived`（派生量，如 `timeValue`）。
- `Goal.score()` 升级为：

  ```
  score = (priority + Σdelta) × Π(modulator.mult) × Π(consideration ∈ [0,1])
  ```

  无 considerations 且无 modulators 时**严格等于 priority**（与重构前一致，行为默认关闭不改变既有行为）。
- 数据驱动：`data/balance/utility.json`，按目标来源 `sourceId`（如 `need_npc_cultivation`）挂考量因素组。**`enabled` 总开关默认 `false`**——关闭时所有目标不挂考量因素，旧摘要回归回归默认关闭不改变既有行为。

### 2. TimeValue 时间价值 + 风险进选目标层（`npc/npc-utility.js`）

- **TimeValue**：派生输入 `timeValue = f(lifeRatio)` ∈ `[0,1]`，老年（lifeRatio→1）时间宝贵、少年低。供 `延寿/突破` 类目标的考量因素读取（曲线进 utility.json）。
- **目标级风险**：`estimateGoalRisk(entity, goal, worldContext)` 聚合该目标典型行为的 `estimateRiskCost`（复用 `npc-actions.js`，与 GOAP step cost 同一套 risk.json + 性格加成），作为「风险厌恶」考量因素（受 `personality.caution` 调制）。
- **统一接入点**：NPC 覆写 `decorateGoalConsiderations(goal, worldContext)`，由 `PlannerNode._doPlan` 与 `modulateGoal` 在同一处对每个候选 Goal 调用一次（缺省默认关闭不改变既有行为）。

### 3. 执念乘法加成（`abstract/obsession-system.js` + obsession.json `goalMult`）

- `Obsession.toGoal(goalMultCfg)` 给执念自身 Goal 注入 `self` 乘子（如飞升执念 ×1.5）。
- `ObsessionSystem.needGoalMult(needSourceId)` 给**同方向需求 Goal** 加乘子（飞升 NPC 的日常修炼也被放大），在 `decorateGoalConsiderations` 内施加。
- 数据驱动：obsession.json `goalMult.byType.<type> = { self, needs: { <needSourceId>: 乘子 } }`，**`goalMult.enabled` 默认 `false`** → 乘子恒为 1，默认关闭不改变既有行为。

### 4. 复仇 PvP 行为链（`npc/npc-actions.js` + npc-actions.json + risk.json）

- 新增对人行为：
  - `act_npc_hunt_enemy`（追踪仇人）：`requiresTravel`，`targetResolver=revenge_target`，effect 置 `nearRevengeTarget=true`。
  - `act_npc_kill_enemy`（击杀仇人）：前置 `nearRevengeTarget` + **实力门槛 `totalProgress>=0.3`**，`riskKey=pvp`，effect 置 `enemyKilled=true`（执念达成）。
- 执行器：
  - `NPCHuntEnemyExecutor`：抵达后确认仇人在世并标记临近。
  - `NPCKillEnemyExecutor`：用 `npcCombatPower` 比拼，胜率 `myPower/(myPower+enemyPower)`。胜→`killNPCByPvP(target, self)` 写 `_deathInfo{cause:'slain', killerId, killerFactionId}` 并置 `enemyKilled`；负→按劣势受伤，悬殊时被反杀。
- `revenge_target` resolver（tick-manager）：按执念 `targetId` 优先、回退个人恩怨图 `topGrudge` 定位仇人坐标（复用 `_nearestEntityPos`/感知，限定候选集，不全图扫描）。
- 战力 `npcCombatPower(npc) = (rankBase+1) × (1 + qi/1000 折算) × (1 - 伤势折损)`，法宝/功法预留。
- 复仇执念 `goalState` 改为 `{ enemyKilled: { op:'eq', value:true } }`；**实力不足时直接复仇规划失败（强度门槛），变强交由日常修炼需求长期推进**，待达门槛后某轮规划才推导出「追踪→击杀」。
- risk.json 新增 `pvp` 分项（受伤/陨落，受 caution 调制），仅供 Utility/GOAP **折算期望损失**；真实胜负由执行器结算，不双重掷骰。

### 5. killerId 仇人锁定闭环

- PvP 致死经 `killNPCByPvP` 写 `killerId/killerFactionId`。
- 夺职受辱（挑战拉下现任）：`_recordDisplacementGrudge` 让被替下者记 `humiliated`（含 grudgeGain）并锁定挑战者为 actor，可触发对挑战者的复仇执念（obsession.json 新增 `humiliated→revenge` 规则）。
- 闭环：`_deathInfo.killerId` → `_collectDeaths` → 道侣/同门 `recordMemory` → `RelationshipGraph` 记仇 → `_checkAcquiredObsession` 生成锁定仇人的复仇执念 → `resolveRevengeTarget` 定位 → 追踪击杀。

## 默认关闭不改变既有行为保证

- 阶段 A/B/C 的考量因素与乘子在 utility.json `enabled=false` / obsession.json `goalMult.enabled=false`（默认）时恒等（×1）。
- 新增的 2 个复仇行为 effect 只触及 `nearRevengeTarget/enemyKilled`，不贡献任何既有目标，故对旧摘要回归「计划内容」零影响（摘要字符串因 action 数量从 11→13 变化，但逐条计划输出不变，已用「排除新动作后摘要 == 原基线 989688d2」验证）。

## 世界平衡

- PvP 受「同分需求优先（生存底线）+ 实力门槛 + 决策冷却」约束，避免人口崩溃。
- PvP 风险/胜率参数保守起步：端到端 300/1000 天模拟世界稳定（151 NPC 存续，执念正常涌现），复仇事件需 `betrayed/humiliated/sect_destroyed(含 actor)` 触发，属低频叙事事件，后续按内容/触发源逐步放量。

## 影响

- 新增：`abstract/consideration.js`、`npc/npc-utility.js`、`data/balance/utility.json`；npc-actions.json 增 2 行为、obsession.json 增 `goalMult` 与 `humiliated→revenge`、risk.json 增 `pvp`。
- 修改：`abstract/goal.js`（乘法 score）、`obsession-system.js`（goalMult）、`bt/planner-node.js`（统一调制入口）、`npc-entity.js`（decorateGoalConsiderations / 复仇派生状态 / 闭环）、`npc-state.js`（复仇派生键）、`tick-manager.js`（revenge_target / npcCombatPower / 夺职记仇）、`config-loader.js` / `world-engine.js`（加载 utility.json）。
- 测试：新增 `tools/test-utility.mjs`、`tools/test-revenge.mjs`；既有回归全绿、旧摘要回归零计划漂移。

## 后续

- 扩充复仇触发源（势力攻战致死写 killerFactionId、`betrayed` 事件接入），让恩怨叙事在宏观模拟中更频繁涌现。
- 法宝/功法接入 `npcCombatPower`。
- utility.json 启用后端到端校准考量因素曲线参数。

