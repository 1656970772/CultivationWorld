# ADR-048：四层反应式 AI 架构（Reaction / Utility / GOAP / Execution）

最后更新：2026-06-03

状态：**已落地 2026-06-03**。默认 `reaction.enabled=false`（关闭时被攻击不触发反应、不改变现有行为）；开启后被攻击触发即时反应、大事件触发立即重决策。

## 背景

ADR-018 落地了 GOBT 三层雏形（BT 骨架 + Utility 选目标 + GOAP 规划），但用户在长程模拟中发现"NPC 行为过于线性、像机器人"，缺少修仙世界应有的"不同人有不同修炼人生 + 遭遇突发事件时的本能反应"。根因分析（与用户确认）有三个关键缺口：

1. **反应层名存实亡**：原 `reactions` selector 仅有 `EmotionReactionNode`，默认阈值 101 不可达，且 `isBusy()` 时不打断。被攻击时受害 NPC **完全没有主动反应**——攻击方在自己 tick 里直接 `applyDamage`，受害者只有被动锁血/遁地符（ADR-042），不会躲避/回血/逃跑/反击。
2. **大事件不打断**：秘境开启/拍卖会/宗门大比/遇仇人目前靠 `onPreTick` 刷新派生状态、**下一天**才间接影响 Utility，不能即时打断闭关/游历。
3. **没有"动态决策列表 + 立即重决策"的统一入口**：重规划散落在 greedy 增量目标与 replan 分支里。

用户要求（2026-06-02/06-03）把架构强化为清晰四层，并以"修炼人生多样化 + 遭遇突发即时反应"为目标：

> 第一层：Reaction（即时反应）第二层：Utility（意图选择）第三层：GOAP 第四层：执行。反应层显触发，被偷打了先躲避、查伤势、血量低立刻回血、血量高先去安全地方、判断对方修为比自己低直接进战斗。大事件（宗门大比/大型拍卖会/秘境开启/突遇仇人）加入动态决策列表并立刻重新决策。

## 决策（用户确认）

- **多线程：安全优先**。保持单线程确定性 tick；意图层抽成 `IntentService` 服务并预留 `selectGoalBatch()` 批量接口，本轮**不上真 Worker**（JS 真多线程需状态序列化/快照，改造量极大且易破坏确定性）。意图层 `selectGoal` 设计为纯函数式（只读快照 + worldContext），为将来切并行做准备。
- **即时反应：同游戏日事件驱动**（不引子 tick）。攻击/世界事件在结算瞬间向受影响实体的 `StimulusQueue` 压入刺激，受影响实体在自身 tick 的反应层最先消费，全程同步、确定性可复现。
- **战斗：只做反应决策**（躲避/回血/逃跑/进攻选择）。打击仍走现有 `applyDamage` 单次结算，本轮**不做多回合战斗循环**。

## 四层职责与数据流

```
攻击方 tick: applyDamage 命中受害者 ──push stimulus──▶ 受害者 stimulusQueue
世界事件: 遇仇人/知晓机缘        ──requestReplan──▶ 受影响 NPC _replanRequested

受害者 NPC.tick（单线程确定性）
  └─ BT 四层：
     1 Reaction 反应层  消费 stimulusQueue（被攻击→躲避/回血/逃跑/反击，可打断 isBusy）
        ├─ 紧急刺激命中 → 抢占执行反应行为（清计划 + 单步），占据本 tick
        └─ 无紧急刺激 → FAILURE，落入意图层
     2 Utility 意图层  IntentService.selectGoal（need/执念/关系/机会 + 动态事件候选 → 选最高）
     3 GOAP 规划层     A* 短链 / 修炼类 greedy 单步
     4 Execution 执行层 BehaviorSystem.executeStep 三阶段（traveling/executing/结算）
```

## 核心新增

### 1. StimulusQueue（反应层输入，`abstract/stimulus.js`）

每个实体一个有序刺激队列。刺激类型用枚举 `StimulusType`（attacked / enemy_spotted / treasure_spotted / secret_realm / auction / sect_tournament），带 priority/sourceId/payload/day。`pop` 按 priority 降序、同 priority 入队顺序（稳定）取最高优先一条；`pruneExpired` 每日（`onPreTick`）清理超过 `ttl` 天未消费的刺激。**纯同步、无随机，确定性可复现**。

`applyDamage`（[combat-pipeline.js](../../apps/game/js/engine/combat/combat-pipeline.js)）在受伤存活/锁血保命分支，若 `reaction.enabled` 且 `target.pushStimulus` 存在，push 一条 `attacked`（含 killerId/damage/orderGap）。

### 2. ReactiveNode（`abstract/bt/reactions.js`）

放在 NPC BT `reactions` selector 顶部（先于 `emotion_reaction`），消费 `attacked` 刺激，执行被攻击反应决策树（阈值/动作映射全部来自 `data/balance/reaction.json`，数据驱动）：

```
被攻击:
  1. 重伤濒死(hp/maxHp < fleeHpRatio)              → 逃命(act_npc_react_flee) 抢占, 清计划
  2. 血量偏低(hp/maxHp < healHpRatio)              → 应急回血(act_npc_react_heal) 抢占
  3. 血量安全 且 敌弱(我方战力/来犯战力 >= powerAdvantage) → 奋起反击(act_npc_react_counter) 抢占
  4. 血量安全 但 打不过                              → 暂避锋芒(act_npc_react_retreat) 抢占
```

与 `EmotionReactionNode` 不同：被攻击反应**可打断 `isBusy()`**（被打断闭关/游历）——这正是"打断当前计划"的核心。命中即 `clearPlan` + `setSingleActionPlan` + 本 tick `executeStep`，返回 RUNNING。反应行为短小（duration 小），执行完后次日落回意图层重决策。

> **本轮局限**：来犯者来自妖兽攻击时 `applyDamage(killer:null)`，反应决策落到逃命/回血/暂避（无可比战力对象，不反击）。`counter` 已就位，待 PvP 攻击走 `applyDamage` 并传 killer 时即可触发（后续工作）。

### 3. 动态决策事件 → 立即重决策（意图层）

- `entity.requestReplan(reason)` 置 `_replanRequested=true`；`entity.consumeReplanRequest()` 一次性查询并清除。
- [planner-node.js](../../apps/game/js/engine/abstract/bt/planner-node.js) 门控：`!hasPlan() && !isBusy()` **或 `consumeReplanRequest()`** 时重规划。大事件强制立即重选，**跳过开局错相门控**，无需等当前计划走完（打断长链）。
- `NPCEntity._checkEventReplan`（`onPreTick` 内）检测本 tick 新出现的大事件：**遇仇人**（`hasRevengeTarget` 跃迁 false→true）→ `ENEMY_SPOTTED` + requestReplan；**知晓可达机缘**（`bestOpportunityFor` 新返回机会点）→ 秘境/拍卖/夺宝刺激 + requestReplan。仅在 `reaction.eventReplan.enabled=true` 时生效（默认 false，关闭时不触发立即重决策）。具体目标仍由既有 `collectExtraGoals/buildOpportunityGoal` 经 Utility 选出（单一真相源，不在此处造目标）。

### 4. IntentService（意图层服务化 + 并行预留，`npc/intent-service.js`）

把 `PlannerNode._doPlan` 里"装配规划输入（GOAP 状态 / costFn / 额外目标 / 目标调制回调）"抽出为纯函数式 `buildPlanInputs`，并提供 `selectGoal(entity, ctx)` 与 `selectGoalBatch(entities, ctx)`（批量接口本轮内部串行）。`PlannerNode._doPlan` 在实体提供 `selectIntent` 时委托之（NPC 委托 IntentService），否则就地装配（势力等沿用），保持抽象层与 npc 层解耦。**目标合并/排序/规划仍由 `BehaviorSystem.plan` 完成（单一真相源）**，避免重复实现。

## 数值与确定性（遵循项目规则）

- 所有阈值（fleeHpRatio/healHpRatio/powerAdvantage/counterDamageRatio/healPillId 等）入 `data/balance/reaction.json`，**数据驱动**、代码不写死。
- 全程同步、随机走实体 `_rng`/`worldContext.rng`（ADR-038），保持确定性可复现。
- `reaction.enabled`（反应层）与 `reaction.eventReplan.enabled`（大事件立即重决策）两个开关默认 false，关闭时不改变现有行为。

## 验证（看新逻辑真实改变了行为，不做摘要/一致性自证）

本轮目的是**改决策逻辑、让 NPC 行为真的变化**，所以验证只看新逻辑在真实长程模拟中涌现的行为，不用固定种子去证明"与改造前一致"（那反而说明新逻辑没生效）。`tools/verify-reaction.mjs` 开启 `reaction.enabled` + `eventReplan.enabled`，全量 NPC 多种子长程跑，纯观察统计、无任何特权/隔离/作弊。

3 种子 × 800 天结果：

- **被攻击真的触发了反应**：合计 1668 次——暂避 1006 / 应急回血 521 / 逃命 141 / 反击 0。被攻击的 NPC 不再傻站着挨打或闷头闭关，而是按血量/敌我战力做出躲避、回血、逃跑等本能反应。
- **反应确实打断了长链行为**：315 次打断了正在进行的修炼/闭关（出关应敌），印证"大事件可打断当前计划"。
- **反应可恢复、不卡死**：193 个发生过反应的 NPC 中 190 个之后落回正常修炼/游历；剩 3 个仅因在模拟末尾几天才被攻击、尚未轮到下一次正常行为统计即结束，非永久卡反应循环。
- **`counter`（反击）跨 3 种子均为 0**（诚实记录）：当前来犯者多为妖兽，`applyDamage(killer:null)` 无可比战力对象；且被攻击者血量多已偏低，先命中回血/逃跑分支。反击分支逻辑已通，触发是数值口径（`powerAdvantage` 阈值 + 血量分支顺序）与 PvP `applyDamage` 传 killer 的后续工作，非逻辑缺陷。

激活方式：`node tools/verify-reaction.mjs` 或 `REACTION_ACTIVE=1 node tools/simulate-analysis.mjs`。

## 涉及文件

- 新增 `apps/game/js/engine/abstract/stimulus.js`（StimulusQueue + StimulusType 枚举）
- 新增 `apps/game/js/engine/npc/intent-service.js`（意图选择服务 + 批量预留接口）
- 新增 `apps/game/js/engine/npc/actions/reaction-actions.js`（flee/retreat/heal/counter 执行器）
- 新增 `apps/game/data/actions/reaction-actions.json` + `apps/game/data/balance/reaction.json`
- 改 `apps/game/js/engine/combat/combat-pipeline.js`：受伤/锁血分支 push `attacked` 刺激
- 改 `apps/game/js/engine/abstract/bt/reactions.js`：新增 `ReactiveNode`；`bt-loader.js` 注册 `reactive` 类型
- 改 `apps/game/js/engine/abstract/bt/index.js` + `data/behavior-trees/npc-default.json`：reactions selector 顶部加 `reactive`
- 改 `apps/game/js/engine/abstract/bt/planner-node.js`：门控支持 `consumeReplanRequest()`，`_doPlan` 委托 `selectIntent`
- 改 `apps/game/js/engine/npc/npc-entity.js`：挂 `stimulusQueue`/`pushStimulus`/`requestReplan`/`consumeReplanRequest`/`selectIntent`/`_checkEventReplan`，注册反应行为
- 改 `apps/game/js/engine/world/services/world-context-builder.js`：新增 `safe_retreat` targetResolver
- 改 `apps/game/js/engine/world-engine.js` + `core/config-loader.js`：加载 reaction 行为/配置并注入
- 改 `apps/game/js/engine/npc/npc-actions.js`：注册 reaction 执行器
- 新增 `apps/game/tools/verify-reaction.mjs`；`simulate-analysis.mjs` 增 reaction 配置 + `REACTION_ACTIVE` 开关

## 后续工作

- PvP 攻击（仇杀/劫掠/夺权）走 `applyDamage` 并传 `killer`，使反应层 `counter`（敌弱反击）真实触发。
- 多回合战斗循环（本轮明确不做）。
- 意图层真 Worker 并行（需确定性状态快照方案，`selectGoalBatch` 接口已就位）。

