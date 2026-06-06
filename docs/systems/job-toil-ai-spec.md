# Job/Toil AI 双重重构规格

> 最后更新：2026-06-06
> 状态：首批 Job/Toil 动态目标链路已正式默认启用；`ai-config.npc.jobs.enabled=false` 可作为回退开关
> 架构决策：ADR-048、ADR-049、ADR-050、ADR-051
> 来源：用户明确要求“保留 GOAP 作为中层规划器，把复杂 Action 的执行升级为 Job/Toil，逻辑和配置都拆清楚，并补齐缺少的 Job 与 Toil”；当前代码 `action.js`、`behavior-system.js`、`job-system.js`、`job-pool.js`、`toil-pool.js`、`npc-toils.js`、`dynamic-goals.json`、`npc-job-actions.json`、`npc-action-sets.json`、`npc-entity.js`。

## 目标

本规格定义一次配置和代码的双重重构：

1. 保留 Utility / Intent 负责选目标。
2. 保留 GOAP 负责规划高层 Action 链。
3. 将复杂 Action 的内部流程升级为 Job/Toil。
4. 迁移 NPC 旧直接执行型 Action；简单 Action 路径只保留给 Reaction、世界规则、势力行为或明确无需 Job 编排的兼容行为。
5. 把 Action、Job、Toil、默认行为集拆成清晰配置。
6. 补齐动态目标、秘境准备、宗门大比准备、获取回血丹、获取法器所需的初始 Job 和 Toil。

当前四层 AI 已落地；首批 Job/Toil 已作为默认启用的复杂行动执行层接入。`ai-config.npc.jobs.enabled=false` 回退时，运行时仍保持 `Reaction → Utility / Intent → GOAP → Execution`；默认启用后，复杂 JobAction 走 `Reaction → Utility / Intent → GOAP → Job / Toil → Execution`。

## 非目标

- 不删除 GOAP。
- 不删除 GOAP Action 抽象；JobAction 仍是 GOAP 的高层规划动作。
- 不把 Reaction、世界规则、势力行为等非 NPC 直接执行链路强行迁移到 Job/Toil。
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

ADR-050 首批落地时，SimpleAction 适合短小、单次结算或已有清晰 executor 的行为。ADR-051 后，NPC 旧直接执行型 Action 进入迁移阶段：修炼、任务、游历、战斗和外出社交等 NPC 业务行为默认应改为 JobAction + Job + Toil；SimpleAction 只作为 Reaction、世界规则、势力行为或临时兼容路径保留。

| 行为 | 例子 | 执行 |
|------|------|------|
| Reaction 即时反应 | 逃命、暂避、反击、濒死回血 | Reaction 强制单 Action 或短 Action。 |
| 世界/势力规则 | 世界 Tick 规则、势力级行动 | 对应系统 executor。 |
| 临时兼容 | 尚未迁移完且不在默认 NPC 行为集中的旧路径 | 仅用于测试或回退，不作为新增行为承载点。 |

SimpleAction 保持 `executionKind` 缺省为 `simple`。新增 NPC 行为若需要移动、耗时、资源准备、风险评估、目标绑定、失败回退或多步结算，必须进入 JobAction。

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
| `act_npc_job_cultivate` | `job_npc_cultivate` | 闭关修炼，结算数值修为与真气。 |
| `act_npc_job_train_chamber` | `job_npc_train_chamber` | 前往修炼场修炼。 |
| `act_npc_job_heal` | `job_npc_heal` | 疗伤恢复。 |
| `act_npc_accept_quest_job` | `job_npc_accept_quest` | 接取普通任务。 |
| `act_npc_accept_monster_hunt_job` | `job_npc_accept_quest` | 接取斩妖/猎妖任务并绑定结构化任务实例。 |
| `act_npc_execute_quest_job` | `job_npc_monster_hunt` 或普通任务 Job | 推进任务，斩妖任务必须真实移动并击杀目标妖兽。 |
| `act_npc_turn_in_quest_job` | `job_npc_turn_in_quest` | 交付任务并发放奖励。 |

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
│   ├── npc-social-jobs.json
│   ├── npc-quest-jobs.json
│   ├── npc-combat-jobs.json
│   └── npc-cultivation-jobs.json
└── toils/
    ├── core-toils.json
    ├── npc-economy-toils.json
    ├── npc-dynamic-event-toils.json
    ├── npc-social-toils.json
    ├── npc-quest-toils.json
    ├── npc-combat-toils.json
    └── npc-cultivation-toils.json
```

| 文件 | 职责 |
|------|------|
| `actions/npc-actions.json` | NPC SimpleAction。 |
| `actions/npc-job-actions.json` | NPC JobAction，只表达 GOAP 可规划的高层动作。 |
| `actions/npc-action-sets.json` | 默认 NPC 行为集，替代 `NPCEntity._initActions()` 中的硬编码 action id 列表。 |
| `jobs/npc-dynamic-event-jobs.json` | 秘境、大比、高手遗泽、关系伤亡等动态事件 Job。 |
| `jobs/npc-economy-jobs.json` | 获取丹药、兑换法器、补给等经济 Job。 |
| `jobs/npc-social-jobs.json` | 组队、求援、拜访、结伴等社交 Job。 |
| `jobs/npc-quest-jobs.json` | 接取、执行、交付任务；斩妖任务使用结构化任务实例。 |
| `jobs/npc-combat-jobs.json` | 战斗准备、撤退疗伤、邀请同伴等战斗智能 Job。 |
| `jobs/npc-cultivation-jobs.json` | 闭关修炼、修炼场修炼、疗伤等修为相关 Job。 |
| `toils/core-toils.json` | 移动、等待、设置状态、失败回退等通用 Toil 类型。 |
| `toils/npc-economy-toils.json` | 检查背包、检查灵石、购买、兑换、装备等 Toil 类型。 |
| `toils/npc-dynamic-event-toils.json` | 绑定事件、标记准备、等待阶段、参与事件等 Toil 类型。 |
| `toils/npc-social-toils.json` | 选择同伴、请求同行、确认关系对象等 Toil 类型。 |
| `toils/npc-quest-toils.json` | 接取任务、绑定斩妖目标、移动到任务目标、击杀目标、更新进度、交付任务。 |
| `toils/npc-combat-toils.json` | 评估战斗风险、准备补给、撤退、疗伤、放弃过强目标。 |
| `toils/npc-cultivation-toils.json` | 闭关修炼、修炼场修炼、疗伤结算。 |

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

## NPC 战斗智能闭环规则

NPC 战斗智能闭环分层执行：即时生死反应留在 Reaction 层；是否接取、准备、重定向、组队和撤退疗伤由 GOAP + Job/Toil 承担；真实伤害、击杀和死亡原因统一交给战斗结算服务。

### Reaction 即时战斗

- Reaction 层只处理眼前威胁，例如被妖兽袭击、濒死、仇敌贴脸或可反击窗口。
- 即时动作包括逃离、暂避、治疗和反击；这些动作可以暂停当前 Job，但不负责接取任务、挑选斩妖目标或规划补给链。
- Reaction 反击妖兽使用统一战斗场景 `monster_counter`，不得套用斩妖任务或妖兽主动袭击的倍率。

### GOAP 风险分支

- GOAP 仍只规划高层 Action，不直接规划 Toil。
- 风险状态由 BehaviorSystem 暴露为摘要字段，例如可承受、需要补给、需要疗伤、目标过强或需要同伴。
- 明显过强目标优先规划准备补给、撤退疗伤、请求同伴或放弃/重定向，而不是硬执行击杀。
- 任务风险、PvP 风险、机会点风险和地图遭遇风险进入统一风险/战斗结算入口，但保留不同 `scene` 以隔离倍率和经验来源。

### 路线风险与目标重定向

- 外出斩妖前必须解析任务坐标或目标妖兽当前位置，并通过路线风险评估判断是否可行。
- 目标死亡、迁移或失联时，允许按同阶位、同区域或任务坐标附近重定向到新的活体妖兽。
- 已判定过强或不可达的妖兽 id 进入 `excludedHuntMonsterIds`，避免同一 NPC 在短期内反复选择同一个坏目标。
- 找不到安全替代目标时，任务实例写入 `state:"failed"` 与 `failureReason:"target_lost"`，不得凭空完成。

### 组队斩妖

- 当风险评估发现单人胜率不足但仍有可行收益时，可进入 `job_npc_request_hunt_companion`。
- 同伴选择应考虑关系、距离、境界/战力、存活状态和当前可行动性。
- 组队状态写入 `huntCompanionId`、`huntPartyIds` 和战斗结算的 `assistNpcIds`；组队失败不能让任务链永久卡住，应重评估、等待或放弃目标。

### 任务实例闭环

- 杀怪任务的单一真相源是 `entity.state.activeQuestInstance`；`questTargetX`、`questTargetY`、`questTargetMonsterId` 等旧字段只作为兼容派生。
- 任务实例 ID 必须确定性生成，使用当前天数、NPC id 和 NPC 自增计数，不使用 `Date.now()`。
- 多目标任务通过 `activeQuestInstance.target.requiredKills` 和 `activeQuestInstance.target.killedCount` 推进；只有地图活体妖兽真实死亡后才增加击杀进度。
- `killedCount < requiredKills` 时任务继续保留 `hasActiveQuest=true`；达到要求后才能写 `questComplete=true` 并进入交付链路。

## 首批 Job 清单

| Job ID | 用途 | 首批 Toil |
|--------|------|-----------|
| `job_npc_prepare_dynamic_event` | 通用动态事件准备兜底 | 绑定事件、检查基础状态、标记准备。 |
| `job_npc_prepare_secret_realm` | 秘境准备 | 绑定秘境、检查 HP、确保回血丹、确保法器、可选找同伴、标记准备。 |
| `job_npc_join_dynamic_event` | 参与动态事件 | 绑定事件、移动到入口、等待 active、标记参与。 |
| `job_npc_prepare_sect_tournament` | 宗门大比准备 | 检查 HP、训练或修整、确保法器、移动到宗门、标记准备。 |
| `job_npc_acquire_heal_item` | 获取回血丹 | 查背包、找坊市或丹房、移动、检查灵石、购买或兑换、放入背包。 |
| `job_npc_acquire_artifact` | 获取法器 | 查装备、找宗门库房或坊市、检查贡献或灵石、兑换或购买、装备。 |
| `job_npc_accept_quest` | 接取任务 | 选择任务候选；斩妖任务绑定真实妖兽目标并生成结构化任务实例。 |
| `job_npc_monster_hunt` | 执行斩妖任务 | 绑定任务、评估风险、准备补给、移动、真实击杀目标、更新进度。 |
| `job_npc_turn_in_quest` | 交付任务 | 校验任务完成状态，发放奖励并清理任务状态。 |
| `job_npc_prepare_combat` | 准备战斗 | 评估风险并准备战斗补给。 |
| `job_npc_retreat_and_heal` | 撤退疗伤 | 移动到安全地点并使用疗伤物资。 |
| `job_npc_request_hunt_companion` | 邀请同伴斩妖 | 发起结伴请求，失败后不能卡死任务链。 |
| `job_npc_cultivate` | 闭关修炼 | 结算闭关修为与真气。 |
| `job_npc_train_chamber` | 修炼场修炼 | 移动到修炼场并结算加速修炼收益。 |
| `job_npc_heal` | 疗伤 | 恢复伤势。 |

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
| `toil_accept_quest` | 接取任务，斩妖候选必须绑定真实目标妖兽。 | `toils/npc-quest-toils.json` |
| `toil_bind_monster_hunt_quest` | 绑定或重定向斩妖任务目标。 | `toils/npc-quest-toils.json` |
| `toil_assess_monster_hunt_risk` | 评估斩妖任务风险。 | `toils/npc-quest-toils.json` |
| `toil_prepare_monster_hunt` | 准备斩妖补给。 | `toils/npc-quest-toils.json` |
| `toil_move_to_quest_target` | 前往任务目标坐标或目标妖兽当前位置。 | `toils/npc-quest-toils.json` |
| `toil_hunt_monster_target` | 调用统一战斗服务击杀目标妖兽。 | `toils/npc-quest-toils.json` |
| `toil_update_quest_progress` | 更新击杀数量和任务完成状态。 | `toils/npc-quest-toils.json` |
| `toil_turn_in_quest` | 交付任务并发放奖励。 | `toils/npc-quest-toils.json` |
| `toil_assess_combat_risk` | 通用战斗风险评估。 | `toils/npc-combat-toils.json` |
| `toil_prepare_combat_supply` | 准备战斗补给。 | `toils/npc-combat-toils.json` |
| `toil_retreat_to_safe_place` | 撤退到安全地点。 | `toils/npc-combat-toils.json` |
| `toil_use_heal_item` | 使用疗伤物资。 | `toils/npc-combat-toils.json` |
| `toil_abort_overdangerous_target` | 放弃明显过强目标。 | `toils/npc-combat-toils.json` |
| `toil_cultivate` | 闭关修炼，结算数值修为与真气。 | `toils/npc-cultivation-toils.json` |
| `toil_train_chamber` | 修炼场修炼。 | `toils/npc-cultivation-toils.json` |
| `toil_heal` | 疗伤。 | `toils/npc-cultivation-toils.json` |

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

## NPC 旧 Action 迁移规则

ADR-051 后，NPC 直接执行型旧 Action 不再作为默认主路径。迁移目标不是删除 GOAP，而是把 GOAP 可规划动作改成 JobAction，并把真实执行下沉到 Job/Toil。

迁移后的准入规则：

1. `apps/game/data/actions/npc-job-actions.json` 中必须存在 `executionKind:"job"` 的 JobAction，且 `jobId` 指向 `job_` 前缀 Job。
2. `apps/game/data/jobs/*.json` 中必须存在该 Job，并显式声明 Toil 序列、输入、成功效果和打断策略。
3. `apps/game/data/toils/*.json` 中必须登记 Job 引用的 Toil 类型。
4. `apps/game/js/engine/npc/toils/npc-toils.js` 必须注册对应 Toil executor。
5. `apps/game/data/actions/npc-action-sets.json` 的默认 NPC 行为集不得再引用已迁移旧 Action id；默认 NPC 行为通过 `defaultNpcJobActionIds` 追加 JobAction。
6. 旧 executor 只允许作为测试夹具或明确回退路径存在；确认无生产引用后应删除 import、注册和无引用类。

首批迁移范围：

| 领域 | 旧行为语义 | Job/Toil 主路径 |
|------|------------|-----------------|
| 修炼 | 闭关、修炼场、服用/兑换修炼资源、疗伤 | `job_npc_cultivate`、`job_npc_train_chamber`、`job_npc_heal` 与修炼/经济 Toil。 |
| 任务 | 接任务、执行任务、交付任务 | `job_npc_accept_quest`、`job_npc_monster_hunt`、`job_npc_turn_in_quest` 与任务 Toil。 |
| 游历/事件 | 外出游历、机会点、动态事件参与 | 游历、动态事件、机会点 Job 成功后统一追加历练修为。 |
| 战斗 | 斩妖、复仇、PvP、遭遇风险 | 战斗准备、风险评估、撤退疗伤、真实交战 Toil。 |
| 外出社交 | 拜访、师徒点化、结伴 | 社交 Job/Toil，并按价值和风险追加历练修为。 |

## 斩妖任务 Job/Toil 规则

斩妖、除害、猎灵兽等杀怪任务统一建模为 `type:"monster_hunt"` 的结构化任务实例。旧的 `questTargetX`、`questTargetY`、`questTargetMonsterId` 只作为 UI 或兼容派生字段，不能成为与任务实例相互矛盾的第二份真相源。

任务实例最小字段：

```json
{
  "id": "quest_npc_001_day_120",
  "templateId": "qt_slay_monster",
  "type": "monster_hunt",
  "name": "二阶斩妖",
  "category": "combat",
  "difficulty": 2,
  "value": 10,
  "riskKey": "monster_hunt",
  "riskScore": 0.055,
  "source": "quest_hall",
  "state": "accepted",
  "target": {
    "kind": "monster",
    "x": 123,
    "y": 45,
    "monsterIds": ["monster_abc"],
    "monsterName": "青鳞狼",
    "monsterGrade": 2,
    "requiredKills": 1,
    "killedCount": 0
  },
  "rewards": {
    "stones": 10,
    "contribution": 5,
    "factionStones": 25,
    "rewardProfileId": "qt_slay_monster"
  }
}
```

字段规则：

| 字段 | 规则 |
|------|------|
| `type` | 杀怪任务固定为 `monster_hunt`；普通采集、护送、巡山等继续使用各自任务类型。 |
| `value` | 来自任务难度、奖励、目标妖兽资源价值，用于 GOAP 价值估算与历练修为倍率。 |
| `riskScore` | 来自任务危险度、目标妖兽阶位、双方战力差和距离，用于风险决策与历练修为倍率。 |
| `target.x` / `target.y` | 接取时锁定的目标坐标；执行时必须移动到该坐标或目标妖兽当前位置附近。 |
| `target.monsterIds` | 目标地图妖兽实例 id；多目标任务逐个击杀，或按同阶同区域重定向。 |
| `target.monsterName` | 接取时记录的妖兽名，用于日志、UI、验证与死亡原因。 |
| `target.requiredKills` | 任务要求击杀数量，首批斩妖为 1，猎灵兽可按难度扩展。 |
| `target.killedCount` | 已真实击杀数量；只有地图活体妖兽死亡后才增加。 |

接取规则：

- `toil_accept_quest` 或 `toil_bind_monster_hunt_quest` 选择 `locationTarget:"monster"` 候选时，必须从地图活体妖兽中选择与任务难度匹配的目标。
- 没有可用妖兽时，不生成空目标杀怪任务；候选应跳过或返回无可接取任务。
- 接取时写入坐标、妖兽 id、妖兽名、阶位、目标数量、价值和风险。

执行规则：

1. `job_npc_monster_hunt` 必须先绑定任务实例，再评估风险、准备补给、移动到目标、真实结算击杀、更新进度。
2. `toil_assess_monster_hunt_risk` 需要比较 NPC 战力、真气、伤势、补给、目标阶位和距离；明显过强时返回重规划、撤退、请求同伴或放弃任务。
3. `toil_prepare_monster_hunt` 负责疗伤丹、符箓、基础法器等补给准备；补给不足时先转经济/兑换 Job，不能硬杀。
4. `toil_hunt_monster_target` 必须调用统一战斗/风险结算服务，场景为 `monster_hunt_quest`。
5. 成功击杀时，目标妖兽必须写 `alive=false`，死亡原因使用 `quest_hunt`，并进入 `tickLog.monsterDeaths`。
6. 目标已死亡、迁移或失联时，允许按同阶位、同任务坐标附近重定向；新目标 id、名称、坐标必须写回任务实例。
7. 找不到替代目标时任务失败为 `target_lost`，不得凭空完成。
8. `killedCount >= requiredKills` 后才允许写 `questComplete=true`。

任务日志和 `infoEvents` 至少包含 NPC、任务类型、难度、价值、风险、目标妖兽名、妖兽 id、阶位、坐标、击杀进度、成功/失败原因。

## 历练修为与数值修为规则

“修炼进度”迁移为明确数值“修为”。真气仍保留为独立资源，并与修为共同参与突破判定。

状态字段：

| 字段 | 语义 |
|------|------|
| `cultivation` | 闭关、修炼场、丹药等直接修炼获得的闭关修为。 |
| `experienceCultivation` | 外出历练、任务、动态事件、机会点、战斗、外出社交获得的历练修为。 |
| `totalCultivation` | `cultivation + experienceCultivation`，用于突破修为门槛。 |
| `cultivationProgressRatio` | `totalCultivation / nextCultivationRequired`，仅作兼容和百分比 UI，不作为主显示语义。 |

突破判定使用：

```text
totalCultivation >= nextRank.cultivationRequired
qi >= nextRank.qiRequired
cultivation >= nextRank.cultivationRequired * minCultivationRatio
```

非闭关、非原地待命事件都应按价值和风险追加历练修为。统一入口语义为：

```js
applyCultivationExperience(entity, worldContext, {
  sourceKind,
  value,
  riskScore,
  durationDays,
  outcome,
  description
})
```

首批 `sourceKind`：

| sourceKind | 触发点 |
|------------|--------|
| `quest_progress` | 普通任务或杀怪任务推进中的每日外出执行。 |
| `quest_complete` | 普通任务完成。 |
| `monster_hunt_success` | 杀怪任务真实击杀妖兽。 |
| `monster_hunt_failure` | 杀怪任务失败但 NPC 存活。 |
| `explore` | 游历归来。 |
| `dynamic_event` | 动态事件参与成功。 |
| `opportunity` | 机会点收益结算。 |
| `pvp` | 真实 PvP 交战后存活。 |
| `social_travel` | 师徒点化、拜访、同行请求等外出社交完成。 |

不追加历练修为：

- 闭关修炼、修炼场修炼等直接修炼 Job。
- 原地等待事件阶段、待命、纯 UI 刷新或纯状态同步。
- 已死亡 NPC 的失败结果。

收益公式由 `apps/game/data/balance/cultivation.json` 的 `experience` 段控制；收益随 `value`、`riskScore`、`durationDays` 和 `outcome` 放大，并写入 `experienceCultivation` 后同步 `totalCultivation`。日志展示为 `历练修为+X.X`。

## 妖兽主动伤害场景隔离

地图妖兽主动袭击 NPC 的单击倍率只属于统一战斗服务的 `monster_ambush` 场景，配置位于 `apps/game/data/balance/monster-spawn.json` 的 `combat.damageMultiplier`。该倍率用于缓解低阶人物被一阶妖兽过快击倒，不影响：

- NPC 反击妖兽的 `monster_counter` 场景。
- 斩妖任务的 `monster_hunt_quest` 场景。
- NPC PvP 的 `pvp` 场景。
- 普通任务和游历风险的 `quest_risk` 等场景。

## 配置开关

新增 `ai-config.json` 的 NPC 段：

```json
{
  "jobs": {
    "enabled": true,
    "maxActiveJobsPerNpc": 1,
    "logToilEvents": true
  }
}
```

正式启用后默认 `enabled=true`。回退为 `false` 时：

- JobPool 和 ToilPool 可加载，但 JobAction 不参与默认行为集。
- 动态事件配置仍按 `dynamic-events.json` 与 `dynamic-goals.json` 的开关独立控制。
- SimpleAction 行为不变。

保持 `enabled=true` 时：

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
- `apps/game/data/jobs/npc-quest-jobs.json`
- `apps/game/data/jobs/npc-combat-jobs.json`
- `apps/game/data/jobs/npc-cultivation-jobs.json`
- `apps/game/data/toils/core-toils.json`
- `apps/game/data/toils/npc-dynamic-event-toils.json`
- `apps/game/data/toils/npc-economy-toils.json`
- `apps/game/data/toils/npc-social-toils.json`
- `apps/game/data/toils/npc-quest-toils.json`
- `apps/game/data/toils/npc-combat-toils.json`
- `apps/game/data/toils/npc-cultivation-toils.json`

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
| `apps/game/tools/test-npc-action-job-migration.mjs` | 已迁移旧 NPC Action 不再出现在默认直接执行路径中，对应 JobAction/Job/Toil 可加载。 |
| `apps/game/tools/test-monster-hunt-job.mjs` | 斩妖任务绑定真实妖兽、推进多日任务并更新击杀进度。 |
| `apps/game/tools/test-combat-intelligence-jobs.mjs` | 战斗风险、撤退疗伤、补给与过强目标处理。 |
| `apps/game/tools/test-cultivation-experience-gain.mjs` | 任务、动态事件等外出行为按价值和风险追加历练修为。 |
| `apps/game/tools/test-numeric-cultivation-migration.mjs` | 旧比例进度转换为数值修为字段，并参与突破判定。 |

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

2026-06-05 默认配置路径验证：

- 验证报告：`docs/superpowers/reports/2026-06-05-Job-Toil默认启用验证.md`。
- 命令不依赖 `JOBS_ACTIVE`、`DYNAMIC_EVENTS_ACTIVE`、`DYNAMIC_GOALS_ACTIVE` 环境变量。
- 验收门槛：900 天、3 种子、Job 失败/abort 为 0、动态行动后普通行为恢复率不低于 90%。
- 验证方式仍是完整模拟行为观察，不使用固定摘要一致性证明。

## 迁移顺序

1. 新增 Job/Toil 基础设施和配置加载，初期以回退开关保护，正式启用后默认开启。（已完成）
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
