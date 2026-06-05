# Job/Toil AI 双重重构规格

> 最后更新：2026-06-05  
> 状态：首批 Job/Toil 运行时已实现；`ai-config.npc.jobs.enabled=true` 时启用  
> 架构决策：ADR-048、ADR-049、ADR-050  
> 来源：用户明确要求“保留 GOAP 作为中层规划器，把复杂 Action 的执行升级为 Job/Toil，逻辑和配置都拆清楚，并补齐缺少的 Job 与 Toil”；当前代码 `action.js`、`behavior-system.js`、`job-system.js`、`job-pool.js`、`toil-pool.js`、`npc-toils.js`、`dynamic-goals.json`、`npc-job-actions.json`、`npc-action-sets.json`、`npc-entity.js`。

## 目标

本规格定义一次配置和代码的双重重构：

1. 保留 Utility / Intent 负责选目标。
2. 保留 GOAP 负责规划高层 Action 链。
3. 将复杂 Action 的内部流程升级为 Job/Toil。
4. 保持简单 Action 的直接执行路径。
5. 把 Action、Job、Toil、默认行为集拆成清晰配置。
6. 补齐动态目标、秘境准备、宗门大比准备、获取回血丹、获取法器所需的初始 Job 和 Toil。

当前四层 AI 已落地；首批 Job/Toil 已作为可开关的复杂行动执行层接入。关闭 `ai-config.npc.jobs.enabled` 时，运行时仍保持 `Reaction → Utility / Intent → GOAP → Execution`；开启后，复杂 JobAction 走 `Reaction → Utility / Intent → GOAP → Job / Toil → Execution`。

## 非目标

- 不删除 GOAP。
- 不把所有 Action 都改成 Job。
- 不实现多线程 Intent 或 Worker 规划。
- 不新增多回合战斗循环。
- 不用固定基线一致性证明行为正确。
- 不把 Job/Toil 写成世界观叙事脚本；它们只负责执行流程。

## 五层职责

```text
1. Reaction
   即时反应：被打、濒死、仇人贴脸，先活下来。

2. Utility / Intent
   意图选择：我现在最想做什么，例如修炼、复仇、夺宝、护徒、准备秘境。

3. GOAP
   路径规划：为了达成目标，需要哪些高层动作，例如备丹、换法器、赶路、进入秘境。

4. Job / Toil
   复杂行动编排：每个复杂动作内部怎么一步步做，例如检查背包、找地点、移动、购买、等待、失败回退。

5. Execution
   底层推进：推动当前 Action 或 Toil 的移动、耗时、结算和状态回写。
```

## Action 分类

### SimpleAction

SimpleAction 适合短小、单次结算或已有清晰 executor 的行为：

| 行为 | 例子 | 执行 |
|------|------|------|
| 修炼 | `act_npc_cultivate`、`act_npc_train_chamber` | 当前 `ActionExecutor`。 |
| 疗伤 | `act_npc_heal`、Reaction 层回血 | 当前 `ActionExecutor`。 |
| 任务 | 接任务、做任务、交任务 | 当前 `ActionExecutor`。 |
| 即时反应 | 逃命、暂避、反击 | Reaction 强制单 Action。 |

SimpleAction 保持 `executionKind` 缺省为 `simple`。

### JobAction

JobAction 是 GOAP 可规划的高层动作，但自身不写复杂流程：

| JobAction | 对应 Job | 说明 |
|-----------|----------|------|
| `act_npc_prepare_dynamic_event` | `job_npc_prepare_dynamic_event` | 通用动态事件准备。 |
| `act_npc_join_dynamic_event` | `job_npc_join_dynamic_event` | 前往并参与动态事件。 |
| `act_npc_prepare_secret_realm` | `job_npc_prepare_secret_realm` | 秘境特化准备。 |
| `act_npc_prepare_sect_tournament` | `job_npc_prepare_sect_tournament` | 宗门大比特化准备。 |
| `act_npc_acquire_heal_item` | `job_npc_acquire_heal_item` | 获取回血丹或等价恢复物。 |
| `act_npc_acquire_artifact` | `job_npc_acquire_artifact` | 获取、兑换或装备法器。 |

JobAction 的 `plannerEffects` 继续给 GOAP 使用；真实状态只在 Job 成功后写入。

示例：

```json
{
  "id": "act_npc_prepare_secret_realm",
  "name": "准备秘境",
  "category": "npc_job",
  "executionKind": "job",
  "jobId": "job_npc_prepare_secret_realm",
  "weight": 4,
  "valueScore": 14,
  "riskKey": "plunder",
  "preconditions": {
    "alive": { "op": "true" },
    "dynamicEventIsSecretRealm": { "op": "true" }
  },
  "effects": {},
  "plannerEffects": {
    "preparedForDynamicEvent": { "op": "set", "value": true },
    "preparedForSecretRealm": { "op": "set", "value": true }
  }
}
```

## 配置拆分

目标目录：

```text
apps/game/data/
├── actions/
│   ├── npc-actions.json
│   ├── npc-job-actions.json
│   ├── npc-action-sets.json
│   ├── reaction-actions.json
│   ├── faction-actions.json
│   └── world-rules.json
├── jobs/
│   ├── npc-dynamic-event-jobs.json
│   ├── npc-economy-jobs.json
│   └── npc-social-jobs.json
└── toils/
    ├── core-toils.json
    ├── npc-economy-toils.json
    ├── npc-dynamic-event-toils.json
    └── npc-social-toils.json
```

| 文件 | 职责 |
|------|------|
| `actions/npc-actions.json` | NPC SimpleAction。 |
| `actions/npc-job-actions.json` | NPC JobAction，只表达 GOAP 可规划的高层动作。 |
| `actions/npc-action-sets.json` | 默认 NPC 行为集，替代 `NPCEntity._initActions()` 中的硬编码 action id 列表。 |
| `jobs/npc-dynamic-event-jobs.json` | 秘境、大比、高手遗泽、关系伤亡等动态事件 Job。 |
| `jobs/npc-economy-jobs.json` | 获取丹药、兑换法器、补给等经济 Job。 |
| `jobs/npc-social-jobs.json` | 组队、求援、拜访、结伴等社交 Job。 |
| `toils/core-toils.json` | 移动、等待、设置状态、失败回退等通用 Toil 类型。 |
| `toils/npc-economy-toils.json` | 检查背包、检查灵石、购买、兑换、装备等 Toil 类型。 |
| `toils/npc-dynamic-event-toils.json` | 绑定事件、标记准备、等待阶段、参与事件等 Toil 类型。 |
| `toils/npc-social-toils.json` | 选择同伴、请求同行、确认关系对象等 Toil 类型。 |

加载规则：

- `ConfigLoader.loadGameConfigs()` 显式加载新增 JSON。
- `WorldEngine._registerSystems()` 初始化 `JobPool`、`ToilPool`。
- `ActionPool` 继续只负责 Action；Job 和 Toil 不注册进 ActionPool。
- `npc-action-sets.json` 中的默认行为集由 `NPCEntity._initActions()` 读取，NPC 个体配置 `actionIds` 仍可覆盖。

## Job 配置结构

Job 是一个复杂行动实例的流程定义：

```json
{
  "id": "job_npc_prepare_secret_realm",
  "name": "秘境准备",
  "category": "dynamic_event",
  "input": {
    "expectedEventType": "secret_realm"
  },
  "successEffects": {
    "preparedForDynamicEvent": { "op": "set", "value": true },
    "preparedForSecretRealm": { "op": "set", "value": true }
  },
  "interrupt": {
    "reaction": "pause",
    "higherDynamicGoal": "abort",
    "sameDynamicGoal": "keep"
  },
  "toils": [
    { "id": "bind_event", "type": "toil_bind_dynamic_event" },
    { "id": "check_hp", "type": "toil_check_hp_ratio", "params": { "minRatio": 0.7 } },
    { "id": "ensure_heal_item", "type": "toil_ensure_item", "params": { "itemId": "pill_rejuvenation", "minAmount": 1, "acquireMode": "buy_or_exchange" } },
    { "id": "ensure_artifact", "type": "toil_ensure_artifact", "params": { "itemId": "artifact_green_sword", "minGrade": 1, "acquireMode": "exchange" } },
    { "id": "mark_prepared", "type": "toil_mark_dynamic_event_prepared" }
  ]
}
```

字段规则：

| 字段 | 规则 |
|------|------|
| `id` | `job_` 前缀，snake_case。 |
| `category` | `dynamic_event`、`economy`、`social`、`crafting`、`combat_preparation` 等。 |
| `input` | 从 Action、Goal 或 entity state 读取的初始上下文；动态事件专用 Job 应声明 `expectedEventType`。 |
| `successEffects` | Job 完成后写入真实 state 的效果。 |
| `interrupt` | Reaction 或更高优先动态目标打断时的策略。 |
| `toils` | 顺序步骤；每个 Toil 可通过结果决定继续、等待、失败、回退或重规划。 |

引用规则：

- Job/Toil 参数中的 `itemId`、`priceItemId`、`currencyItemId` 必须引用 `items/*.json` 合并后的真实物品 ID。
- 动态事件专用 Job 的 `expectedEventType` 用于执行期校验；`toil_bind_dynamic_event` 绑定到的事件类型不匹配时，应返回 `abort` 或 `replan`，且不得写入准备成功状态。
- `targetDynamicEventType` 是 GOAP 规划时的动态目标上下文摘要；`expectedEventType` 是 Job 绑定具体事件时的执行约束，两者都需要保留。

## Toil 结果协议

每个 ToilExecutor 返回统一结果：

```js
{
  status: 'running' | 'success' | 'failed' | 'blocked' | 'replan' | 'abort',
  remaining: 0,
  reason: 'string_reason',
  contextPatch: {},
  effects: {}
}
```

含义：

| status | 含义 |
|--------|------|
| `running` | 本 Toil 跨 tick 推进，Execution 不进入下一 Toil。 |
| `success` | 当前 Toil 完成，Job 进入下一 Toil。 |
| `failed` | 当前 Job 失败，按 Job 的失败策略处理。 |
| `blocked` | 条件暂时不满足，可等待或转入回退 Toil。 |
| `replan` | 当前 Job 不再合适，请 BehaviorSystem 清 Job 并重新规划。 |
| `abort` | 立即终止 Job，通常来自打断或事件过期。 |

Toil 只通过窄接口读写：

- entity state。
- entity inventory。
- worldContext resolver。
- Job runtime context。
- `ItemRegistry`、`EffectPool`、`AbilityPool` 等既有机制池。

Toil 不直接调用 GOAP，也不直接修改 Utility 评分。

## Job Runtime

每个实体最多同时持有一个当前 Job：

| 字段 | 说明 |
|------|------|
| `currentJobId` | 当前 Job 定义 ID。 |
| `currentJobInstanceId` | 运行时实例 ID，用于日志与调试。 |
| `currentToilId` | 当前 Toil。 |
| `currentToilIndex` | 当前 Toil 序号。 |
| `jobStatus` | `idle`、`running`、`paused`、`completed`、`failed`、`aborted`。 |
| `jobContext` | 事件 ID、目标地点、目标物品、候选同伴等运行期上下文。 |
| `jobRemaining` | 当前 Toil 剩余天数。 |

这些字段可写入 entity state 供调试面板和模拟报告读取，但不应全部进入 GOAP 状态。GOAP 只读取被明确暴露的摘要状态，例如 `preparedForGenericDynamicEvent`、`preparedForSecretRealm`、`preparedForSectTournament`、`joinedDynamicEvent`、`hasEquippedArtifact`、`healPillCount`。`preparedForDynamicEvent` 保留为动态事件准备的兼容/汇总状态，不再作为秘境和宗门大比特化准备目标的唯一闭环字段。

## Execution 改造

`BehaviorSystem.executeStep()` 增加 JobAction 分支：

```text
如果当前 Action 是 simple:
  走现有 traveling → executing → action.execute → advance。

如果当前 Action 是 job:
  若没有匹配的当前 Job，JobSystem.start(action.jobId, action.jobInput)。
  JobSystem.executeStep(entity, worldContext) 推进当前 Toil。
  Job running 时返回 in_progress，不推进 currentActionIndex。
  Job success 时写 successEffects，清 Job，推进 currentActionIndex。
  Job failed/replan/abort 时清 Job，并按结果请求重规划或结束计划。
```

`Action.execute()` 不负责启动 Job，避免把 Job 生命周期塞回 executor。JobAction 的执行入口在 BehaviorSystem/JobSystem。

## 打断与恢复

Reaction 仍拥有最高优先级。

| 打断来源 | 默认策略 |
|----------|----------|
| 被攻击、濒死 | 暂停 Job，执行 Reaction 单 Action；Reaction 完成后按 Job 配置恢复或重规划。 |
| 更高优先动态目标 | 当前 Job `higherDynamicGoal=abort` 时终止并重规划。 |
| 同一动态事件再次触发 | `sameDynamicGoal=keep`，避免重复启动同一个准备 Job。 |
| 事件过期或目标失效 | Job 返回 `abort` 或 `replan`。 |

秘境准备这类 Job 默认可暂停；进入秘境窗口这类 Job 可被更高优先生死反应暂停，但事件过期后必须终止。

## 首批 Job 清单

| Job ID | 用途 | 首批 Toil |
|--------|------|-----------|
| `job_npc_prepare_dynamic_event` | 通用动态事件准备兜底 | 绑定事件、检查基础状态、标记准备。 |
| `job_npc_prepare_secret_realm` | 秘境准备 | 绑定秘境、检查 HP、确保回血丹、确保法器、可选找同伴、标记准备。 |
| `job_npc_join_dynamic_event` | 参与动态事件 | 绑定事件、移动到入口、等待 active、标记参与。 |
| `job_npc_prepare_sect_tournament` | 宗门大比准备 | 检查 HP、训练或修整、确保法器、移动到宗门、标记准备。 |
| `job_npc_acquire_heal_item` | 获取回血丹 | 查背包、找坊市或丹房、移动、检查灵石、购买或兑换、放入背包。 |
| `job_npc_acquire_artifact` | 获取法器 | 查装备、找宗门库房或坊市、检查贡献或灵石、兑换或购买、装备。 |

## 首批 Toil 清单

| Toil ID | 职责 | 所属文件 |
|---------|------|----------|
| `toil_bind_dynamic_event` | 从 `targetDynamicEventId` 或 Goal 动态上下文绑定事件。 | `toils/npc-dynamic-event-toils.json` |
| `toil_validate_dynamic_event_phase` | 校验事件阶段是否仍允许准备或参与。 | `toils/npc-dynamic-event-toils.json` |
| `toil_mark_dynamic_event_prepared` | 调用 `worldContext.markDynamicEventPrepared()` 并写准备状态。 | `toils/npc-dynamic-event-toils.json` |
| `toil_mark_dynamic_event_participant` | 调用 `worldContext.markDynamicEventParticipant()` 并写参与状态。 | `toils/npc-dynamic-event-toils.json` |
| `toil_wait_until_event_phase` | 等待事件进入指定阶段。 | `toils/npc-dynamic-event-toils.json` |
| `toil_check_inventory_item` | 检查背包中指定物品数量。 | `toils/npc-economy-toils.json` |
| `toil_ensure_item` | 确保指定物品满足数量，不足时进入购买或兑换步骤。 | `toils/npc-economy-toils.json` |
| `toil_check_currency` | 检查灵石等支付资源。 | `toils/npc-economy-toils.json` |
| `toil_buy_item` | 从坊市或可交易组织购买物品。 | `toils/npc-economy-toils.json` |
| `toil_exchange_faction_item` | 用贡献或材料从宗门兑换物品。 | `toils/npc-economy-toils.json` |
| `toil_check_equipped_artifact` | 检查已装备法器是否满足最低要求。 | `toils/npc-economy-toils.json` |
| `toil_equip_artifact` | 装备背包中的可用法器。 | `toils/npc-economy-toils.json` |
| `toil_resolve_target` | 解析目标地点，例如坊市、丹房、宗门库房、秘境入口。 | `toils/core-toils.json` |
| `toil_move_to_target` | 设置空间目的地并等待抵达。 | `toils/core-toils.json` |
| `toil_wait_days` | 等待固定天数。 | `toils/core-toils.json` |
| `toil_set_state` | 写入受控 state 字段。 | `toils/core-toils.json` |
| `toil_select_companion` | 按关系、境界和距离选择可同行对象。 | `toils/npc-social-toils.json` |
| `toil_request_companion` | 发起结伴请求并记录结果。 | `toils/npc-social-toils.json` |

`toil_ensure_item` 是组合型 Toil：内部只做分派，不直接购买。它根据背包、灵石、贡献和可用地点，把 Job context 写成下一步应走 `toil_buy_item` 或 `toil_exchange_faction_item`。

## 现有动态事件迁移

已完成迁移：

- `dynamic-goals.json` 中 `prepare_secret_realm` 的 `goalState` 是 `preparedForSecretRealm=true`。
- `dynamic-goals.json` 中 `prepare_tournament` 的 `goalState` 是 `preparedForSectTournament=true`。
- `dynamic-goals.json` 中 `avenge_relationship_death` 的 `goalState` 是 `preparedForGenericDynamicEvent=true`。
- `dynamic-goals.json` 中 `join_secret_realm` 的 `goalState` 是 `joinedDynamicEvent=true`。
- `npc-actions.json` 不再包含 `act_npc_prepare_dynamic_event` 和 `act_npc_join_dynamic_event`。
- `npc-job-actions.json` 中 `act_npc_prepare_dynamic_event` 和 `act_npc_join_dynamic_event` 已是 `executionKind:"job"`，运行期 `effects` 为空，`plannerEffects` 只给 GOAP 规划使用。
- `npc-job-actions.json` 中准备类 JobAction 已按动态事件类型增加前置：通用准备读取 `dynamicEventUsesGenericPreparation=true`，秘境准备读取 `dynamicEventIsSecretRealm=true`，宗门大比准备读取 `dynamicEventIsSectTournament=true`，避免 GOAP 把某一类准备目标规划到另一类 JobAction。
- 动态事件专用 Job 需要在 Job 输入或绑定 Toil 参数中声明 `expectedEventType`，由 `toil_bind_dynamic_event` 在执行期再次校验，避免计划阶段正确但运行期绑定错误事件。
- 旧 `dynamic-event-actions.js` executor 仅作为兼容测试路径；真实动态事件准备/参与由 `toil_mark_dynamic_event_prepared` 和 `toil_mark_dynamic_event_participant` 完成。

运行时闭环：

1. `act_npc_prepare_dynamic_event` 移入 `npc-job-actions.json`，变为 JobAction。
2. `act_npc_join_dynamic_event` 移入 `npc-job-actions.json`，变为 JobAction。
3. `dynamic-event-actions.js` 中的事件标记逻辑下沉为 `toil_mark_dynamic_event_prepared` 和 `toil_mark_dynamic_event_participant`。
4. `DynamicGoalProvider` 仍产出 `GoalSource.DYNAMIC`，不直接知道 Job。
5. `BehaviorSystem.plan()` 仍规划 Action，不规划 Toil。
6. `BehaviorSystem.executeStep()` 看到 JobAction 后启动 Job。
7. `BehaviorSystem._stateForGoal()` 根据动态目标 `eventType` 暴露 `dynamicEventIsSecretRealm`、`dynamicEventIsSectTournament`、`dynamicEventUsesGenericPreparation` 等摘要状态，供 GOAP 选择正确 JobAction。
8. `toil_bind_dynamic_event` 按 `expectedEventType` 校验绑定事件类型，不匹配时终止或重规划，不写准备成功状态。
9. Job 成功后写 `preparedForGenericDynamicEvent`、`preparedForSecretRealm`、`preparedForSectTournament` 或 `joinedDynamicEvent`，让动态目标按事件类型闭环。

## 配置开关

新增 `ai-config.json` 的 NPC 段：

```json
{
  "jobs": {
    "enabled": false,
    "maxActiveJobsPerNpc": 1,
    "logToilEvents": true
  }
}
```

默认 `enabled=false`。关闭时：

- JobPool 和 ToilPool 可加载，但 JobAction 不参与默认行为集。
- 动态事件配置仍按 `dynamic-events.json` 与 `dynamic-goals.json` 的开关独立控制。
- SimpleAction 行为不变。

开启时：

- 默认 NPC 行为集加入 `npc-action-sets.json` 的 `defaultNpcJobActionIds`。
- GOAP 可以规划 JobAction。
- Execution 启动 JobSystem 推进 Toil。

## 已实现文件

首批实现文件：

- `apps/game/js/engine/abstract/job.js`
- `apps/game/js/engine/abstract/toil.js`
- `apps/game/js/engine/abstract/job-system.js`
- `apps/game/js/engine/pools/job-pool.js`
- `apps/game/js/engine/pools/toil-pool.js`
- `apps/game/js/engine/npc/toils/core-toils.js`
- `apps/game/js/engine/npc/toils/dynamic-event-toils.js`
- `apps/game/js/engine/npc/toils/economy-toils.js`
- `apps/game/js/engine/npc/toils/social-toils.js`
- `apps/game/js/engine/npc/toils/npc-toils.js`
- `apps/game/data/actions/npc-job-actions.json`
- `apps/game/data/actions/npc-action-sets.json`
- `apps/game/data/jobs/npc-dynamic-event-jobs.json`
- `apps/game/data/jobs/npc-economy-jobs.json`
- `apps/game/data/jobs/npc-social-jobs.json`
- `apps/game/data/toils/core-toils.json`
- `apps/game/data/toils/npc-dynamic-event-toils.json`
- `apps/game/data/toils/npc-economy-toils.json`
- `apps/game/data/toils/npc-social-toils.json`

## 验证

单元验证：

| 脚本 | 覆盖 |
|------|------|
| `apps/game/tools/test-job-pool.mjs` | Job 配置加载、ID 校验、缺失 Toil 引用报错。 |
| `apps/game/tools/test-toil-pool.mjs` | Toil 类型注册、executor 绑定、重复 ID 校验。 |
| `apps/game/tools/test-job-system.mjs` | Job 启动、推进、暂停、恢复、失败、完成。 |
| `apps/game/tools/test-job-config-load.mjs` | JobAction、Job、Toil、物品引用和动态事件类型前置的配置完整性。 |
| `apps/game/tools/test-job-action-planning.mjs` | GOAP 能规划 JobAction，但不直接规划 Toil。 |
| `apps/game/tools/test-dynamic-event-jobs.mjs` | 秘境准备和参与 Job 写入真实事件状态。 |
| `apps/game/tools/test-job-interrupt-resume.mjs` | Reaction 打断 Job 后按配置恢复或重规划。 |

真实模拟观察：

- 扩展 `apps/game/tools/verify-dynamic-goals.mjs`，记录 JobAction 次数、Job 完成率、Toil 分布、失败原因、普通行为恢复率。
- 使用多种子长程模拟观察秘境准备、赶路、等待、参与是否真实发生。
- 观察开启 Job/Toil 后是否破坏基础修炼、生存、经济和关系行为。
- 不使用固定基线一致性证明，只观察真实行为指标。

验证命令：

```powershell
$env:DYNAMIC_EVENTS_ACTIVE = "1"
$env:DYNAMIC_GOALS_ACTIVE = "1"
$env:JOBS_ACTIVE = "1"
node tools/verify-dynamic-goals.mjs
```

2026-06-05 多种子 900 天真实模拟观察（seed=12345,67890,24680，完整世界系统开启，`JOBS_ACTIVE=1`）：

- 动态事件阶段变化 645 次，覆盖秘境和宗门大比事件窗口。
- 动态 Goal 候选观察 130539 次，动态 Goal 进入 planResult 84375 次。
- 动态行动准备 1677 次并成功 1677 次；参与 2674 次并成功 2674 次。
- JobAction 进入规划 84375 次；Job 启动 21707 次；Job 完成 4351 次；失败/中止 0 次。
- Job 分布：`job_npc_prepare_dynamic_event` 13968、`job_npc_join_dynamic_event` 4927、`job_npc_prepare_secret_realm` 2812。
- Toil 分布：`validate_announced` 16780、`move_to_event` 4927、`wait_active` 3695、`mark_participant` 2676、`ensure_heal_item` 2812、`ensure_artifact` 2110、`mark_prepared` 1677。
- 发生过动态行动 NPC 324 人，后续恢复普通行为 313 人，恢复率 96.6%。
- 验证不使用固定基线一致性证明，只观察真实行为指标。

## 迁移顺序

1. 新增 Job/Toil 基础设施和配置加载，默认关闭。（已完成）
2. 把 NPC 默认 action id 硬编码迁到 `npc-action-sets.json`。（已完成）
3. 添加首批 ToilPool 与通用 ToilExecutor。（已完成）
4. 添加首批 Job 配置。（已完成）
5. 将动态事件准备/参与切到 JobAction，保留旧 executor 作为短期兼容路径。（已完成）
6. 用单元脚本验证 Job/Toil 基础设施。（已完成）
7. 开启动态事件、动态目标和 jobs 开关，跑真实多种子长程模拟。（已完成）
8. 模拟行为达标后，把“准备秘境”和“参与秘境”作为 Job/Toil 的首个稳定用例记录到系统文档。（已完成）

## 验收标准

- 代码结构上，Action、Job、Toil、Execution 的职责能分别说明，不需要读 executor 大杂烩才能理解复杂行为。
- 配置结构上，高层 Action、Job 流程、Toil 类型、默认行为集分文件维护。
- GOAP 规划结果中仍只出现 Action ID，不出现 Toil ID。
- Job 日志能看到每个 NPC 当前 Job、当前 Toil、状态、失败原因和最终结果。
- `act_npc_prepare_dynamic_event` 不再把所有准备细节写在一个 executor 里。
- 秘境准备至少能真实经过检查状态、补给丹药、准备法器、标记 prepared。
- 秘境参与至少能真实经过移动到入口、等待 active、标记 joined。
- Reaction 打断时不会让 Job 永久卡住。
- 动态目标结束后，大部分 NPC 能恢复普通行为。
