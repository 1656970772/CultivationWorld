# 游戏数据配置规则

> 最后更新：2026-06-07

本文档定义 `apps/game/data/` 的现行目录结构、命名规范和扩展规则。来源以当前 `apps/game/js/core/config-loader.js` 与 `apps/game/data/` 为准。

## 目录总览

```text
apps/game/data/
├── abilities/
│   └── combat-abilities.json
├── actions/
│   ├── faction-actions.json
│   ├── npc-action-sets.json
│   ├── npc-actions.json
│   ├── npc-job-actions.json
│   ├── reaction-actions.json
│   └── world-rules.json
├── balance/
│   ├── combat.json
│   ├── covet.json
│   ├── cultivation.json
│   ├── economy.json
│   ├── emotion.json
│   ├── memory.json
│   ├── monster-spawn.json
│   ├── movement.json
│   ├── obsession.json
│   ├── personality.json
│   ├── reaction.json
│   ├── relationship.json
│   ├── reward.json
│   ├── risk.json
│   ├── social.json
│   └── utility.json
├── behavior-trees/
│   ├── faction-default.json
│   ├── monster-tier1.json
│   ├── monster-tier2.json
│   ├── monster-tier3.json
│   └── npc-default.json
├── config/
│   ├── ai-config.json
│   └── game-config.json
├── definitions/
│   ├── combat-base-table.json
│   ├── cultivator-combat.json
│   ├── macro-resources.json
│   ├── monster-combat.json
│   ├── monster-attribute-templates.json
│   ├── monsters.json
│   ├── names.json
│   ├── ranks.json
│   ├── techniques.json
│   ├── terrains.json
│   └── weapons.json
├── effects/
│   ├── combat-effects.json
│   └── core-effects.json
├── economy/
│   └── transaction-scenarios.json
├── entities/
│   ├── factions.json
│   └── npcs.json
├── goals/
│   └── dynamic-goals.json
├── jobs/
│   ├── npc-dynamic-event-jobs.json
│   ├── npc-economy-jobs.json
│   ├── npc-social-jobs.json
│   ├── npc-quest-jobs.json
│   ├── npc-combat-jobs.json
│   └── npc-cultivation-jobs.json
├── items/
│   ├── artifact.json
│   ├── currency.json
│   ├── material.json
│   ├── pill.json
│   ├── talisman.json
│   └── technique.json
├── needs/
│   ├── faction-needs.json
│   └── npc-needs.json
├── quests/
│   └── quest-templates.json
├── relationships/
│   ├── dictionaries/
│   │   ├── group-types.json
│   │   ├── marks.json
│   │   ├── relation-event-types.json
│   │   ├── signal-keys.json
│   │   └── tags.json
│   ├── event-hooks/
│   │   └── legacy-events.json
│   ├── groups/
│   │   └── groups.json
│   ├── impact-rules/
│   │   ├── combat.json
│   │   ├── faction.json
│   │   └── social.json
│   ├── schemas/
│   │   └── ledgers.json
│   └── signal-rules/
│       └── wanted-chain.json
├── tags/
│   └── tags.json
├── toils/
│   ├── core-toils.json
│   ├── npc-dynamic-event-toils.json
│   ├── npc-economy-toils.json
│   ├── npc-social-toils.json
│   ├── npc-quest-toils.json
│   ├── npc-combat-toils.json
│   └── npc-cultivation-toils.json
└── world/
    ├── dynamic-events.json
    ├── map.json
    ├── modifiers.json
    ├── news.json
    └── opportunities.json
```

## 通用规范

| 项 | 规则 |
|----|------|
| 文件名 | 使用 `kebab-case` |
| 数据 ID | 使用 `snake_case` |
| 中文名 | `name` 字段使用简体中文 |
| 编码 | UTF-8 |
| JSON 缩进 | 2 空格 |
| 注释字段 | 使用 `_description`、`_comment` 等显式字段 |
| 新数据文件 | 同步更新 `config-loader.js` 和本文档 |

## 加载约定

`ConfigLoader.loadGameConfigs()` 显式列举所有运行时 JSON。新增文件后不能只放入目录，必须同时接入加载器和相关池/系统。

当前有以下合并或显式加载约定：

- `items/*.json`：按 category 拆分，加载后合并为 `itemDefs.items`。
- `effects/*.json`：战斗 GE 与通用 GE 合并为 `effects.effects`。
- `jobs/*.json`：按业务域拆分，加载后合并为 `jobs.jobs` 并交给 `JobPool`。
- `toils/*.json`：按执行器域拆分，加载后合并为 `toils.toils` 并交给 `ToilPool`。
- `definitions/combat-base-table.json`：由加载器显式读取为 `combatBaseTable`，提供境界参考基表和小层倍率。
- `definitions/cultivator-combat.json`：由加载器显式读取为 `cultivatorCombat`，提供普通修士裸面板。
- `definitions/monster-combat.json`：由加载器显式读取为 `monsterCombat`，提供普通妖兽危险层级参考表。
- `definitions/monster-attribute-templates.json`：由加载器显式读取为 `monsterAttributeTemplates`，供妖兽属性计算器和运行时生成入口使用。
- `economy/transaction-scenarios.json`：由加载器显式读取为 `economicTransactionConfig`，供统一经济交易底座读取场景、托管、债务与抽象拍卖规则。
- `relationships/**/*.json`：三层关系全数据平台配置，由加载器显式读取并组装为 `relationshipPlatform`，交给 `RelationshipSystem` 门面。

## entities/

### factions.json

当前包含 16 个势力/组织：10 个核心势力和 6 个功能组织。

常用字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一 ID，如 `sect_001`、`org_market` |
| `name` | string | 中文名 |
| `type` | string | `righteous` / `evil` / `neutral` / `demon` |
| `subtype` | string? | 功能组织子类，如 `market`、`bounty_hall` |
| `headquarters` | object | 总部坐标 `{ x, y }` |
| `stability` | number | 初始稳定度 |
| `resources` | object | 初始资源，键引用宏观资源或物品 ID |
| `leader` | string | 首领 NPC ID |
| `traits` | string[] | 势力倾向 |
| `territoryCount` | number | 初始领地规模参数 |
| `roleQuota` | object | 高阶职位名额，如 elder/heir |
| `relations` | object | 与其他势力的初始关系 |

### npcs.json

当前包含 126 个初始 NPC。

常用字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一 ID |
| `name` | string | 中文名 |
| `factionId` | string? | 所属势力或组织，散修可为空 |
| `role` | string | `leader` / `heir` / `elder` / `core_disciple` / `outer_disciple` / `wanderer` 等 |
| `rankId` | string | 引用 `definitions/ranks.json` |
| `gender` | string | `male` / `female` |
| `personality` | object | 野心、谨慎、忠诚、外交等维度 |
| `techniqueId` | string? | 引用 `definitions/techniques.json` |
| `alive` | boolean | 初始存活状态 |

运行时会补齐年龄、寿元、血量、空间坐标、灵根/体质、背包、关系、记忆、执念等状态。

数值修为迁移后，NPC 运行时状态还应维护：

| 字段 | 类型 | 说明 |
|------|------|------|
| `cultivation` | number | 闭关、修炼场、丹药等直接修炼获得的闭关修为 |
| `experienceCultivation` | number | 任务、游历、动态事件、机会点、PvP、外出社交获得的历练修为 |
| `totalCultivation` | number | `cultivation + experienceCultivation`，突破修为门槛使用 |
| `rankStage` | string | `early` / `middle` / `late` / `perfection`，按总修为完成度派生 |
| `nextCultivationRequired` | number | 下一境界所需数值修为；顶级境界为 0 |
| `cultivationShortfall` | number | 距下一境界修为门槛的差额 |
| `cultivationRootShortfall` | number | 距最低闭关修为占比的差额 |

旧比例字段已从运行时、快照、UI 和应用工具中移除。真气 `qi` 独立保留，突破同时检查数值修为、最低闭关修为占比与真气。

战斗智能与斩妖任务运行时还会维护以下状态：

| 字段 | 类型 | 说明 |
|------|------|------|
| `activeQuestInstance` | object/null | 当前运行时任务实例；斩妖任务的单一真相源，包含目标、价值、风险、奖励和击杀进度 |
| `excludedHuntMonsterIds` | string[] | 当前 NPC 短期内排除的过强、失效或不可达斩妖目标 |
| `huntCompanionId` | string/null | 当前邀请或绑定的斩妖同伴 NPC ID |
| `huntPartyIds` | string[] | 当前斩妖小队成员 ID，战斗结算时可派生为 `assistNpcIds` |
| `needsCombatRecovery` | boolean | 战斗风险或受伤后需要撤退疗伤/补给的摘要状态 |
| `questTargetX` / `questTargetY` / `questTargetMonsterId` | number/string/null | 兼容派生字段；不得覆盖 `activeQuestInstance.target` |

## definitions/

| 文件 | 说明 |
|------|------|
| `ranks.json` | 修仙境界、寿元、继任评分 |
| `macro-resources.json` | 势力宏观资源，目前用于 `food`、`disciples` |
| `terrains.json` | 地形定义 |
| `techniques.json` | NPC 当前修炼功法定义，供 `techniqueRegistry`、修炼加成和战斗属性修正读取；不同于 `items/technique.json` 的秘籍物品 |
| `combat-base-table.json` | 境界战斗参考基表，含 `stageMultipliers` 和六项属性参考值 |
| `cultivator-combat.json` | 普通修士裸面板，供修士战斗属性新路径初始化 |
| `monster-combat.json` | 普通妖兽危险层级参考表，不替代妖兽模板运行时 |
| `weapons.json` | 武器/法宝参考定义 |
| `monster-attribute-templates.json` | 妖兽阶位基准、体型、移动、战斗风格、属性、特殊类型和习性模板 |
| `monsters.json` | 妖兽定义，当前 36 条；通过五层模板生成直接面板属性 |
| `names.json` | 出生 NPC 姓名池 |

`ranks.json` 中 `rankId` 只表示修仙境界，不承载职位、头衔或凡人王朝身份。修仙境界需要同时维护 `qiRequired` 与 `cultivationRequired`。前者是真气突破门槛，后者是数值修为突破门槛；运行时不再使用旧比例进度字段作为突破依据。

`combat-base-table.json`、`cultivator-combat.json`、`monster-combat.json` 统一使用六项战斗属性：`hp`、`yuan`、`attack`、`defense`、`speed`、`soul`。三张表的 `ranks` key 必须与 `ranks.json` 的 12 个运行时境界完全一致，不得包含额外未来高阶层级。

`definitions/techniques.json` 中代表性功法可在 `effects.combatModifiers` 声明 AttributeSet 修正。字段格式为 `{ "attribute": "attack", "op": "multiply", "magnitude": 1.12 }`，由运行时按 `technique_combat` 来源分组刷新。`items/technique.json` 是可交易、可抢夺的功法秘籍物品清单，加载后合并到 `itemDefs.items`，不承载 NPC 当前修炼功法的战斗面板修正。

`monsters.json` 中新妖兽必须声明 `templates` 与 typed `skills[]`。运行时通过 `monsterAttributeTemplates` 和 `resolveMonsterAttributes()` 得到 `hp`、`qi`、`attack`、`defense`、`speed`、`spirit` 直接面板，并保留 `vitality`、`strength`、`sense` 兼容镜像。

## world/

| 文件 | 说明 |
|------|------|
| `map.json` | 300×300 地图，字段见 `docs/data-models/world-map.md` |
| `modifiers.json` | 世界修正器模板，由 `world-rules.json` 的世界规则生成和衰减 |
| `news.json` | 信息传播配置 |
| `opportunities.json` | 机会点配置 |
| `dynamic-events.json` | 动态世界事件配置，正式启用后默认 `enabled=true` |

### dynamic-events.json

动态世界事件由 `WorldEventSystem` 维护生命周期。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 总开关，正式启用后默认 true |
| `awareness.defaultConfidenceByScope` | object | public/faction/relationship 的默认可信度 |
| `events[]` | array | 预设事件列表 |
| `events[].id` | string | 事件 ID |
| `events[].type` | string | `secret_realm` / `sect_tournament` / `auction` / `treasure_born` / `fallen_master` / `relationship_death` |
| `events[].announceDay` | number | 预告日 |
| `events[].startDay` | number | 开始日 |
| `events[].endDay` | number | 结束日 |
| `events[].expireDay` | number? | 过期日 |
| `events[].scope` | string | `public` / `faction` / `relationship` |
| `events[].pos` | object? | 坐标或 resolver |

## goals/

### dynamic-goals.json

动态目标由 `DynamicGoalProvider` 从 NPC 已知事件中临时产出，不写入常驻需求。

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 总开关，正式启用后默认 true |
| `maxGoalsPerNpc` | number | 每个 NPC 同时考虑的动态目标上限 |
| `goals[]` | array | 规则列表 |
| `goals[].id` | string | 动态目标规则 ID |
| `goals[].eventType` | string | 匹配动态事件类型 |
| `goals[].phases` | string[] | 匹配事件阶段 |
| `goals[].kind` | string | `preparation` / `window` / `immediate` |
| `goals[].basePriority` | number | 基础优先级 |
| `goals[].urgency` | number | 紧急度 |
| `goals[].requiredAwarenessConfidence` | number | 最低可信度 |
| `goals[].motiveWeights` | object | 与 NPC 动机/性格联动的乘子 |
| `goals[].interrupt` | object | 交给 `InterruptPolicy` 的打断口径 |
| `goals[].goalState` | object | GOAP 目标状态 |

## quests/

### quest-templates.json

任务模板只描述可生成任务的类型、难度范围、目标类型和基础描述；NPC 接取后在 `entity.state.activeQuestInstance` 形成运行时任务实例。斩妖、除害、猎灵兽等杀怪任务实例统一为 `type:"monster_hunt"`，并记录真实地图妖兽目标。

杀怪任务实例字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 运行时任务实例 ID |
| `templateId` | string | 来源模板，如 `qt_slay_monster` |
| `type` | string | 杀怪任务固定为 `monster_hunt` |
| `name` | string | 任务名称 |
| `category` | string | `combat` 等任务分类 |
| `difficulty` | number | 任务难度 |
| `value` | number | 价值评分，用于 GOAP 与历练修为倍率 |
| `riskKey` | string | 风险类型键，如 `monster_hunt` |
| `riskScore` | number | 风险评分，用于决策与历练修为倍率 |
| `source` | string | 任务来源，如 `quest_hall` |
| `state` | string | `accepted` / `in_progress` / `completed` / `failed` / `turned_in` |
| `target.kind` | string | `monster` |
| `target.x` / `target.y` | number | 接取任务时锁定的目标坐标 |
| `target.monsterIds` | string[] | 目标妖兽实例 ID 列表 |
| `target.monsterName` | string | 目标妖兽名 |
| `target.monsterGrade` | number | 目标妖兽阶位 |
| `target.requiredKills` | number | 任务要求击杀数量 |
| `target.killedCount` | number | 已真实击杀数量 |
| `rewards` | object | 灵石、贡献、势力资源等奖励 |

`questTargetX`、`questTargetY`、`questTargetMonsterId` 只能作为兼容派生字段。单一真相源是 `activeQuestInstance`；完成杀怪任务必须对应地图活体妖兽真实死亡。多目标任务只有在 `target.killedCount >= target.requiredKills` 后才能写 `questComplete=true`。

## needs/ 与 actions/

`NeedPool` 读取 `needs/*.json` 产出目标，`ActionPool` 读取 `actions/*.json` 产出可规划/可执行行为。

| 文件 | 说明 |
|------|------|
| `needs/faction-needs.json` | 势力需求 |
| `needs/npc-needs.json` | NPC 常驻需求 |
| `actions/faction-actions.json` | 势力 GOAP 行为 |
| `actions/npc-actions.json` | NPC SimpleAction 行为 |
| `actions/npc-job-actions.json` | NPC JobAction 行为；`executionKind` 必须为 `job`，运行期 `effects` 为空，规划效果写入 `plannerEffects` |
| `actions/npc-action-sets.json` | NPC 默认行为集；`defaultNpcActionIds` 放 SimpleAction，`defaultNpcJobActionIds` 仅在 `ai-config.npc.jobs.enabled=true` 时加入 |
| `actions/reaction-actions.json` | Reaction 层即时反应行为 |
| `actions/world-rules.json` | 世界 Tick 级规则 |

`npcConfig.actionIds` 是单体 NPC 的显式行为覆盖：存在时按该列表直接初始化行为，不再读取默认行为集；`ai-config.npc.jobs.enabled=false` 只控制默认行为集是否追加 `defaultNpcJobActionIds`。

新增行为时需要：

1. NPC 新行为默认在 `npc-job-actions.json` 中新增 JobAction，`executionKind` 必须为 `job`，`jobId` 必须引用 `job_` 前缀 Job。
2. 在 `apps/game/data/jobs/*.json` 中新增或复用 Job，并在 `apps/game/data/toils/*.json` 中新增或复用 Toil。
3. 在 `apps/game/js/engine/npc/toils/npc-toils.js` 注册 Toil executor。
4. 必要时补充目标状态、targetResolver、风险键、收益键。
5. 已迁移旧 NPC Action 不得继续出现在 `defaultNpcActionIds` 中；默认主路径由 `defaultNpcJobActionIds` 承载。
6. 新增或修改 JobAction 时必须运行配置加载/规划/迁移守卫测试，至少覆盖 `test-job-config-load.mjs`；涉及默认 NPC 行为迁移时同时运行 `test-npc-action-job-migration.mjs`；涉及 GOAP 规划时运行 `test-job-action-planning.mjs`。
7. 运行相关 `apps/game/tools/test-*.mjs` 或长程模拟观察。

## jobs/ 与 toils/

Job/Toil 层用于 NPC 复杂行动编排。GOAP 只规划 `actions/npc-job-actions.json` 中的高层 JobAction，执行层再由 `JobSystem` 推进 Job 内部的 Toil 序列。

| 文件 | 说明 |
|------|------|
| `jobs/npc-dynamic-event-jobs.json` | 动态事件准备、参与等 Job |
| `jobs/npc-economy-jobs.json` | 获取疗伤物资、法器等经济 Job |
| `jobs/npc-social-jobs.json` | 寻找同行者等社交 Job |
| `jobs/npc-quest-jobs.json` | 接取、执行、交付任务；斩妖任务走真实目标绑定与击杀进度 |
| `jobs/npc-combat-jobs.json` | 战斗准备、撤退疗伤、请求同伴等战斗智能 Job |
| `jobs/npc-cultivation-jobs.json` | 闭关修炼、修炼场修炼、疗伤等修为相关 Job |
| `toils/core-toils.json` | 解析目标、移动、等待、写状态等核心 Toil |
| `toils/npc-dynamic-event-toils.json` | 绑定事件、校验阶段、标记准备/参与等动态事件 Toil |
| `toils/npc-economy-toils.json` | 检查背包、购买、兑换、装备法器等经济 Toil |
| `toils/npc-social-toils.json` | 选择同行者、请求同行等社交 Toil |
| `toils/npc-quest-toils.json` | 接任务、绑定斩妖目标、评估任务风险、移动、击杀、更新进度、交付 |
| `toils/npc-combat-toils.json` | 评估战斗风险、准备补给、撤退、安全疗伤、放弃过强目标 |
| `toils/npc-cultivation-toils.json` | 闭关修炼、修炼场修炼、疗伤 |

新增 Job/Toil 时需要：

1. Job ID 使用 `job_` 前缀，Toil ID 使用 `toil_` 前缀。
2. Job 内 `toils[].type` 必须引用已登记的 Toil ID。
3. Toil 执行器在 `apps/game/js/engine/npc/toils/npc-toils.js` 注册。
4. 正式启用后 `ai-config.npc.jobs.enabled` 默认保持 `true`；如需回退可改为 `false`，关闭后 NPC 默认行为集不追加 `defaultNpcJobActionIds`。
5. Job/Toil 参数中的 `itemId`、`priceItemId`、`currencyItemId` 必须引用 `items/*.json` 合并后的真实物品 ID；禁止使用旧占位 ID。
6. 动态事件准备类 JobAction 必须按事件类型增加前置，例如秘境使用 `dynamicEventIsSecretRealm=true`，宗门大比使用 `dynamicEventIsSectTournament=true`，通用准备使用 `dynamicEventUsesGenericPreparation=true`。
7. 动态事件准备类 Job 成功后必须写入类型化准备状态，例如 `preparedForSecretRealm`、`preparedForSectTournament` 或 `preparedForGenericDynamicEvent`；`preparedForDynamicEvent` 只作为兼容汇总状态。
8. 需要绑定具体动态事件的 Job 应在输入或 Toil 参数中声明期望事件类型，并在绑定事件阶段校验，避免专用 Job 绑定到错误事件。
9. `dynamic-events.enabled`、`dynamic-goals.enabled` 与 `ai-config.npc.jobs.enabled` 共同决定 Job/Toil 动态目标链路是否进入默认体验；正式启用后三者默认均为 `true`，回退时应在验证报告或 ADR 中说明关闭范围。
10. 斩妖任务 Job 必须使用结构化任务实例，记录坐标、价值、风险、妖兽名、妖兽 id、阶位、要求数量和击杀进度；完成条件必须来自真实妖兽死亡。
11. 非闭关、非原地待命的任务、游历、动态事件、机会点、PvP、外出社交等 Job 应通过统一入口追加 `experienceCultivation`。
12. 新增 Toil 类型必须在 `npc-toils.js` 注册 executor，并通过 `test-job-config-load.mjs` 覆盖 Job 引用和 executor 加载；不得只新增 JSON 而不接入执行器。

## items/

可持有物品按 `category` 拆分，运行时合并为一个 `itemDefs.items`。

| 文件 | category | 说明 |
|------|----------|------|
| `currency.json` | currency | 灵石等货币，也可作为修炼资源挂 Effect |
| `material.json` | material | 妖丹、妖材、灵草、矿材、精血等 |
| `pill.json` | pill | 修炼、突破、疗伤、恢复丹药 |
| `artifact.json` | artifact | 法宝/古宝/灵宝等 |
| `talisman.json` | talisman | 遁地符、攻击/防御/疗伤符 |
| `technique.json` | technique | 功法秘籍 |

通用字段：

| 字段 | 说明 |
|------|------|
| `id` / `name` / `category` | 基本信息 |
| `subCategory` | 细分类型 |
| `grade` / `gradeName` | 品阶 |
| `value` | 身家估值与收益评估 |
| `transferable` | 是否可转移/被抢夺 |
| `combatBonus` | 法宝战力加成 |
| `effects` | 服用/使用时挂载的 `ge_*` 效果 spec |
| `grantsAbilities` | 授予 `ga_*` 能力 |

## GAS 机制资产

| 类型 | 路径 | ID 规则 |
|------|------|---------|
| GameplayTag | `tags/tags.json` | 层级字符串，如 `State.Dying` |
| GameplayEffect | `effects/*.json` | `ge_` 前缀 |
| GameplayAbility | `abilities/*.json` | `ga_` 前缀 |
| GameplayCue | `cues/*.json` | `gc_` 前缀，预留 |

GE 必须是通用机制原语；具体数值由物品、能力或调用方 spec 提供。

## economy/

`economy/transaction-scenarios.json` 是统一经济交易底座的运行时规则目录。代码只负责执行资产校验、托管、结算、账本、债务和信号；场景倍率、正式/私人规则、拍卖参数和可抵押资产范围由本文件提供。

| 字段 | 说明 |
|------|------|
| `currencyItemId` | 第一版基础计价货币，当前为 `low_spirit_stone` |
| `scenarios` | 交易场景定义；key 使用 snake_case |
| `scenarios.*.kind` | `formal` 或 `private`；正式交易默认稳定，私人交易允许违约 |
| `scenarios.*.priceMultiplier` | 基础 `value` 的场景倍率 |
| `scenarios.*.escrowRequired` | 是否默认要求托管 |
| `assets.factionStateResourceIds` | 以势力 `state` 为真相源的资源键 |
| `assets.organizationPointKeys` | 贡献、战功、宗门信用等组织点数 |
| `escrow.defaultHolderByScenario` | 场景默认托管机构 |
| `debt.defaultDueDays` | 债务默认到期天数 |
| `auction.defaultLots` | 无玩家抽象拍卖的默认拍品池 |

## relationships/

`relationships/` 是三层关系底座的运行时规则目录。代码只提供账本仓储、selector、表达式解释器、impact pipeline 和 signal provider；关系业务优先通过本目录 JSON 扩展。

| 目录 | 说明 |
|------|------|
| `schemas/ledgers.json` | 三层账本 core/potential 字段、默认值和 clamp 范围 |
| `dictionaries/marks.json` | RelationMark 字典，定义层级、叠加方式、默认权重、衰减和信号提示 |
| `dictionaries/tags.json` | RelationTag 字典，定义身份标签、层级、叠加方式和默认 modifier |
| `dictionaries/signal-keys.json` | `facts/gates/modifiers/targetPreferences` 白名单 |
| `dictionaries/relation-event-types.json` | 标准 `RelationEvent.type` 白名单 |
| `dictionaries/group-types.json` | 第一版持久 group 类型 |
| `event-hooks/legacy-events.json` | 旧 `RelationshipSystem.applyEvent` 事件名到标准 `RelationEvent` 的兼容映射 |
| `impact-rules/*.json` | 标准事件如何写入三层账本 |
| `signal-rules/*.json` | 三层账本如何输出现有 AI 可消费信号 |
| `groups/groups.json` | 稳定组织/子群体定义，第一版主要由 `factionId` 派生 |

新增关系规则时：

1. 新 mark/tag/event/signal key 先登记到对应 dictionary。
2. 事件来源只声明 hook 或发布标准 `RelationEvent`，不得在战斗、NPC、势力领域代码直接改账本。
3. 新业务影响写入 `impact-rules/`；AI 决策影响写入 `signal-rules/`。
4. 如果需要新增 selector、condition 或 effect 能力，先确认现有解释器不能表达，再新增 operator，并补 `test-relationship-platform.mjs`。
5. 修改本目录后至少运行 `test-relationship-platform.mjs`、`test-relationship-wanted-chain.mjs` 和相关 AI 回归。

## balance/

平衡文件只放数值和开关，不放执行逻辑。

| 文件 | 说明 |
|------|------|
| `combat.json` | 战斗、攻伐、生存、GAS 总开关 |
| `economy.json` | 资源产出、消耗、兑换、丹药使用 |
| `cultivation.json` | 修炼速度、突破、灵根/体质、月度贡献 |
| `risk.json` | 游历、PvP、机会点等风险 |
| `reward.json` | 期望收益与掉落 |
| `relationship.json` | 旧关系边兼容开关、旧关系目标、妖群、师徒过渡参数；新三层关系业务使用 `relationships/` |
| `reaction.json` | Reaction 层阈值和动作映射 |
| 其他 | 社交、移动、记忆、执念、情绪、人格、怀璧其罪等 |

### cultivation.json

`cultivation.json` 继续维护修炼速度、闭关收益递减、突破最低闭关修为占比、突破失败保留比例和真气产出。数值修为迁移后新增或维护 `experience` 段，用于非闭关、非原地待命事件的历练修为收益。

`experience` 常用字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 历练修为开关 |
| `valueScale` | number | 价值倍率的缩放基准 |
| `riskWeight` | number | 风险分对历练修为的权重 |
| `maxValueMultiplier` | number | 价值倍率上限 |
| `maxRiskMultiplier` | number | 风险倍率上限 |
| `maxDurationMultiplier` | number | 持续时间倍率上限 |
| `baseBySource` | object | 不同来源的基础历练修为，如 `monster_hunt_success`、`dynamic_event`、`explore` |
| `outcomeMultiplier` | object | `success` / `partial` / `failure` 等结果倍率 |

追加历练修为的来源包括任务推进、任务完成、真实斩妖成功或失败、游历、动态事件、机会点、PvP、外出社交。闭关修炼、原地等待、纯状态刷新和已死亡 NPC 的失败结果不追加。

### monster-spawn.json

`combat.damageMultiplier` 是统一战斗服务中 `scene="monster_ambush"` 的地图妖兽主动袭击单击倍率。该倍率只影响妖兽主动攻击 NPC，不影响 NPC 反击妖兽、斩妖任务、PvP 或普通任务风险场景。

## 验证要求

- 数据结构改动：运行对应加载/单元脚本。
- 机制或行为改动：运行对应 `tools/test-*.mjs`，并用真实、多种子、长程模拟观察行为。
- 平衡改动：记录模拟天数、种子、关键统计、异常现象和结论。
- 不用摘要值代替行为正确性判断。
