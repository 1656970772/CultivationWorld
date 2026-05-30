# 游戏数据配置规则

> 最后更新：2026-05-30（信息传播与机会点 + 实物与怀璧其罪，ADR-024/025）：新增 `data/world/news.json`（新闻类型传播参数 + 五渠道开关：半径/口耳/城镇/宗门/商会）、`data/world/opportunities.json`（机会点类型 value/存活/上限/掉落源/风险键 + 决策阈值）、`data/balance/covet.json`（怀璧暴露阈值 + 觊觎起念 + 放他一马权重 + 抢夺结算）、`data/items/items.json`（可转移法宝/材料/丹药，含 value/grade/transferable/combatBonus）；`reward.json` 新增 `opportunity_*` 掉落表（outcome 带 itemId/qty 发放真实物品）；`npc-actions.json` 新增 `act_npc_goto_opportunity`（targetResolver `nearest_opportunity`）；`npc-state` 新增 `arrivedAtOpportunity`/`targetOpportunityId`/`equippedArtifactId`；`constants.js` 新增 `NewsType`/`OpportunityType` 枚举；`goal.js` 新增 `GoalSource.OPPORTUNITY`。代码侧：新增 `engine/world/info-propagation.js`、`engine/world/opportunity.js`、`engine/npc/info-actions.js`；`ItemDefinition` 领域字段并入 properties；`_npcCombatPower` 接通法宝 `combatBonus`。所有系统默认 `enabled=false` 零漂移（`test-goal-equivalence` 主路径通过，新增 `tools/test-info-propagation.mjs` 验证）。详见 ADR-024、ADR-025、systems/opportunity-system.md、systems/item-covet.md、wiki/rules/wealth-exposed.md。）
> 历史更新：2026-05-30（价值-风险决策系统 + 修炼曲线改造：`ai-config.json → npc.decision` 新增决策系数块（`lambdaRisk`/`lambdaValue`/`headstrongChance`/`headstrongValueBonus`/`costFloor`/`exploreFirstCostFactor`）；`npc-actions.json` 每个行为新增 `valueScore`（基础价值）与 `riskKey`（映射 `risk.json`，游历=`explore`，其余 `null`）；`resources.json` 每个道具新增 `value` 字段（预留，本期不参与决策）；`cultivation.json` 新增 `cultivationDecayK`（闭关边际递减系数，默认 2.5）与 `minCultivationRatio`（突破最低闭关占比，默认 0.3，亦为 insight 封顶 `1-该值`）；`personality.json` 新增 `justice`(正义感) 维度 + `needBoosts.justice` 占位（仅字段+赋值+遗传，不接逻辑）；`social.json → birth` 新增 `personalityMutationRange`（courage/justice 走双亲均值+变异遗传）；`npc-state` 新增 `lastDecisionHeadstrong`/`headstrongActionId`/`breakthroughPathOrder` 状态字段。代码侧：`action.js` 加 `valueScore`/`riskKey`/`getBaseCost`，`goap-planner.plan()` 支持可选 `costFn`（慢/快路径均当次固定），`behavior-system.plan()` 透传 costFn，`npc-actions.js` 新增 `estimateRiskCost`/`computeActionValue`/`computeDecisionCost` 与修炼指数衰减/insight 封顶，`npc-entity` 进规划前 roll 上头并构建固定 cost 表、规划后标记上头、突破后 roll 顺序随机。详见 ADR-017、wiki/rules/travel-and-risk.md、wiki/rules/personality.md。）
> 历史更新：2026-05-30（游历感悟与风险系统：突破进度双源化 `totalProgress = cultivationProgress(闭关) + insight(游历)`，闭关有境界上限 `cultivation.json → cultivationCap`，撞顶后由 GOAP 自然推导出"外出游历攒 insight"（闭关行为前置 `cultivationProgress<cap` 由 `npc-entity._applyCultivationCapPreconditions` 按境界动态注入）；`act_npc_explore` 改为产出 insight，归来按 `cultivation.json → actions.explore.fortuneEvents` 机缘事件表 roll、按新增 `data/balance/risk.json` 结算风险分项（受伤/资源掉落/职位挑战失败/陨落，权重 + 境界减免 + 性格加成）；`personality.json` 新增 `courage`(勇敢) 维度（勇敢↑→游历受伤/陨落↑，经 risk.json `personalityModifiers`）；`npc-needs` 修炼/突破需求 goalState 改用 totalProgress；`npc-state` 新增 `insight`、`totalProgress`（set 时自动同步）；补全 `tick-manager._randomWanderTarget` 实现 wander_far。详见 ADR-016、wiki/rules/travel-and-risk.md。）
> 历史更新：2026-05-30（性格系统：新增 `data/balance/personality.json`（性格维度定义 + needBoosts 性格→需求加成表，数据驱动可扩展）；新增需求 `need_npc_ambition`（晋升，野心驱动、修为饱和后压过修炼，触发 `act_npc_challenge`）；`ConfigurableEvaluator` 支持读 `entityState.personality` 施加加成；性格不进 GOAP 状态键。详见 wiki/rules/personality.md。）
> 历史更新：2026-05-30（顶层稀缺席位与挑战上位制：`factions.json` 新增 `roleQuota`（各宗门按规模配置 elder/heir 名额）；晋入 elder/heir 时"有空缺直接补位、满员则挑战现任、挑战成功现任降一级"，三条通道（贡献晋升/大比冠军/挑战上位）统一走 `TickManager._promoteRole` 的稀缺席位逻辑；新增 worldContext `promoteByLadder` 供 `NPCChallengeExecutor` 调用；大比新增 `exemptRoles`（治理层不参赛）与 `byRank`（按境界分组比试）。详见 ADR-015。）
> 历史更新：2026-05-30（宗门运行与成员晋升制度优化：修复 `faction-actions` 资源双轨 bug——势力资源（`low_spirit_stone/disciples/food`）统一以 `state` 为单一真相源，增减声明在 `effects`，`costs/yields` 不再用于这三种资源，`attackEnemy/trade` 改走 state；新增 `cultivation.json → promotion` 段（全职位阶梯 `outer→disciple→core→officer/general→elder→heir` + 贡献晋升通道 + 高阶名额限制），`tick-manager.js` 新增 `_processPromotions`、`_promoteRole` 改为全阶梯数据驱动，`NPCChallengeExecutor` 挑战上位改为沿阶梯实际晋升；继任逻辑 `_triggerSuccession` 改用 `ranks.json.successionScore` + `personality.loyalty` + `id` 排序（与 wiki/rules/leader-succession.md 一致）；`social.json → roles.rankMap` 补 `outer_disciple/wanderer`；新增 wiki/rules/sect-operation.md。详见 ADR-015。）
> 历史更新：2026-05-29（灵根与体质系统：`cultivation.json` 新增 `spiritRoot`（5 档资质：天/双/三/四/伪灵根，乘修炼速度+加突破率）与 `physique`（凡体为主+稀有特殊体质，灵根之上额外叠加 speed/突破/寿元，specialEffects 占位待定）；NPC 新增 `spiritRootId`/`physiqueId` 状态字段，由 `NPCEntity._initTalent` 按 weight 权重随机赋值（npcConfig 可显式指定）；修炼速度与突破成功率分别接入连乘/累加，体质寿元在突破刷新寿命时叠加。详见 ADR-012、wiki/rules/spirit-root.md、wiki/rules/physique.md。）
> 历史更新：2026-05-29（修炼激励系统重构：NPC 需求精简为 **修炼/长寿/回血/职责** 四个真实动机，删除 `need_npc_quest/ambition/breakthrough`；`act_npc_turn_in_quest.effects` 增加 `contribution +5`，打通"做任务攒贡献→进修炼场"GOAP 经济链；新增 `act_npc_heal` 疗伤行为与 `injuryLevel` 状态；`cultivation.json` 的 `cultivationSpeed` 下调约 12 倍（普通闭关≈寿元 120%、修炼场 +100% 加速后≈60%），`trainChamber.speedBonusMultiplier` 25%→100%（2.0）；新增 `cultivation.json → monthlyContribution`（月度贡献考核：按境界额度、前三名月俸 ×5/×3/×2、未达贬外门）与 `sectEvents`（门派考核 sect_exam 查境界贬外门、门派大比 grandCompetition 实力前五奖励冠军晋升）；`npc-state.js` 新增 `outer_disciple` 职位与 `monthlyContribution/monthlyQuotaMet`；`tick-manager.js` 新增 `_processMonthlyContribution/_processSectEvents` 调度器与 `sectEventLog`。详见 ADR-011。）
> 历史更新：2026-05-29（散修悬赏与位置事件日志：散修复用任务模板与"接→做→交"三连，接/交地点改为最近悬赏阁/坊市（`quest_hall` resolver 与 `_nearestBountyOrg` 分流）、放宽悬赏动作前置为 `canTakeQuest`、`need_npc_quest` 给散修加 boost、`NPCTurnInQuestExecutor` 区分散修奖励（无宗门分成/无贡献点、灵石按 `cultivation.json → bounty.wandererRewardMultiplier` 加成）、`FactionStaticData` 新增 `subtype`；位置事件日志统一 schema：`TickManager._emitLocationEvent/_resolveLocationName/_enrichInfoEvents/_emitNpcActionEvent` 给悬赏/任务/道侣/生育/攻击/结盟/妖兽袭击/死亡等事件补 `x/y/locationName`，模拟器日志后缀 `@(x,y) 地点`。详见 ADR-009。）  
> 历史更新：2026-05-29（建筑功能化：势力建筑由 `TerritoryLayoutGenerator` 记录坐标（`stats.buildingsByFaction`），引擎/TickManager 提供 `getFactionBuilding` 查询；新增 `main_hall/quest_hall/library/alchemy/training` 建筑级目标解析器，行为按功能分散到对应建筑（接/交任务→任务殿、履职/挑战→主殿、求续命丹→炼丹房、辅助势力→原地就近）减少无谓往返；主殿升级为行政中枢，掌门在主殿坐镇履职触发 `serveFaction.mainHall*` 加成（资源+稳定度）。时间尺度修正：修炼进度改为按 duration 天数累计、重调 cultivationSpeed 使修满境界耗时与寿命匹配（炼气~8年起）、拉长各行为 duration 与任务 durationDays、任务风险按整段摊到每天；NPC 行为优化 A 档：调整 npc-needs 权重提升任务吸引力、`act_npc_explore` 改用 `wander_far` 目标解析避免送人头、新增 ai-config `npc.decisionIntervalMin/Max` 决策周期错开机制；妖兽寿元/自然死亡改为与 NPC 一致的"到寿曲线"，按阶位决定寿元上限且整体长于同等修为人类，新增 monster-spawn.json `lifespan` 段、移除 `population.naturalDeathChancePerTick`；新增 balance/movement.json 实体移动速度配置；NPC 实体新增空间坐标 spatial 字段；新增 techniques.json 功法体系；monsters.json 妖族异兽定义；weapons.json 法宝武器定义；balance/ 和 config/ 目录；统一 modifiers.json 为世界修正器唯一来源）

> 历史更新：2026-05-30（Consideration 乘法 Utility + 复仇 PvP 行为链，ADR-020）：新增 `data/balance/utility.json`（按目标 sourceId 挂 Consideration 响应曲线，`enabled` 总开关默认 false 零漂移）；`obsession.json` 新增 `goalMult`（执念对自身/同方向需求 Goal 的乘法加成，`enabled` 默认 false）、`humiliated→revenge` 后天规则，复仇执念 `goalState` 改为 `{ enemyKilled: true }`；`npc-actions.json` 新增 `act_npc_hunt_enemy`/`act_npc_kill_enemy`（追踪→击杀对人行为链）；`risk.json` 新增 `pvp` 分项（仅供 Utility/GOAP 折算期望损失，胜负由执行器结算）。代码侧：新增 `abstract/consideration.js`、`npc/npc-utility.js`（timeValue/estimateGoalRisk/decorateGoalConsiderations）、`NPCHuntEnemyExecutor`/`NPCKillEnemyExecutor`/`killNPCByPvP`/`npcCombatPower`/`revenge_target` resolver；`Goal.score` 改乘法式；`npc-state` 新增 `hasRevengeTarget`/`nearRevengeTarget`/`enemyKilled` 派生键。详见 ADR-020、systems/behavior-tree.md。）
> 历史更新：2026-05-30（GOBT 三层 AI + 长期心智：新增 `data/balance/memory.json`（记忆事件→强度/衰减/恩怨增量）、`obsession.json`（执念先天 roll + 后天记忆触发 + goalState）、`emotion.json`（情绪维度/事件激发/目标调制）；新增 `data/behavior-trees/` 目录（npc-default.json / faction-default.json，BT 树数据驱动）。代码侧：新增 `abstract/goal.js`、`abstract/bt/*`（BT 骨架 + PlannerNode）、`abstract/memory-system.js`、`abstract/obsession-system.js`、`abstract/emotion-system.js`、`npc/relationship.js`；`BaseEntity.tick` 改 BT 驱动；`NeedSystem.getTopGoals`、`BehaviorSystem.plan` 吃 Goal + 情绪调制 + 执行期实时重选。详见 ADR-018、ADR-019、systems/behavior-tree.md。）

本文档定义 `apps/game/data/` 目录下所有 JSON 配置文件的结构规范、命名约定和扩展规则。新增数据文件时必须同步更新本文档。

## 目录结构总览

```text
apps/game/data/
├── definitions/              # 静态定义层 — 全局类型、枚举与属性模板
│   ├── ranks.json            # 境界/职位/寿元定义
│   ├── resources.json        # 资源（物品）类型定义
│   ├── terrains.json         # 地形类型定义
│   ├── techniques.json       # 功法定义（下乘/中乘/上乘/仙家，按流派分类，25条）
│   ├── weapons.json          # 法宝武器定义（法器/法宝/古宝/灵宝/通天灵宝，按流派分类）
│   ├── monsters.json         # 妖族异兽定义（一~九阶，按族群/类别分类）
│   └── names.json            # NPC 姓名库（姓氏、男名、女名）
├── world/                    # 世界层 — 地图布局与全局状态配置
│   ├── map.json              # 100×100 世界地图数据
│   ├── modifiers.json        # 世界修正器（天灾、灵气变化等）— 唯一来源
│   ├── news.json             # 信息传播（ADR-024）：新闻类型传播参数 + 五渠道开关（半径/口耳/城镇/宗门/商会），enabled 默认 false
│   └── opportunities.json    # 机会点（ADR-024）：各类型 value/存活/参与上限/掉落源/风险键 + 决策阈值，enabled 默认 false
├── entities/                 # 实体层 — 初始实体实例
│   ├── factions.json         # 势力初始数据（12个宗门/势力）
│   └── npcs.json             # NPC 初始数据（掌门/长老/弟子）
├── needs/                    # 需求层 — AI 需求池配置
│   ├── faction-needs.json    # 势力需求定义与评估规则
│   └── npc-needs.json        # NPC 需求定义与评估规则
├── quests/                   # 任务层 — 宗门任务系统配置
│   └── quest-templates.json  # 任务模板（难度等级、类型、奖励、危险度）
├── actions/                  # 行为层 — AI 行为池与世界规则
│   ├── faction-actions.json  # 势力 GOAP 行为
│   ├── npc-actions.json      # NPC GOAP 行为
│   └── world-rules.json      # 世界规则（Tick 级自动执行）
├── balance/                  # 平衡层 — 游戏数值平衡参数（可调节，不影响逻辑结构）
│   ├── combat.json           # 战斗、外交、贸易数值参数
│   ├── economy.json          # 资源产出、消耗、薪俸、稳定度参数
│   ├── cultivation.json      # 修炼速度、突破概率、行动效果参数
│   ├── social.json           # 道侣匹配、生育、继任系统参数
│   ├── movement.json         # 实体移动速度（NPC 按境界 / 妖兽按阶位，每 tick 格数）
│   ├── personality.json      # 性格系统：维度定义（含 courage）+ 性格→需求加成表（数据驱动可扩展）
│   ├── risk.json             # 风险系统：游历等高风险行为的风险分项（受伤/掉落/挑战失败/陨落）+ 性格加成
│   ├── monster-spawn.json    # 妖兽分布：总量、境界危险梯度、地形/灵脉加权
│   ├── memory.json           # 记忆系统（ADR-019）：事件→强度/衰减/恩怨增量
│   ├── obsession.json        # 执念系统（ADR-019/020）：先天 roll + 后天记忆触发 + goalState + goalMult(执念乘子)
│   ├── emotion.json          # 情绪系统（ADR-019）：维度/事件激发/目标调制规则
│   ├── utility.json          # Utility 考量因素（ADR-020/022）：按目标 sourceId 挂 Consideration（响应曲线乘法式效用，含 expectedValue），enabled 总开关默认 false
│   ├── reward.json           # 期望收益（ADR-022/024）：按目标 sourceId 配置 outcomes(prob×value)，outcome 带 itemId/qty 时发放真实物品（机会点掉落表 opportunity_*），enabled 默认 false
│   └── covet.json            # 怀璧其罪（ADR-025）：身家暴露阈值 + 觊觎起念条件 + 放他一马权重(同门/职位/恩义/道侣/性格) + 抢夺结算，enabled 默认 false
├── items/                    # 物品层（ADR-025）— 可转移实物定义
│   └── items.json            # 法宝/材料/丹药：value(身家估值)/grade/transferable/combatBonus
├── behavior-trees/           # GOBT 行为树（ADR-018）— BT 树 JSON 数据驱动定义
│   ├── npc-default.json      # NPC 默认行为树（反应 Selector + 深思熟虑 Planner）
│   └── faction-default.json  # 势力默认行为树
└── config/                   # 全局配置层 — 游戏系统级配置（一般不频繁修改）
    ├── game-config.json      # 地图尺寸、玩家参数、时间系统、NPC初始化规则
    └── ai-config.json        # GOAP 规划器参数（maxDepth、maxIterations）
```

## 通用命名规范

| 规范 | 说明 |
|------|------|
| **文件名** | 使用 `kebab-case`（如 `faction-needs.json`）|
| **ID 字段** | 使用 `snake_case`（如 `low_spirit_stone`、`qi_refining`）|
| **中文名称** | `name` 字段使用简体中文 |
| **JSON 格式** | 2 空格缩进，UTF-8 无 BOM |
| **顶层结构** | 列表类数据使用 JSON Array `[]`，单对象数据使用 JSON Object `{}` |
| **注释字段** | 使用 `_comment` 或 `_description` 字段（不影响运行时解析）|

---

## 一、definitions/ — 静态定义层

此目录存放**全局共享的类型定义和枚举数据**。这些数据在整个运行时内不会变化，被其他所有模块引用。

### ranks.json — 境界/职位定义

定义修炼境界和凡俗职位的静态属性。NPC 的 `rankId` 引用此表。

**世界观参考来源**：`docs/世界观参考/凡人修仙传_世界观设定.md`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，`snake_case`（如 `nascent_soul`）|
| `name` | string | 是 | 中文名称（如"元婴"）|
| `category` | string | 是 | 分类：`mortal` / `mortal_title` / `cultivation` |
| `order` | number | 是 | 排序值，越高越强 |
| `successionScore` | number | 是 | 继任评分权重 |
| `lifespan` | object | 是 | 寿元配置 |
| `lifespan.bucketId` | string | 是 | 寿元分组 ID |
| `lifespan.bucketName` | string | 是 | 寿元分组中文名 |
| `lifespan.baseYears` | number | 是 | 基础寿元（年）|
| `lifespan.varianceYears` | number | 是 | 寿元浮动范围（正负）|
| `lifespan.source` | string | 否 | 数据来源标注（如"凡人修仙传：100-120岁"）|
| `aliases` | string[] | 是 | 别名列表（至少包含 `name`）|

**扩展规则**：新增境界只需追加数组元素，`order` 值需大于前一境界。寿元数据需参考 `docs/世界观参考/` 中对应小说设定，若无参考需告知用户。

### resources.json — 资源/物品定义

定义所有可被势力和 NPC 持有、消耗、产出的资源类型。

**世界观参考来源**：`docs/世界观参考/凡人修仙传_世界观设定.md`（灵石、丹药、灵材、符箓等）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `low_spirit_stone`）|
| `name` | string | 是 | 中文名称（如"低级灵石"）|
| `category` | string | 是 | 分类：`currency` / `supply` / `population` / `material` / `consumable` / `equipment` |
| `stackable` | boolean | 是 | 是否可堆叠 |
| `exchangeRate` | number | 否 | 兑换比率（currency 类型专用，低级=1，中级=100，高级=10000，极品=1000000）|
| `qiValue` | number | 否 | 折算真气价值（部分丹药/灵石）|
| `value` | number | 否 | 统一相对价值（ADR-017 预留）。供后续「行为预期产出道具」的价值期望计算（`computeActionValue`）使用；**本期仅加字段、不参与决策**。以低级灵石=1 为基准，参考 `exchangeRate`/`qiValue` 标定 |
| `description` | string | 是 | 描述文本 |
| `source` | string | 否 | 世界观参考来源标注 |

**扩展规则**：新增资源类型后，需检查 `actions/` 目录下的行为配置是否需要引用新资源。新增资源需标注 `source` 来源。

### terrains.json — 地形类型定义

定义地图格子可使用的地形类型和属性。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `mountain`）|
| `type` | string | 是 | 地形类型键，与 `id` 一致 |
| `name` | string | 是 | 中文名称 |
| `moveCost` | number | 是 | 移动消耗，`-1` 表示不可通行 |
| `passable` | boolean | 是 | 是否可通行 |
| `color` | string | 是 | 地图渲染颜色（HEX）|
| `description` | string | 是 | 描述文本 |
| `resourceMultiplier` | number | 是 | 资源产出倍率 |
| `defenseBonus` | number | 否 | 防御加成（仅山脉等地形）|
| `spiritBonus` | number | 否 | 灵气加成（仅灵脉）|

### techniques.json — 功法定义

定义修仙界中存在的功法传承，按下乘/中乘/上乘/仙家四品阶分级，13种流派分类，共 25 条。

**世界观参考来源**：`docs/世界观参考/凡人修仙传_世界观设定.md`（功法品阶体系）、`docs/世界观参考/阳神_世界观设定.md`（道法体系）、`docs/世界观参考/仙逆_世界观设定.md`（长生体系）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `tech_great_dao`）|
| `name` | string | 是 | 中文功法名称 |
| `grade` | number | 是 | 品阶（1=下乘, 2=中乘, 3=上乘, 4=仙家）|
| `gradeName` | string | 是 | 品阶中文名 |
| `school` | string | 是 | 流派 ID |
| `schoolName` | string | 是 | 流派中文名 |
| `description` | string | 是 | 功法描述 |
| `source` | string | 否 | 世界观参考来源 |
| `rankRequired` | string | 是 | 最低修炼境界（引用 `ranks.json` 的 `id`）|
| `rankCeiling` | string | 是 | 可修境界上限（引用 `ranks.json` 的 `id`）|
| `factionAffinities` | string[] | 是 | 适合的流派/势力类型 |
| `effects.cultivationSpeedMultiplier` | number | 是 | 修炼速度乘数（乘以基础速度）|
| `effects.breakthroughBonus` | number | 是 | 突破成功率加成（0.0–0.20）|
| `effects.lifespanBonus` | number | 是 | 寿元加成年数（负数为消耗）|
| `effects.combatBonus` | number | 是 | 战力加成（0.0–0.40）|
| `effects.specialEffects` | array | 是 | 特殊效果列表（可为空数组）|

**specialEffects 格式**：`{ "type": "sense_range_bonus", "value": 3, "description": "..." }`

**扩展规则**：新增功法 `id` 格式为 `tech_<school>_<name>`（英文 snake_case）。必须标注 `source` 来源。

---

### monsters.json — 妖族异兽定义

定义修仙界中存在的妖兽、灵兽和上古异兽，按一~九阶分级，涵盖龙蛟、禽类、兽类、虫类、水族、狐族等多个族群。

**世界观参考来源**：`docs/世界观参考/凡人修仙传_世界观设定.md`（妖兽体系）、`docs/世界观参考/斗破苍穹_世界观设定.md`（魔兽等阶）、`docs/世界观参考/完美世界_世界观设定.md`（上古凶兽）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `beast_101`）|
| `name` | string | 是 | 中文名称 |
| `category` | string | 是 | 固定为 `"monster"` |
| `type` | string | 是 | 类型：`demon_beast`（妖兽）/ `spirit_beast`（灵兽）/ `ancient_beast`（上古异兽）|
| `family` | string | 是 | 族群：`dragon`/`avian`/`feline`/`canine`/`serpent`/`insect`/`aquatic`/`ape`/`bear`/`fox`/`equine`/`ancient` |
| `grade` | number | 是 | 等阶（1-9），对应修士境界威胁等级 |
| `gradeName` | string | 是 | 等阶中文名（一阶 ~ 九阶）|
| `equivalentRealm` | string | 是 | 等阶对应的修士境界（引用 `ranks.json` 的 `id`）|
| `habitat` | string[] | 是 | 栖息地（引用 `terrains.json` 的 `type`）|
| `attributes` | object | 是 | 属性：`strength`/`speed`/`defense`/`sense`/`vitality` |
| `innateAbility` | object | 是 | 天赋神通：`{ name, description }` |
| `drops` | array | 是 | 掉落物：`[{ itemId, chance, coreGrade?, material? }]` |
| `canTransform` | boolean | 是 | 是否可化形为人 |
| `transformRealm` | string | 否 | 化形所需最低境界（`canTransform:true` 时填写）|
| `isAncient` | boolean | 是 | 是否为上古异兽 |
| `swarmBehavior` | boolean | 否 | 是否群体行动 |
| `rideable` | boolean | 否 | 是否可驯化为坐骑 |
| `tameable` | boolean | 否 | 是否可驯化为灵宠 |
| `combatStyle` | string | 是 | 战斗风格描述 |
| `rarity` | string | 是 | 稀有度：`common`/`uncommon`/`rare`/`epic`/`legendary` |
| `description` | string | 是 | 描述文本 |
| `source` | string | 否 | 世界观参考来源 |

**等阶与修士境界对应：**

| grade | gradeName | equivalentRealm | 威胁等级 | rarity |
|-------|-----------|----------------|---------|--------|
| 1 | 一阶 | refining_qi | 炼气期可猎杀 | common |
| 2 | 二阶 | refining_qi / foundation | 炼气后期~筑基初期 | common/uncommon |
| 3 | 三阶 | foundation / core_formation | 筑基~结丹期 | uncommon/rare |
| 4 | 四阶 | core_formation / nascent_soul | 结丹~元婴期 | rare/epic |
| 5 | 五阶 | nascent_soul / deity_transformation | 元婴~化神期 | epic |
| 6 | 六阶 | deity_transformation | 化神期，多已化形 | epic |
| 7 | 七阶 | void_refining | 炼虚期，妖王 | legendary |
| 8 | 八阶 | body_integration | 合体期，妖皇候选 | legendary |
| 9 | 九阶 | tribulation_transcendence | 妖皇，传说级 | legendary |

**扩展规则**：新增妖兽 `id` 格式为 `beast_XXX`（一阶 101-199，二阶 201-299，依此类推）。必须标注 `source` 来源，`habitat` 需引用 `terrains.json` 中存在的地形类型。

---

### weapons.json — 法宝武器定义

定义所有可被 NPC 和势力持有的法宝武器道具，按品阶（法器/法宝/古宝/灵宝/通天灵宝）和流派分类。

**世界观参考来源**：`docs/世界观参考/凡人修仙传_世界观设定.md`（法宝体系）、`docs/世界观参考/完美世界_世界观设定.md`（宝器体系）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `weapon_101`）|
| `name` | string | 是 | 中文名称 |
| `category` | string | 是 | 大类：`weapon`（攻击）/ `armor`（防御）/ `treasure`（辅助）|
| `subtype` | string | 是 | 武器类型：`sword`/`blade`/`spear`/`bow`/`shield`/`armor`/`seal`/`cauldron`/`staff`/`flag`/`claw`/`orb`/`whip` |
| `grade` | string | 是 | 品阶：`magic_artifact`/`magic_treasure`/`ancient_treasure`/`spirit_treasure`/`heavenly_treasure` |
| `gradeNum` | number | 是 | 品阶数字（1-5），用于数值比较 |
| `gradeName` | string | 是 | 品阶中文名（法器/法宝/古宝/灵宝/通天灵宝）|
| `school` | string | 是 | 流派 ID（引用 `entities/factions.json`，或 `"universal"` 表示通用）|
| `schoolName` | string | 是 | 流派中文名 |
| `requiredRealm` | string | 是 | 最低使用境界（引用 `definitions/ranks.json` 的 `id`）|
| `stackable` | boolean | 是 | 是否可叠加（法宝一般为 `false`）|
| `attributes` | object | 是 | 属性：`attack`/`defense`/`speed`/`control`/`spirituality`，均为正整数 |
| `passiveEffect` | object\|null | 是 | 被动效果：`{ type, value, description }` 或 `null` |
| `activeEffect` | object\|null | 是 | 主动效果：`{ type, description }` 或 `null` |
| `price` | number | 是 | 基准价格（低级灵石）|
| `rarity` | string | 是 | 稀有度：`common`/`uncommon`/`rare`/`epic`/`legendary` |
| `description` | string | 是 | 描述文本 |
| `source` | string | 否 | 世界观参考来源 |

**品阶与境界对应：**

| gradeNum | grade | gradeName | 适用境界 | rarity |
|----------|-------|-----------|---------|--------|
| 1 | magic_artifact | 法器 | 炼气 — 筑基 | common/uncommon |
| 2 | magic_treasure | 法宝 | 筑基 — 结丹 | rare |
| 3 | ancient_treasure | 古宝 | 结丹 — 元婴 | epic |
| 4 | spirit_treasure | 灵宝 | 元婴 — 化神 | legendary |
| 5 | heavenly_treasure | 通天灵宝 | 化神+ | legendary |

**扩展规则**：新增法宝需标注 `school`（所属流派）和 `source`（世界观参考），`id` 格式为 `weapon_XXX`（法器 001-099，法宝 101-199，古宝 201-299，灵宝 301-399，通天灵宝 401-499）。

---

### names.json — NPC 姓名库

存放用于动态生成 NPC 姓名（出生子女）的字符池。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `surnames` | string[] | 是 | 姓氏列表（含复姓如"慕容"）|
| `maleNames` | string[] | 是 | 男性名字单字列表 |
| `femaleNames` | string[] | 是 | 女性名字单字列表 |

**扩展规则**：直接追加字符串到对应数组即可，无需修改代码。

---

## 二、world/ — 世界层

此目录存放**世界级配置数据**，包括地图和全局修正器。

### map.json — 世界地图

100×100 格的世界地图数据，包含地形分布、势力领地和灵脉位置。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `width` | number | 是 | 地图宽度 |
| `height` | number | 是 | 地图高度 |
| `tiles` | array | 是 | 所有格子数据 |
| `tiles[].x` | number | 是 | 横坐标 |
| `tiles[].y` | number | 是 | 纵坐标 |
| `tiles[].terrain` | string | 是 | 引用 `definitions/terrains.json` 的 `type` |
| `tiles[].owner` | string\|null | 是 | 引用 `entities/factions.json` 的 `id`，`null` 为无主 |
| `tiles[].spiritVein` | boolean | 否 | 是否有灵脉 |

**注意**：地图数据量较大（约 1MB），编辑器使用摘要模式渲染，避免一次性加载到 DOM。

### modifiers.json — 世界修正器（唯一来源）

定义可能出现的全局世界状态事件（如魔气上涨、大旱、秘境开启等）。

> **重要**：此文件是世界修正器的**唯一数据来源**，`world-rules.js` 代码不再内置 `MODIFIER_TEMPLATES`，完全依赖此 JSON 文件。

**世界观参考来源**：`docs/世界观参考/` 多部小说均有类似天灾/异变设定。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识 |
| `type` | string | 是 | 修正器类型键 |
| `name` | string | 是 | 中文名称 |
| `description` | string | 是 | 描述文本 |
| `minDuration` | number | 是 | 最短持续天数 |
| `maxDuration` | number | 是 | 最长持续天数 |
| `intensityMin` | number | 是 | 强度最小值（0-1）|
| `intensityMax` | number | 是 | 强度最大值（0-1）|
| `probability` | number | 是 | 每日出现概率（0-1）|
| `effects` | object | 是 | 效果键值对，数值为倍率或增减量 |

**扩展规则**：新增世界修正器只需追加数组元素，引擎自动识别。无需修改任何 JS 代码。

---

## 三、entities/ — 实体层

此目录存放**初始实体实例数据**，即游戏开局时加载的势力和 NPC 数据。

### factions.json — 势力初始数据

**世界观参考来源**：`docs/世界观参考/凡人修仙传_世界观设定.md` 势力部分。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `sect_001`）|
| `name` | string | 是 | 势力名称 |
| `type` | string | 是 | 阵营类型：`righteous` / `evil` / `neutral` / `demon` / `mortal` |
| `headquarters` | object | 是 | 总部坐标 `{ x, y }` |
| `stability` | number | 是 | 初始稳定度（0-100）|
| `resources` | object | 是 | 初始资源（键引用 `definitions/resources.json` 的 `id`）|
| `leader` | string | 是 | 掌门 NPC ID（引用 `entities/npcs.json`）|
| `traits` | string[] | 是 | 势力特性标签：`diplomatic` / `aggressive` / `defensive` / `secretive` |
| `relations` | object | 是 | 势力关系，键为其他势力 `id`，值为 -100 到 100 |

### npcs.json — NPC 初始数据

**世界观参考来源**：各小说对应的人物设定。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `npc_001`）|
| `name` | string | 是 | 人物名称 |
| `factionId` | string | 是 | 所属势力 ID（引用 `entities/factions.json`）|
| `role` | string | 否 | 门派职位，沿阶梯自低到高：`outer_disciple`（外门）/ `disciple`（内门）/ `core_disciple`（核心）/ `officer`（执事）/ `general`（将军）/ `elder`（长老）/ `heir`（继承人）/ `leader`（掌门）；散修为 `wanderer`。职位等级映射见 `social.json → roles.rankMap`，晋升阶梯见 `cultivation.json → promotion.ladder`。 |
| `roleQuota` | object | 否 | （仅 `factions.json`）顶层稀缺职位名额，按宗门规模配置，如 `{ "elder": 6, "heir": 1 }`。晋入这些职位时：有空缺直接补位，满员则需挑战现任、成功则现任降一级。无配置时回退全局 `cultivation.json → promotion.quotaByRole`。 |
| `personality` | object | 是 | 性格参数 |
| `personality.ambition` | number | 是 | 野心（0-100）|
| `personality.caution` | number | 是 | 谨慎（0-100）|
| `personality.loyalty` | number | 是 | 忠诚（0-100）|
| `personality.diplomacy` | number | 是 | 外交（0-100）|
| `alive` | boolean | 是 | 是否存活 |
| `rankId` | string | 是 | 境界 ID（引用 `definitions/ranks.json`）|

**注意**：NPC 的年龄、寿元上限等运行时属性由引擎初始化时根据 `rankId` 自动计算，无需在此文件中手填。

---

## 四、needs/ — 需求层

此目录存放 **AI 需求池配置**，定义势力和 NPC 的需求类型和优先级评估规则。

### 通用需求字段规范

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `need_survival`）|
| `name` | string | 是 | 需求名称 |
| `description` | string | 是 | 描述 |
| `basePriority` | number | 是 | 基础优先级（越高越重要）|
| `evaluatorType` | string | 是 | 评估器类型（目前固定 `configurable`）|
| `evaluatorConfig` | object | 是 | 评估规则配置 |
| `evaluatorConfig.basePriority` | number | 是 | 同 `basePriority` |
| `evaluatorConfig.rules` | array | 是 | 条件规则数组 |
| `evaluatorConfig.rules[].condition` | object | 是 | 触发条件 `{ key, op, value }` |
| `evaluatorConfig.rules[].priorityBoost` | number | 是 | 满足条件时的优先级加成 |
| `evaluatorConfig.rules[].urgencyBoost` | number | 是 | 满足条件时的紧迫度加成 |
| `evaluatorConfig.satisfiedCondition` | object\|null | 是 | 需求满足条件，`null` 表示永不满足 |
| `goalState` | object | 是 | GOAP 目标状态 `{ key: { op, value } }` |

**条件操作符**：`eq` / `lt` / `lte` / `gt` / `gte` / `true` / `false`

### faction-needs.json — 势力需求

当前已定义的需求：生存、防御、扩张、发展、外交、军事。

### npc-needs.json — NPC 需求

当前已定义的 **4 个真实动机需求**（ADR-011 重构后）：

| id | 名称 | goalState | 触发要点 |
|----|------|-----------|----------|
| `need_npc_cultivation` | 修炼 | `cultivationProgress >= 1.0` | 本业，和平期主导（base 30）。贡献足时直接赴修炼场；不足时 GOAP 自动推导"接→做→交任务攒贡献→进修炼场"经济链 |
| `need_npc_survival` | 长寿 | `lifeRatio < 0.8` | 寿元将尽（`lifeRatio` 高）时优先级飙升 |
| `need_npc_heal` | 回血 | `injuryLevel < 1` | 受伤（`injuryLevel >= 1`）后疗伤，伤愈前压过日常修炼 |
| `need_npc_loyalty_duty` | 职责 | `questTurnedIn == true` | 绑定月度贡献考核：`monthlyQuotaMet == false` 时优先级飙升驱动做任务；`satisfiedCondition` 为额度已达标 |

> **设计原则（ADR-011）**：删除了 `need_npc_quest/ambition/breakthrough` —— "做任务"是 GOAP 为满足修炼/职责而推导的**手段**而非需求；突破由 `_tryBreakthrough` 在进度满时自动判定。

**扩展规则**：新增需求只需追加数组元素并分配唯一 `id`，引擎通过 `NeedPool` 自动注册。如需自定义评估器逻辑，需在 `evaluatorType` 中使用新类型名，并在代码中注册对应的 `NeedEvaluator` 实现。

---

## 五、quests/ — 任务层

此目录存放 **宗门任务系统配置**。NPC 通过接取、执行、交付任务来获取贡献，宗门获得任务物品。

### quest-templates.json — 任务模板

单对象格式，包含以下子结构：

#### difficulties — 难度等级（10 阶）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `level` | number | 是 | 难度等级（1-10）|
| `name` | string | 是 | 中文名称（如"三阶"）|
| `dangerInjury` | number | 是 | 受伤概率（0-1）|
| `dangerDeath` | number | 是 | 殒命概率（0-1）|
| `rewardStones` | number | 是 | NPC 获得低级灵石奖励 |
| `factionStones` | number | 是 | 宗门获得低级灵石 |
| `durationDays` | number | 是 | 任务持续天数 |

#### questTypes — 任务类型

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `qt_patrol`）|
| `name` | string | 是 | 中文名称 |
| `repeatable` | boolean | 是 | `true` = 日常任务（无限接取），`false` = 单次任务 |
| `category` | string | 是 | 分类：`daily` / `combat` / `external` / `exploration` / `resource` |
| `difficultyRange` | number[] | 是 | 可用难度范围 `[min, max]` |
| `locationTarget` | string | 否 | 任务发生地解析方式：`hq`（本门总部；**散修→最近悬赏阁/坊市**）/ `monster`（最近妖兽）/ `terrain:<类型>`（最近的该地形格，如 `terrain:forest`）。弟子接取任务时据此**锁定一个固定坐标**，执行任务行为时需先移动到该坐标再完成（路程=格数天）。地形若全图不存在则回退到最近平原。|
| `description` | string | 是 | 描述文本 |

> **任务固定坐标流程（2026-05-29）**：`接取任务(在总部) → 执行任务(走到 locationTarget 锁定的坐标) → 交付任务(走回总部)`。接取时坐标写入 NPC 状态 `questTargetX/questTargetY`，由行为 `act_npc_do_quest` 的 `targetResolver: quest_target` 读取。
>
> **散修悬赏（2026-05-29）**：散修（无 `factionId`）复用同一套任务模板与"接→做→交"三连流程，但接/交地点改为**最近的悬赏阁(`org_bounty`)/坊市(`org_market`)**（解析见 `TickManager._nearestBountyOrg`，优先悬赏阁、其次坊市，再按距离择近）。交付时散修**不上缴宗门分成、不获贡献点**，但灵石奖励按 `cultivation.json → bounty.wandererRewardMultiplier` 加成（默认 1.5 倍，赏金由悬赏阁/坊市库存垫付）。详见 ADR-009。

#### rankMaxDifficulty — 境界可接最高难度

> **注意**：此配置现已迁移至 `data/balance/cultivation.json` 的 `rankMaxDifficulty` 字段（数据来源统一）。`quest-templates.json` 中的同名字段仍保留作向后兼容，但以 cultivation.json 为准。

#### randomQuestSpawnChance — 单次任务每日出现概率

键为难度等级（字符串），值为出现概率（0-1）。难度越高出现概率越低。

---

## 六、actions/ — 行为层

此目录存放 **AI 行为池配置和世界规则**，定义 GOAP 可用动作和世界级自动行为（含任务相关行为）。

### 通用行为字段规范

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识（如 `act_develop`）|
| `name` | string | 是 | 行为名称 |
| `description` | string | 是 | 描述 |
| `category` | string | 是 | 分类：`faction` / `npc` / `world_rule` |
| `weight` | number | 是 | GOAP 搜索代价权重（越小越优先被选择）|
| `preconditions` | object | 是 | 前置条件 `{ key: { op, value } }`，空对象 `{}` 表示无前置 |
| `effects` | object | 是 | 执行效果 `{ key: { op, value } }` |
| `costs` | array | 是 | 消耗物品列表 `[{ itemId, amount }]` |
| `yields` | array | 是 | 产出物品列表 `[{ itemId, amount }]` |
| `executorId` | string | 是 | 关联的代码执行器 ID |
| `params` | object | 否 | 额外参数（传递给执行器）|
| `duration` | number | 否 | 行为耗时（游戏日），默认 1（瞬时）。到达目标地点后执行行为本身所需天数 |
| `requiresTravel` | bool | 否 | 默认 false。为 true 时实体先移动到 `targetResolver` 解析出的地点再执行 |
| `targetResolver` | string | 否 | 目标地点解析方式（见下表）。默认 `self` |
| `distanceCostPerTile` | number | 否 | 每格移动折算的 GOAP 规划代价系数（仅影响规划偏好，默认 0）|

**`targetResolver` 取值表**：

| 取值 | 解析结果 |
| --- | --- |
| `self` | 原地（不移动）|
| `faction_hq` | 所属势力**主殿**坐标（等价 `main_hall`）|
| `main_hall` | 所属势力主殿（履职述职、挑战上位）|
| `quest_hall` | 宗门弟子→所属势力任务殿；**散修→最近的悬赏阁/坊市**（接取/交付悬赏）|
| `library` | 所属势力藏经阁 |
| `alchemy` | 所属势力炼丹房（求续命丹药）|
| `training` | 所属势力修炼场（多个时取就近）|
| `market` | 最近的中立机构（坊市）总部 |
| `nearest_monster` | 最近妖兽 |
| `wander_far` | 随机远方野外可通行点（游历，不主动靠近妖兽）|
| `quest_target` | 接任务时锁定的固定坐标 |

> **建筑级目标解析（2026-05-29）**：势力领地建筑由 `TerritoryLayoutGenerator` 在初始化时生成并记录坐标（`stats.buildingsByFaction`），引擎与 TickManager 通过 `getFactionBuilding(factionId, buildingType, from?)` 查询；`main_hall`/`quest_hall`/`library`/`alchemy`/`training` 解析器据此把行为引导到对应建筑而非都挤总部中心。找不到对应建筑时回退势力总部坐标；无所属势力（散修）时回退最近坊市。同类建筑（如多个修炼场）按 `from` 就近选择。
>
> **行为→建筑映射**：`接取/交付任务 → 任务殿`、`履行职责/挑战上位 → 主殿`、`寻找续命丹药 → 炼丹房`、`辅助势力 → 原地就近（不再专程返回总部）`、`修炼（act_npc_cultivate） → 原地（洞府闭关，免费）`、`赴修炼场修炼（act_npc_train_chamber） → 修炼场（消耗门派贡献，修炼速度 +100%，仅宗门弟子）`、`疗伤（act_npc_heal） → 原地（受伤后恢复 injuryLevel）`、`游历 → wander_far`。此举把 NPC 从"全部聚集主殿"分散到各功能建筑，并减少无谓往返。修炼场行为详见 ADR-010/ADR-011。

**效果操作符**：`add`（增减）/ `set`（直接设置）/ `true` / `false`

**行为耗时与移动（2026-05-29 新增）**：未声明 `duration`/`requiresTravel` 的行为保持原瞬时、原地语义（向后兼容）。声明后行为经历 `TRAVELING → EXECUTING → DONE` 三阶段，跨多个 tick 完成；期间实体 `state.actionStatus` 为 `traveling`/`executing`，处于 busy，不重新规划。`duration` 通过 `Action.getPlanCost()` 计入 GOAP 代价（耗时越长代价越高）。

### faction-actions.json — 势力行为

当前已定义：内部发展、招募弟子、领地扩张、加强防御、攻伐、外交结盟、贸易交换、安抚内政。

### npc-actions.json — NPC 行为

当前已定义：修炼（原地闭关）、赴修炼场修炼（消耗贡献换 +25% 速度）、履行职责、寻找续命丹药、挑战上位、辅助势力、游历、接取/执行/交付任务。

**价值-风险字段（ADR-017，每个行为）**：

| 字段 | 说明 |
|------|------|
| `valueScore` | 行为基础价值（数值越大越「想做」，在决策代价中作减项）。当前取值：游历 14、寻续命丹 15、赴修炼场 12、挑战 10、交付任务 9、闭关 8、执行任务 7、辅助势力 6、疗伤 5、履职 4、接任务 3 |
| `riskKey` | 映射 `risk.json` 下的风险键；游历=`explore`，其余暂为 `null`（无风险，期望风险损失为 0）。`estimateRiskCost` 对 `null`/缺失键返回 0 |

### world-rules.json — 世界规则

世界规则是 Tick 级自动执行的行为，不由 GOAP 规划触发，而是每回合由 `TickManager` 直接执行。

当前已定义：世界状态生成、世界状态消退、天灾、资源再生。

**扩展规则**：新增行为只需追加数组元素。如果行为需要全新的执行逻辑，需在对应的 `*-actions.js` 代码中注册新的 `ActionExecutor`，并在 `executorId` 中引用。

---

## 七、balance/ — 平衡层（新增）

此目录存放**游戏数值平衡参数**，设计原则：**修改这里的值不需要修改任何 JS 代码**。

### combat.json — 战斗与外交参数

| 字段路径 | 说明 |
|----------|------|
| `attack.*` | 攻击战力公式系数、损失比例、稳定度变化 |
| `alliance.*` | 结盟关系阈值与加成 |
| `trade.*` | 贸易比例、上限、关系收益 |
| `diplomacy.*` | 敌意判定阈值、弱势判定条件；`diplomacy.attackReachDistance` 为势力攻伐的地理可达阈值（总部曼哈顿距离，超出则攻不到）|
| `military.*` | 综合实力公式权重 |
| `relations.*` | 关系自然衰减阈值 |

### economy.json — 经济与资源参数

| 字段路径 | 说明 |
|----------|------|
| `resourceRegen.*` | 每日每领地资源产出 |
| `veinOutput.*` | 各类灵脉的每日灵石产出 |
| `stability.*` | 稳定度恢复/衰减规则 |
| `dailyCosts.*` | 每日弟子与领地维护消耗 |
| `salary.roles.*` | 各职位每月俸禄 |
| `formation.*` | 大阵每月维护费公式 |

### cultivation.json — 修炼与突破参数

| 字段路径 | 说明 |
|----------|------|
| `cultivationSpeed.*` | 各境界**每天**修炼进度（0~1）。进度按 `act_npc_cultivate` 的 `duration` 天数累计，故修满一境界耗时 ≈ `1/speed` 天。**ADR-011 后下调约 12 倍**：普通闭关修满一境界 ≈ 该境界寿元的 **120%**（几乎耗尽一生），赴修炼场（×2 加速）后 ≈ **60%** 寿元 |
| `cultivationCap.*` | 各境界闭关进度 `cultivationProgress` 的上限（凡人/弟子 1.0…化神 0.3，下限 0.3）。撞顶后突破剩余进度靠游历 `insight` 补足。详见 ADR-016 |
| `cultivationDecayK` | 闭关边际递减系数（ADR-017，默认 2.5）。每次闭关有效增量 = 基础增量 × `e^(-k × current/cap)`，越接近 cap 越慢但能缓慢到顶 |
| `minCultivationRatio` | 突破总进度中闭关进度的最低占比（ADR-017，默认 0.3）。`insight` 累加封顶 `1 - 该值`；突破额外要求 `cultivationProgress ≥ 该值` |
| `spiritStoneCost.*` | 各境界**每天**修炼灵石消耗（实际消耗 = 该值 × duration） |
| `qiBaseGain.*` | 各境界**每天**修炼基础真气获取（实际 = 该值 × duration） |
| `breakthrough.successRates.*` | 各境界突破成功率（最终成功率 = (基础 + 功法 + 灵根 + 体质 加成) × 年龄惩罚）|
| `spiritRoot.grades.*` | 灵根（资质）5 档：`speedMultiplier`（乘修炼速度）/`breakthroughBonus`（加突破率）/`weight`（初始分布权重）。档位：天/双/三/四/伪灵根。详见 ADR-012 / wiki/rules/spirit-root.md |
| `spiritRoot.default` | NPC 未指定灵根时的默认档（`triple`）|
| `physique.types.*` | 体质池：`speedMultiplier`/`breakthroughBonus`/`lifespanBonus`（突破刷新寿命时按比例叠加）/`specialEffects`（占位待定）/`weight`。凡体为主(~95%)+稀有特殊体。详见 ADR-012 / wiki/rules/physique.md |
| `physique.default` | NPC 未指定体质时的默认（`mortal_body` 凡体）|
| `actions.seekElixir.*` | 寻找续命丹参数 |
| `actions.challenge.*` | 挑战上位参数 |
| `actions.explore.*` | 游历结果概率（`fortuneProgress*` 为机缘进度跃升，相对修炼速度是一次性小幅提升） |
| `actions.trainChamber.contributionCost` | 赴修炼场单次消耗的门派贡献点（默认 10，需与 `act_npc_train_chamber` 的 `contribution.gte` 前置阈值一致）|
| `actions.trainChamber.speedBonusMultiplier` | 赴修炼场修炼速度倍率（ADR-011 后默认 **2.0 = +100%**）|
| `monthlyContribution.intervalDays` | 月度贡献考核周期（天，默认 30）|
| `monthlyContribution.quotaByRank.*` | 各境界当月需达的贡献额度，未达贬为外门弟子 |
| `monthlyContribution.topRewardMultipliers` | 各势力当月贡献前 N 名额外奖励灵石 = 该弟子月俸 × 此倍率（默认 `[5,3,2]`）|
| `sectEvents.sect_exam.intervalDays` | 门派考核周期（天，默认 180）|
| `sectEvents.sect_exam.minRankOrder` | 考核境界门槛（`ranks.json` 的 `order`），成年弟子低于此值贬外门（默认 20=炼气）|
| `sectEvents.grandCompetition.intervalDays` | 门派大比周期（天，默认 360）|
| `sectEvents.grandCompetition.rewardCount` | 大比奖励名额（仅前 N 名，默认 5）|
| `sectEvents.grandCompetition.stoneRewards` / `contributionRewards` | 前 N 名的灵石/贡献奖励数组（梯度拉开）|
| `sectEvents.grandCompetition.byRank` | 是否按境界分组比试（默认 true：同境界弟子单独排名、每组各取前 N 名、组内第一名晋升；false 则全门派混排）|
| `sectEvents.grandCompetition.exemptRoles` | 不参加大比的治理层职位（默认 `["leader","heir","elder"]`；大比激励中下层后辈，顶层不下场挤占名额）|
| `sectEvents.grandCompetition.championPromote` | 各（境界）组第一名是否沿职位阶梯晋升一级（弹性通道，不受名额限制）|
| `bounty.wandererRewardMultiplier` | 散修交付悬赏时灵石奖励相对宗门弟子基础奖励（`quest-templates.json → difficulties[].rewardStones`）的倍率（默认 1.5；散修无宗门抽水拿得更多，但无贡献点）|
| `rankMaxDifficulty.*` | 各境界可接最高任务难度 |
| `promotion.intervalDays` | 贡献晋升结算周期（天，默认 90）|
| `promotion.ladder` | 职位晋升阶梯（自低到高数组）：`outer_disciple→disciple→core_disciple→officer→general→elder→heir` |
| `promotion.roleRankByStep.*` | 各职位对应的 `roleRank` 数值（与 `social.json → roles.rankMap` 一致）|
| `promotion.contributionByStep.*` | 晋升到该职位所需的**终身累计**贡献门槛 |
| `promotion.rankOrderByStep.*` | 晋升到该职位所需的最低境界 order（与 `ranks.json` 对齐）|
| `promotion.quotaByRole.*` | 各高阶职位的本门名额上限（达上限不再晋升新人，形成稀缺）|

> **时间尺度（2026-05-29）**：1 tick = 1 天，1 年 = 360 天。修炼/任务/游历等行为的耗时已与寿命尺度对齐——
> - 修炼进度按天累计（executor 内 `progress += speed × duration`），修满一境界 ≈ `1/cultivationSpeed` 天（与 duration 无关）。
> - 行为 `duration`（`npc-actions.json`）：修炼 30 天、履职/辅助 20 天、挑战 15 天、求药 60 天、游历 90 天、接取/交付任务 2 天。
> - 任务时长由 `quest-templates.json` 的 `durationDays`（10~150 天）决定，每天推进一次；`dangerInjury/dangerDeath` 为**整段任务**总风险，executor 内按 `÷durationDays` 摊到每天，避免长任务逐日掷骰累计成必死。
> - 配合 NPC 决策周期（`ai-config.json` `decisionIntervalMin/Max`），出关决策间隔自然达数月至一年级，符合修士闭关节奏。

### social.json — 社会关系参数

| 字段路径 | 说明 |
|----------|------|
| `daoCompanion.*` | 道侣匹配频率、条件、成功率 |
| `birth.*` | 生育频率、成功率、子女上限 |
| `birth.personalityMutationRange` | courage/justice 遗传变异幅度（ADR-017，默认 20）：child = clamp(0~100, 父母均值 ± 该值) |
| `succession.rolePriority` | 掌门继任职位优先级顺序 |
| `roles.rankMap.*` | 各职位对应的角色等级 |

### movement.json — 移动速度参数

| 字段路径 | 说明 |
|----------|------|
| `npcSpeedByRank.*` | 各境界 NPC 每 tick（每游戏日）可移动格数；`default` 为兜底。当前统一为 1（每走 1 格 = 1 天）|
| `monsterSpeedByGrade.*` | 各阶位妖兽每 tick 可移动格数；`default` 为兜底 |
| `monsterSpeedAttributeWeight` | 在妖兽阶位速度基础上叠加 `attributes.speed` 的权重 |

### personality.json — 性格系统参数

数据驱动的"性格 → 需求加成"配置表。详见 `docs/worldbuilding/wiki/rules/personality.md`。

| 字段路径 | 说明 |
|----------|------|
| `traits.<trait>` | 性格维度定义（`ambition` 野心 / `caution` 谨慎 / `loyalty` 忠诚 / `diplomacy` 外交 / `courage` 勇敢 / `justice` 正义感），含 `name`/`description`/`default`。NPC 实际取值在 `npcs.json → personality`（0-100），缺省按 `default`（50）兜底。`justice` 本期仅字段+赋值+遗传（ADR-017）|
| `needBoosts.<trait>[]` | 该性格维度对各需求的加成列表。每项：`need`（目标需求 id）、`minThreshold`（生效阈值，性格值需 > 此值）、`maxPriorityBoost`/`maxUrgencyBoost`（满值 100 时的加成上限）、可选 `requireState`（state 门控条件）|
| 加成公式 | `加成 = round((trait - minThreshold) / (100 - minThreshold) × maxBoost)`，阈值处为 0、满值为 maxBoost，线性插值 |

> 接入：`ConfigurableEvaluator` 在评估需求时读 `entityState.personality` 与 `worldContext.balanceConfig.personality` 施加加成；性格存于 state 专用字段、不进 GOAP 状态键。首阶段仅 `ambition → need_npc_ambition` 落地，其余维度留空待扩展（开闭原则：扩展只增配置不改代码）。

### monster-spawn.json — 妖兽分布参数

| 字段路径 | 说明 |
|----------|------|
| `totalMonsters` | 地图上妖兽实例总量 |
| `spawnSeed` | 分布随机种子（确定性，保证同 seed 分布一致）|
| `dangerByDistance[]` | 按"距最近势力总部曼哈顿距离"分段的允许阶位区间 `{ maxDist, minGrade, maxGrade }`，越远越强 |
| `northDepthY` / `northMinMaxGrade` | 北部深山（y < northDepthY）额外提升阶位上限 |
| `veinRareBonus` | 灵脉格附近提高稀有妖兽（rare/epic/legendary/mythic）出现概率 |
| `wanderRadius` | 妖兽游荡半径（以出生点为中心）|
| `senseRange` | 妖兽感知范围（在此范围内寻找低境界 NPC 猎物）|
| `rarityWeight.*` | 各稀有度的抽样权重 |
| `combat.killChanceFactor` | 猎杀概率系数（越小妖兽越温和；最终击杀率 = 战力胜率 × 该系数）|
| `combat.huntChancePerTick` | 每 tick 主动发起狩猎的概率（降低整体猎杀频率）|
| `combat.huntCooldownDays` | 攻击后进入猎食冷却的天数（期间不主动找猎物）|
| `combat.minOrderGapToHunt` | 只猎杀 order 低于自己达此差值以上的 NPC（不再见到弱一点点就杀）|
| `combat.npcCounterDamageBase` / `npcCounterOrderWeight` | NPC 反击伤害基数与按 order 的加成权重；妖兽 HP 归零即被反杀 |
| `lifespan.byGrade.<grade>.baseYears` / `varianceYears` | 妖兽寿元上限按阶位决定（baseYears ± varianceYears 年）；整体比同等修为人类更长（妖兽天生寿元长）|
| `lifespan.initialAgeRatioMin` / `initialAgeRatioMax` | 妖兽初始年龄占寿元上限的比例区间 |
| `lifespan.death.startRatio` / `minChance` / `maxChance` | 到寿曲线参数：age < startRatio×maxAge 不死；startRatio→100% 间按二次曲线 `minChance+(maxChance-minChance)×t²` 递增；到 100% 必死。与 `game-config.json` 的 `naturalDeath` 同义 |
| `population.daysPerYear` | 每年天数（用于寿元年龄换算）|
| `population.respawnEnabled` | 是否在数量低于目标时补充妖兽 |
| `population.respawnTargetRatio` | 维持的目标数量 = 初始数量 × 该比例 |
| `population.respawnPerTickMax` | 每 tick 最多补充的妖兽数量 |

> **妖兽寿元/自然死亡**：与 NPC 采用同一套"到寿而终"机制（`MonsterState.advanceAge()` + `checkNaturalDeath()`，二次曲线，详见 `npc-state.js`），区别在于寿元上限按 **阶位** 决定且整体长于同等修为人类。妖兽的死亡因此以 **被 NPC 反杀** 为主、**到寿自然死亡** 为辅（高龄个体才会触发）。不再使用旧的"每 tick 固定概率自然死亡"。

> 妖兽实体（type `monster`）由 `MonsterSpawner` 在引擎初始化时按上述规则铺到地图，注册进 `EntityRegistry`，每 tick 经轻量状态机（游荡/觅食/休整）行动并随 `MovementSystem` 移动。妖兽可因到寿自然死亡或被 NPC 反杀而消失，`TickManager` 在数量低于目标比例时补充，使种群动态波动。

> **死亡收集机制**：所有实体死亡（NPC 自然/妖兽猎杀/任务身陨、妖兽自然/被反杀）都会在实体上写入 `_deathInfo`（含 `cause`），由 `TickManager._collectDeaths()` 统一收集到 `tickLog.deaths` / `tickLog.monsterDeaths`，渲染层据此输出死亡日志，避免死因丢失。

> **位置事件日志（2026-05-29）**：所有"在某地发生的事"统一带上发生坐标与地点名，便于按位置回溯世界动态。约定如下（详见 ADR-009）：
> - **统一 schema**：每条位置事件含 `{ type, day, x, y, locationName, description, ... }`。`locationName` 由 `TickManager._resolveLocationName(x,y)` 解析（领地→`<势力名>领地`，否则取地形 `name`）。
> - **发射入口**：`TickManager._emitLocationEvent(tickLog, payload)` 自动取坐标（传 `entity` 时取其 `spatial.tileX/Y`）并补 `locationName`，写入 `tickLog.events`。
> - **覆盖事件**：悬赏/任务接取与完成（`wanderer_bounty_accept/_do/_turn_in`、`quest_accept/_do/_turn_in`，由 `_emitNpcActionEvent` 在行为结算时发出）、道侣（`dao_companion`）、生育（`birth`）写入 `tickLog.events`；势力攻击/结盟（`attack`/`alliance`，取发起方总部坐标）、妖兽袭击（`monster_attack`，取妖兽/NPC 坐标）由 `_enrichInfoEvents` 给 `tickLog.infoEvents` 补坐标；`tickLog.deaths`/`monsterDeaths` 各条新增 `x`/`y`/`locationName`。
> - **去重**：`do_quest` 仅在 `outcome === 'complete'` 时发位置事件；任务中身陨由死亡收集统一记录（含坐标），不重复发事件。
> - **展示**：模拟器实时日志（`simulation-main.js processTickLog`）消费上述事件，文案后缀 ` @(x,y) 地点名`（`_locSuffix`）。`game-manager` 的神识范围过滤（`isInPlayerSenseRange(x,y)`）可直接复用这些坐标。

> 配套实体字段：持有空间组件的实体（NPC、妖兽）在 snapshot 中输出 `spatial`：
> `{ x, y, tileX, tileY, speed, moving, destination }`。势力不使用空间组件（以 `headquarters` + `territory` 表达位置）。

### tile 运行时字段：领地与建筑布局（不落盘 map.json）

`map.json` 的每个 tile 只存地形（`terrain`）。领地形状与建筑由引擎初始化阶段的
`TerritoryLayoutGenerator` 生成并**写入内存中的 tile**（`ownerId / district / building`），
渲染层共享同一 `tileIndex` 引用即可读取。枚举集中在
`apps/game/js/engine/world/layout-constants.js`，生成器与渲染器共用。

| 字段 | 取值 | 说明 |
|------|------|------|
| `ownerId` | 势力 id / null | 该格所属势力（领地） |
| `district` | `core` \| `inner` \| `wall` \| `mine` | 分区：核心院落 / 外围有机领地 / 院墙 / 矿区 |
| `building` | 见下枚举 / null | 该格上的功能建筑 |

`BuildingType` 枚举：
`main_hall`（主殿）、`quest_hall`（任务殿，接任务/兑奖）、`training`（修炼场）、
`library`（藏经阁）、`alchemy`（炼丹房）、`gate`（山门）、`market`（坊市，中立机构核心）、
`mine_node`（采矿点）、`guard_post`（守卫位）。

> **建筑功能（2026-05-29）**：建筑不再是纯图标，而是带语义的行为目的地（见 `targetResolver` 取值表）。其中**主殿（main_hall）是势力行政中枢**：掌门（`currentRole === 'leader'`）在主殿坐镇履行职责（`act_npc_serve_faction`）时，除常规 `leaderStoneBonus/leaderFoodBonus` 外额外触发"行政中枢加成"（`cultivation.json` → `actions.serveFaction.mainHallStoneBonus/mainHallFoodBonus/mainHallStabilityBonus`），提升宗门资源产出与稳定度。判定条件为掌门当前坐标处于主殿格（含相邻 1 格）。

布局规则（详见 ADR-007）：
- 形状=「混合」：总部为中心 BFS+噪声生成有机领地（`inner`），中心嵌入轴对齐规整院落（`core`，外圈 `wall`）。
- 院落建筑固定相对位置：中心主殿/坊市、下方任务殿、四角修炼场、两侧藏经阁/炼丹房、下墙山门。
- 矿脉连通块标 `mine`，按间隔布采矿点 + 边缘守卫位；矿区只装饰未被势力占领的矿脉格。
- 阵营主题色按 `faction.type` 映射（正派青、邪修紫红、魔道暗红、王朝金、中立灰蓝）。
- 本阶段为纯可视化，建筑暂不参与模拟逻辑。

实体图标渲染（`SimulationRenderer._drawEntities`）：
- **NPC**：画「小人」图标，颜色按所属势力——以阵营主题色为基调，按 `factionId` 哈希微扰色相/明度，使同阵营不同势力可区分；**散修（无 `factionId`）用白色**。
- **妖兽**：画「牛头」图标，颜色按阶位 1→9 由橙红渐变到紫（越深阶越高）。
- 缩放过小（scale < 0.22）时图标退化为圆点以保证可读与性能；被跟随的实体加白色描边圈。

---

## 八、config/ — 全局配置层（新增）

此目录存放**系统级配置**，一般在项目立项时确定，不频繁修改。

### game-config.json — 游戏全局配置

| 字段路径 | 说明 |
|----------|------|
| `map.width` / `map.height` | 世界地图尺寸 |
| `player.*` | 玩家初始参数 |
| `time.daysPerYear` | 游戏内1年天数（默认360）|
| `npc.*` | NPC 初始年龄随机范围 |
| `naturalDeath.*` | 自然死亡判定曲线参数 |
| `reliability.*` | 情报可信度阈值 |

### ai-config.json — AI 规划器配置

| 字段路径 | 说明 |
|----------|------|
| `faction.maxDepth` | 势力 GOAP 搜索深度 |
| `faction.maxIterations` | 势力 GOAP 最大迭代次数 |
| `npc.maxDepth` | NPC GOAP 搜索深度 |
| `npc.maxIterations` | NPC GOAP 最大迭代次数 |
| `npc.decisionIntervalMin` / `decisionIntervalMax` | NPC 决策周期（天）随机区间。每次完成一轮大决策后随机休整 min~max，期间**原地修炼**，到期才重新评估需求并规划。使各 NPC 决策时机错开，避免所有 NPC 同一 tick 齐步行动。由 `NPCEntity._planBehavior` 门控（见该文件）|
| `npc.decision.lambdaRisk` | 价值-风险决策（ADR-017）：期望风险损失在决策代价中的放大系数（默认 40，把 0~1 量级风险放大到与基础消耗可比）|
| `npc.decision.lambdaValue` | 行为价值在决策代价中的折算系数（默认 1.0，作减项）|
| `npc.decision.headstrongChance` | 「上头」命中概率（很小，默认 0.03）：每次决策对每个行为独立 roll |
| `npc.decision.headstrongValueBonus` | 上头命中时注入的价值加成（很大，默认 500），使该行为在代价比较中胜出 |
| `npc.decision.costFloor` | 决策代价下限（默认 0.1），防负、防 A* 退化 |
| `npc.decision.exploreFirstCostFactor` | `breakthroughPathOrder=explore_first` 时游历基础消耗的乘子（<1，默认 0.5），让 A* 先选游历 |

> **价值-风险决策（ADR-017）**：决策代价 = 基础消耗 + `lambdaRisk`×期望风险损失 − `lambdaValue`×行为价值，夹 `costFloor` 下限。期望风险/价值与「上头」命中在 `NPCEntity._planBehavior` 进规划前一次性算好并固定（A* step cost 单次规划内稳定），通过 `costFn` 透传给规划器（慢/快路径均用）。命中上头且为首行为时 state 打 `lastDecisionHeadstrong`/`headstrongActionId` 标记。

> **NPC 决策节奏（2026-05-29）**：NPC 不再每 tick 都重新规划。行为系统空闲时，若决策周期未到则注入"原地修炼"并递减冷却；到期才做 GOAP 规划并重置一个新的随机周期。配合需求权重调整（降低修炼和平加成、提高任务吸引力）与 `act_npc_explore` 改用 `wander_far`（不再走向妖兽），NPC 会在地图上更活跃地外出接任务/做任务/游历，且行为时机分散。

---

## 数据引用关系图

```text
definitions/weapons.json ◄──── (NPC装备系统，待扩展)
definitions/ranks.json ◄─── entities/npcs.json (rankId)
                       ◄─── balance/cultivation.json (rankMaxDifficulty keys)
definitions/resources.json ◄─── actions/*.json (costs/yields itemId)
                           ◄─── entities/factions.json (resources keys)
definitions/terrains.json ◄─── world/map.json (tiles[].terrain)
definitions/names.json ──────► engine/world/tick-manager.js (_processBirths)
entities/factions.json ◄──── entities/npcs.json (factionId)
                       ◄──── world/map.json (tiles[].owner)
needs/*.json ───────────► 引擎 NeedPool 注册
actions/*.json ─────────► 引擎 ActionPool 注册
quests/quest-templates.json ─► 引擎 worldContext.questTemplates
world/modifiers.json ───────► 引擎 worldContext.modifierTemplates（唯一来源）
balance/combat.json ────────► 引擎 worldContext.balanceConfig.combat
balance/economy.json ───────► 引擎 worldContext.balanceConfig.economy
balance/cultivation.json ───► 引擎 worldContext.balanceConfig.cultivation
balance/social.json ────────► 引擎 worldContext.balanceConfig.social
balance/movement.json ──────► 引擎 worldContext.balanceConfig.movement（NPC/妖兽速度）
balance/personality.json ───► 引擎 worldContext.balanceConfig.personality（性格→需求加成）
balance/risk.json ──────────► 引擎 worldContext.balanceConfig.risk（游历风险结算 + 性格加成）
balance/memory.json ────────► NPCEntity.memory（记忆强度/衰减/恩怨增量，ADR-019）
balance/obsession.json ─────► NPCEntity.obsessions（先天 roll + 后天触发 + goalMult 执念乘子，ADR-019/020）
balance/emotion.json ───────► NPCEntity.emotions（事件激发 + 目标调制，ADR-019）
balance/utility.json ───────► NPCEntity.decorateGoalConsiderations（Consideration 乘法式 Utility + TimeValue/风险，ADR-020；enabled 默认 false 零漂移）
world/news.json ────────────► TickManager.infoSystem（InfoPropagationSystem：消息传播/多渠道，ADR-024；enabled 默认 false）
world/opportunities.json ───► TickManager.opportunitySystem（OpportunitySystem：机会点 spawn/expire，ADR-024；enabled 默认 false）
balance/covet.json ─────────► TickManager._tickCovet（怀璧其罪暴露/觊觎/抢夺，ADR-025；enabled 默认 false）
items/items.json ───────────► ItemRegistry（可转移物品定义，进 assetScore/战力/掉落，ADR-025）
behavior-trees/*.json ──────► NPCEntity/FactionEntity 行为树（GOBT，ADR-018；当前默认用代码内置同构常量）
balance/monster-spawn.json ─► 引擎 MonsterSpawner（妖兽分布生成）
definitions/monsters.json ──► 引擎 MonsterSpawner / MonsterEntity（妖兽实例）
config/game-config.json ────► 引擎 NPCState 构造函数 / TickManager
config/ai-config.json ──────► 引擎 FactionEntity / NPCEntity 构造函数
```

## 配置加载流程

```text
simulation-main.js (或 game-manager.js)
  ↓ fetch all JSON
WorldEngine.init(configs)
  ↓ 聚合 balanceConfig / gameConfig / aiConfig
  ├─ FactionEntity(config, { aiConfig: aiConfig.faction })
  ├─ NPCEntity(config, ranks, { gameConfig, cultivationConfig, aiConfig: aiConfig.npc })
  └─ TickManager({ balanceConfig, namesConfig, modifierTemplates, gameConfig, entityConfig })
       ↓ _buildWorldContext()
       worldContext.balanceConfig ──► 所有 ActionExecutor 可访问
       worldContext.modifierTemplates ──► ModifierSpawnExecutor
```

## 世界观数据来源

所有涉及世界观设定的数据（境界寿命、势力类型、修炼体系等），**必须优先参考 `docs/世界观参考/` 目录**。当前已收录的参考作品：

| 作品 | 文件 | 主要参考内容 |
|------|------|------------|
| 凡人修仙传 | `凡人修仙传_世界观设定.md` | 境界寿命、势力类型、修炼体系、天劫规则、灵气体系 |
| 遮天 | `遮天_世界观设定.md` | 星域结构、修炼体系、古路体系 |
| 完美世界 | `完美世界_世界观设定.md` | 修炼体系、种族设定 |
| 仙逆 | `仙逆_世界观设定.md` | 修炼体系、星域结构 |
| 一念永恒 | `一念永恒_世界观设定.md` | 五大区域、修炼体系 |
| 斗破苍穹 | `斗破苍穹_世界观设定.md` | 斗气体系、炼药师等级 |
| 牧神记 | `牧神记_世界观设定.md` | 修炼体系、神通体系 |
| 大道争锋 | `大道争锋_世界观设定.md` | 修炼体系、天道规则 |
| 阳神 | `阳神_世界观设定.md` | 修炼体系、神国设定 |
| 武破九荒 | `武破九荒_世界观设定.md` | 修炼体系 |
| 武逆乾坤 | `武逆乾坤_世界观设定.md` | 修炼体系 |
| 黎明之剑 | `黎明之剑_世界观设定.md` | 奇幻世界观、势力体系 |

如果某项设定在以上参考中**找不到对应内容**，需主动告知用户并协商确认，不可自行编造。
