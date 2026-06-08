# 游戏数据配置规则

> 最后更新：2026-06-08

本文档定义 `apps/game/data/` 的现行目录结构、命名规范和扩展规则。来源以当前 `apps/game/js/core/config-loader.js`、`apps/game/js/core/game-data-validator.js` 与 `apps/game/data/` 为准。门派组织、门派 seed profile 与门派运行数值三份配置已落地；通用任务板和门派月俸/库存压力运行服务仍属后续目标。

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
│   ├── sect-operation.json
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
│   ├── data-manifest.json
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
│   ├── sect-organization.json
│   ├── sect-seed-profiles.json
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
│   ├── projections/
│   │   └── legacy-edge-projections.json
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
| 新数据文件 | 同步更新 `config/data-manifest.json`、本文档和对应 strict 校验 |

### 展示元数据 `presentation`

运行时规则字段和 UI 展示字段分离。凡是会被地图图例、缩略图、地图格子渲染或列表 badge 使用的颜色、图标、徽记、排序，都应放在对应数据对象的 `presentation` 字段中。

| 字段 | 类型 | 适用数据 | 说明 |
|------|------|----------|------|
| `presentation.color` | string | 地形、势力/组织 | UI 展示颜色，使用 `#RRGGBB` |
| `presentation.icon` | string | 地形 | 地形图例图标键，如 `plain`、`mountain`、`spirit_vein` |
| `presentation.badge` | string | 势力/组织 | 图例和面板可用的短徽记 |
| `presentation.order` | number | 地形、势力/组织 | 图例展示顺序 |

代码不得为新增地形、势力或组织写固定 ID、固定颜色表或固定图例列表。新增或调整 UI 展示时，优先补充数据对象的 `presentation`，再由渲染层读取。

## 加载约定

`config/data-manifest.json` 是运行时 JSON 加载清单。新增、删除或移动 `apps/game/data/` 下的运行时 JSON 时，必须同步更新 manifest；代码不得再在 `config-loader.js` 中维护目录文件列表。`test-data-manifest-load.mjs` 负责校验目录文件与 manifest 登记项一致。

当前有以下合并或显式加载约定：

- `items/*.json`：按 category 拆分，加载后合并为 `itemDefs.items`。
- `effects/*.json`：战斗 GE 与通用 GE 合并为 `effects.effects`。
- `jobs/*.json`：按业务域拆分，加载后合并为 `jobs.jobs` 并交给 `JobPool`。
- `toils/*.json`：按执行器域拆分，加载后合并为 `toils.toils` 并交给 `ToilPool`。
- `definitions/combat-base-table.json`：由加载器显式读取为 `combatBaseTable`，提供境界参考基表和小层倍率。
- `definitions/cultivator-combat.json`：由加载器显式读取为 `cultivatorCombat`，提供普通修士裸面板。
- `definitions/monster-combat.json`：由加载器显式读取为 `monsterCombat`，提供普通妖兽危险层级参考表。
- `definitions/monster-attribute-templates.json`：由加载器显式读取为 `monsterAttributeTemplates`，供妖兽属性计算器和运行时生成入口使用。
- `definitions/sect-organization.json`：由 manifest 输出为 `sectOrganization`，提供门派组织模板、堂口、管理层、身份边界和堂口资格。
- `definitions/sect-seed-profiles.json`：由 manifest 输出为 `sectSeedProfiles`，提供门派初始化宏观资源档、实物库存档、堂口编制档和 NPC 初始道具档。
- `balance/sect-operation.json`：由 manifest 输出为 `balanceSectOperation`，提供月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费。
- `economy/transaction-scenarios.json`：由加载器显式读取为 `economicTransactionConfig`，供统一经济交易底座读取场景、托管、债务与抽象拍卖规则。
- `relationships/**/*.json`：三层关系全数据平台配置，由加载器显式读取并组装为 `relationshipPlatform`，交给 `RelationshipSystem` 门面。

### config/data-manifest.json

`data-manifest.json` 是运行时数据加载的单一清单来源，包含 `singletons`、`groups` 和 `validation` 三类信息。

| 字段 | 说明 |
|------|------|
| `singletons` | 单文件配置映射，key 对应 `GameConfigs` 输出字段或嵌套字段 |
| `groups` | 目录组合并规则，如 `items/`、`effects/`、`abilities/`、`jobs/`、`toils/`、`behavior-trees/` |
| `groups.*.directory` | 相对 `apps/game/` 的目录路径 |
| `groups.*.files` | 该目录下必须加载的 JSON 文件名列表 |
| `groups.*.output` | 合并模式和输出属性，如 `mergeArrayProperty` / `documentArray` |
| `validation` | strict 校验需要的前缀、引用字段和必填字段 |

新增目录级配置时优先扩展 manifest group；只有无法用现有 group 输出模式表达时，才扩展 manifest loader 的通用能力。

门派运行配置必须通过 manifest 输出：

| 输出字段 | 文件 | 说明 |
|----------|------|------|
| `sectOrganization` | `definitions/sect-organization.json` | 门派组织模板、堂口、管理层、身份边界和堂口资格 |
| `sectSeedProfiles` | `definitions/sect-seed-profiles.json` | 门派初始化 profile：宏观资源档、实物库存档、堂口编制档和 NPC 初始道具档 |
| `balanceSectOperation` | `balance/sect-operation.json` | 门派运行数值：月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费 |

门派运行相关文件和代码边界：

| 路径 | 说明 |
|------|------|
| `definitions/sect-organization.json` | 已落地。门派组织模板、堂口、管理层、身份边界和堂口资格 |
| `definitions/sect-seed-profiles.json` | 已落地。门派初始化 profile：宏观资源档、实物库存档、堂口编制档、NPC 初始道具档 |
| `balance/sect-operation.json` | 已落地。门派运行数值：月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费 |
| `engine/sect/sect-config-registry.js` | 已落地。只负责门派配置聚合、helper 与引用校验，不执行月俸或任务板业务 |
| `engine/quest/` | 后续目标。通用任务板、任务来源策略和任务交付处理器 |
| `engine/sect/` 运行服务 | 后续目标。宗门财政、悬赏托管、月俸库存压力和离宗倒闭规则 |

### 启动期 strict 校验

`validateGameData(configs, { strict: true })` 是运行时配置引用的启动守门人。缺失 GE/GA/Tag/Item 引用、错误 ID 前缀、未登记行为树、缺失资源注册项、manifest 遗漏和展示元数据缺失都应在加载期暴露，不允许静默跳过、回退直写 state 或继续运行到半配置状态。

`game-data-validator.js` 是门派配置 strict 校验的主入口，并复用 `SectConfigRegistry` 的引用校验。当前阶段只对显式声明 `isSect` / `isPublic` / 门派 profile 字段，或带 `subtype` 的功能组织做身份校验；核心宗门的完整 `isSect=true` 标注将在后续任务补齐后再收紧为全量必填。门派运行 strict 校验覆盖：

| 校验项 | 规则 |
|--------|------|
| `isSect` / `isPublic` | 本阶段对显式声明门派字段或 `subtype` 功能组织强校验；功能组织需 `isPublic=true` 或 `isSect=false`，公共组织可到后续任务补全 `isSect=false` |
| `sectTemplateId` | `isSect=true` 的势力必须引用存在的 `sectOrganization` 模板 |
| seed profile | `sectSeedProfileId` / `seedProfileId` 必须引用存在的 `resourceProfiles` / `inventoryProfiles` / `seedProfiles` profile |
| hall profile | `hallAssignmentProfileId` / `hallProfileId` 必须引用存在的堂口编制 profile |
| starter kit | `hallMembership` 引用的 NPC 初始道具 profile 必须存在，且 kit 内 item 必须存在 |
| `hallId` | 堂口编制、成员分配和任务来源引用的堂口必须存在于组织模板 |
| `role` | 管理层、成员、starter kit 和堂口资格引用的职位必须存在于组织模板或项目职位字典 |
| `rank` | `rankPills` 等运行规则引用的境界必须存在于 `definitions/ranks.json` |
| `itemId` | `inventoryProfiles` 与 `npcStarterKits` 只允许引用 `itemDefs.items` 中存在的实物物品 |
| `questTemplateId` | 宗门任务、堂口任务和个人悬赏引用的模板必须存在于 `quests/quest-templates.json` |
| transaction scenario | 悬赏托管、库存回流、月俸或维护费引用的场景必须存在于 `economy/transaction-scenarios.json` |
| faction state resource | `resourceProfiles` 和运行规则中的宏观资源必须能被 `ResourceRegistry` 解释 |
| `questSelection` tag | `monsterHuntTags` 必须能匹配任务模板 `category` 或 `tags`；当前任务模板尚未补 tags，因此使用 `category` 匹配 |
| `stockPressure` | 安全库存线、回流比例、扣减值、离宗阈值和倒闭阈值必须为有效数值范围 |

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
| `presentation` | object | UI 展示元数据，包含 `color`、`badge`、`order` |
| `isSect` | boolean? | 是否为门派；后续任务会给核心宗门补齐 `true` |
| `isPublic` | boolean? | 是否为公共组织；当前 6 个功能组织已声明 `true` |
| `sectTemplateId` | string? | `isSect=true` 时引用 `sectOrganization.templates` |
| `sectSeedProfileId` | string? | `isSect=true` 时引用 `sectSeedProfiles` 中的 seed profile |
| `hallAssignmentProfileId` | string? | `isSect=true` 时引用 `hallAssignmentProfiles` |
| `inventoryOverrides` | object? | 覆盖 seed profile 的宗门实物库存，key 必须存在于 `itemDefs.items` |

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
| `items` | object/array? | NPC 初始实物物品，所有 itemId 必须存在于 `itemDefs.items` |

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
| `macro-resources.json` | 势力宏观资源与货币资源注册源，供 `ResourceRegistry`、经济资产适配和势力状态读写使用 |
| `terrains.json` | 地形定义 |
| `techniques.json` | NPC 当前修炼功法定义，供 `techniqueRegistry`、修炼加成和战斗属性修正读取；不同于 `items/technique.json` 的秘籍物品 |
| `combat-base-table.json` | 境界战斗参考基表，含 `stageMultipliers` 和六项属性参考值 |
| `cultivator-combat.json` | 普通修士裸面板，供修士战斗属性新路径初始化 |
| `monster-combat.json` | 普通妖兽危险层级参考表，不替代妖兽模板运行时 |
| `sect-organization.json` | 门派组织模板、堂口、管理层、身份边界和堂口资格 |
| `sect-seed-profiles.json` | 门派初始化 profile：宏观资源档、实物库存档、堂口编制档、NPC 初始道具档 |
| `weapons.json` | 武器/法宝参考定义 |
| `monster-attribute-templates.json` | 妖兽阶位基准、体型、移动、战斗风格、属性、特殊类型和习性模板 |
| `monsters.json` | 妖兽定义，当前 36 条；通过五层模板生成直接面板属性 |
| `names.json` | 出生 NPC 姓名池 |

### terrains.json

地形定义同时承载运行时规则和展示元数据。`moveCost`、`passable`、`resourceMultiplier`、`spiritBonus`、`produceResource` 等字段影响地图规则；`presentation` 仅影响 UI 展示。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` / `type` / `name` | string | 地形唯一键、地图 tile 引用键和中文名 |
| `moveCost` | number | 移动消耗；不可通行地形可为负值或由 `passable=false` 表示 |
| `passable` | boolean | 是否可通行 |
| `resourceMultiplier` | number | 资源产出倍率 |
| `defenseBonus` | number? | 防御加成 |
| `spiritBonus` | number? | 灵气或矿脉加成 |
| `produceResource` / `produceAmount` | string / number? | 地形产出资源 |
| `presentation.color` | string | 地图、缩略图和图例展示颜色 |
| `presentation.icon` | string | 图例图标键 |
| `presentation.order` | number | 图例排序 |

`ranks.json` 中 `rankId` 只表示修仙境界，不承载职位、头衔或凡人王朝身份。修仙境界需要同时维护 `qiRequired` 与 `cultivationRequired`。前者是真气突破门槛，后者是数值修为突破门槛；运行时不再使用旧比例进度字段作为突破依据。

`combat-base-table.json`、`cultivator-combat.json`、`monster-combat.json` 统一使用六项战斗属性：`hp`、`yuan`、`attack`、`defense`、`speed`、`soul`。三张表的 `ranks` key 必须与 `ranks.json` 的 12 个运行时境界完全一致，不得包含额外未来高阶层级。

`definitions/techniques.json` 中代表性功法可在 `effects.combatModifiers` 声明 AttributeSet 修正。字段格式为 `{ "attribute": "attack", "op": "multiply", "magnitude": 1.12 }`，由运行时按 `technique_combat` 来源分组刷新。`items/technique.json` 是可交易、可抢夺的功法秘籍物品清单，加载后合并到 `itemDefs.items`，不承载 NPC 当前修炼功法的战斗面板修正。

`monsters.json` 中新妖兽必须声明 `templates` 与 typed `skills[]`。运行时通过 `monsterAttributeTemplates` 和 `resolveMonsterAttributes()` 得到 `hp`、`qi`、`attack`、`defense`、`speed`、`spirit` 直接面板，并保留 `vitality`、`strength`、`sense` 兼容镜像。

### sect-organization.json

门派组织模板只描述组织结构和资格边界，不写运行数值。当前 `templates.default_sect` 通过 `hallIds` 引用 6 个堂口；堂口列表本身统一放在顶层 `halls`，便于多个模板复用。

| 字段 | 说明 |
|------|------|
| `roleSource` | 身份阶梯来源，当前指向 `balance/cultivation.json -> promotion` |
| `identityRoles` | 组织身份字典，补充 `leader` 等不在晋升 ladder 内但运行规则会引用的身份 |
| `templates.default_sect` | 标准宗门模板，引用顶层堂口 ID |
| `managementRoles` | 管理层身份，必须能在晋升字典或 `identityRoles` 中找到 |
| `hallMembership` | 堂口成员和堂主的境界门槛、fallback 与 starter kit 引用 |
| `halls[]` | 堂口定义，当前包括 `deacon_hall`、`law_hall`、`alchemy_hall`、`artifact_hall`、`library_hall`、`misc_hall` |
| `halls[].questTemplateIds` | 堂口可发布任务模板，必须存在于 `quests/quest-templates.json` |

### sect-seed-profiles.json

门派初始化 profile 只声明初始数据组合，不执行结算逻辑。

| 字段 | 说明 |
|------|------|
| `scaleToProfile` | 规模到 seed profile 的映射，值必须引用已存在 profile |
| `resourceProfiles` | 只定义宏观资源 profile，key 必须能被 `ResourceRegistry` 解释为 faction state resource |
| `inventoryProfiles` | 只定义宗门实物库存，所有 key 必须经 `itemDefs.items` 校验 |
| `hallAssignmentProfiles` | 堂口编制档，引用组织模板中的 `hallId` 与身份字典中的 `role` |
| `npcStarterKits` | NPC 初始道具档，只定义实物物品，所有 `itemId` 必须经 `itemDefs.items` 校验 |

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

`engine/quest/` 是后续目标：通用任务板、任务来源策略和任务交付处理器，不属于门派专用模块。宗门任务、个人悬赏、悬赏阁任务、坊市委托和动态事件任务都应复用同一任务仓储、状态机、可见性策略和去重策略。

`engine/sect/` 当前只落地 `sect-config-registry.js` 配置注册表；宗门任务来源、门派运行规则和悬赏结算策略仍是后续目标。任务板服务不得反向依赖门派域。

QuestBoard canonical 状态集合以 `docs/data-models/sect-operation.md` 为准：`draft`、`available`、`accepted`、`in_progress`、`completed`、`turned_in`、`failed`、`expired`。下方 `activeQuestInstance` / 斩妖任务状态属于 NPC 任务实例兼容状态，不是 QuestBoard canonical 状态。

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

## ResourceRegistry

`ResourceRegistry` 以 `definitions/macro-resources.json` 和 `items/currency.json` 为配置来源，统一解释势力宏观资源、货币资源和组织点数。代码不得在 `FactionState`、`FactionEntity`、`AssetAdapter` 或经济结算逻辑里维护固定资源白名单。

| 数据来源 | 用途 |
|----------|------|
| `definitions/macro-resources.json` | 势力 state 资源，如粮食、弟子、战略物资等 |
| `items/currency.json` | 可持有、可交易、可作为计价单位的货币类物品 |
| `economy/transaction-scenarios.json` | 场景如何使用资源、托管、债务、拍卖和正式/私人交易规则 |

新增资源时，必须补齐资源定义、manifest 登记、strict 校验和 `test-resource-registry.mjs` 观察结果；不能只在业务代码中加入字符串判断。

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
| `projections/legacy-edge-projections.json` | 旧 ADR-027 边 API 与三层关系 mark/tag 的兼容投影配置 |

新增关系规则时：

1. 新 mark/tag/event/signal key 先登记到对应 dictionary。
2. 事件来源只声明 hook 或发布标准 `RelationEvent`，不得在战斗、NPC、势力领域代码直接改账本。
3. 新业务影响写入 `impact-rules/`；AI 决策影响写入 `signal-rules/`。
4. 如果需要新增 selector、condition 或 effect 能力，先确认现有解释器不能表达，再新增 operator，并补 `test-relationship-platform.mjs`。
5. 修改本目录后至少运行 `test-relationship-platform.mjs`、`test-relationship-wanted-chain.mjs` 和相关 AI 回归。

### projections/legacy-edge-projections.json

旧边投影只服务迁移期兼容调用点，例如 `edgesOfType(fromId, 'master')`、`edgesOfType(fromId, 'same_sect')` 和旧仇恨/恩情边查询。新增投影时必须同时声明：

| 字段 | 说明 |
|------|------|
| `edgeToLedger[]` | 旧边类型如何映射到三层账本的 mark/tag |
| `ledgerToEdges[]` | 三层账本 mark/tag 如何投影回旧边类型 |
| `ledgerKind` | `mark` 或 `tag` |
| `type` | 已登记的 RelationMark 或 RelationTag ID |
| `edgeTypes` | 兼容旧调用点返回的边类型列表 |

本文件补齐后，后续 Runtime worker 应把 `RelationshipSystem` 中代码内的 `MARK_BY_EDGE_TYPE`、`TAG_BY_EDGE_TYPE`、`EDGE_TYPES_BY_*` 映射收敛到此配置，并同步确认 manifest 或等价加载路径；在接入完成前，本文件是计划资产和文档约束，不代表核心实现已经读取。

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
| `sect-operation.json` | 门派运行数值：月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费 |
| 其他 | 社交、移动、记忆、执念、情绪、人格、怀璧其罪等 |

### sect-operation.json

`sect-operation.json` 只放门派运行数值、任务板策略和交易场景引用，不放执行逻辑。当前已由 manifest 输出为 `balanceSectOperation`，并聚合到 `WorldEngine._balanceConfig.sectOperation`；月俸、任务板、库存压力、离宗和倒闭执行服务仍是后续目标。

| 字段 | 说明 |
|------|------|
| `monthlyIntervalDays` | 门派月度运行周期 |
| `operationFlow` | 后续运行服务按配置顺序解释的流程名列表 |
| `treasury` | 门派资金和交易场景引用；当前必须引用 `transaction-scenarios.json.scenarios` 中已有场景 |
| `stipends` | 职位灵石俸禄、境界丹药俸禄、堂口额外俸禄 |
| `maintenance` | 维护费、堂口消耗或抽象运营成本 |
| `stockPressure` | 安全库存线、库存压力、回流比例、离宗阈值和倒闭阈值 |
| `personalBounty` | 个人悬赏手续费、托管场景和交付策略 |
| `questBoard` | 任务板可见性、状态机、去重和来源策略 |
| `questSelection` | 任务来源选择、堂口提示和怪物任务匹配标签 |

个人悬赏奖励使用统一经济托管，不进入宗门普通库存，不叠加普通任务模板奖励。

## 编辑器数据集与适配器配置

运行时数据单一真相源仍是 `apps/game/data/`；`apps/editor/data/` 只保存编辑器 schema、模板、UI 分类和适配器，不保存运行时镜像。

| 路径 | 说明 |
|------|------|
| `apps/editor/data/schemas/datasets.json` | 编辑器数据集注册表，数据源必须指向 `apps/game/data/**/*.json` |
| `apps/editor/data/schemas/references.json` | 数据集之间的引用源和选项源 |
| `apps/editor/data/schemas/fields.json` | 字段控件类型、标签、必填和轻量展示规则 |
| `apps/editor/data/templates/records/*.json` | 新增记录模板 |
| `apps/editor/data/ui/dataset-categories.json` | 编辑器数据集分类、排序和展示标签 |
| `apps/editor/data/adapters/map-editor.json` | 地图编辑器 tile 字段、地形/归属选项、画笔和校验适配 |

地图编辑器新增或重命名 tile 字段时，优先更新 `map-editor.json`；只有适配配置无法表达的新交互能力，才修改 `apps/editor/js/editor/map-editor/` 实现。

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
- 新增运行时 JSON：运行 `node apps/game/tools/test-data-manifest-load.mjs`。
- 新增或修改配置引用：运行 `node apps/game/tools/test-game-data-validation.mjs`。
- 新增或修改门派配置：运行 `node apps/game/tools/test-game-data-validation.mjs`，由 `game-data-validator.js` strict 校验拦截门派配置错误；若后续新增 `test-sect-config-load.mjs`，该脚本只能调用 manifest loader + validator，不得维护第二套规则。
- 新增资源或货币：运行 `node apps/game/tools/test-resource-registry.mjs`。
- 新增编辑器数据集、字段 schema 或 adapter：运行 `node apps/editor/tools/test-editor-dataset-registry.mjs`，地图编辑器相关改动再运行地图编辑器测试。
- 机制或行为改动：运行对应 `tools/test-*.mjs`，并用真实、多种子、长程模拟观察行为。
- 平衡改动：记录模拟天数、种子、关键统计、异常现象和结论。
- 不用摘要值代替行为正确性判断。
