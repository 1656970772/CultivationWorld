# 宗门运行与成员晋升制度

> 最后更新：2026-06-08
> 状态：已敲定
> 类型：规则
> 关联文档：`docs/decisions/adr-011-cultivation-incentive-system.md`、`docs/decisions/adr-015-faction-resource-and-promotion.md`、`docs/decisions/adr-057-sect-operation-and-unified-quest-board.md`、`docs/systems/sect-operation-system.md`、`docs/data-models/sect-operation.md`、`docs/worldbuilding/wiki/rules/leader-succession.md`、`docs/data/data-config-rules.md`

## 一句话定义

宗门按「资源层→制度层→动力层」三层六要素运行：以灵脉/任务/份例获取资源，以职位阶梯与晋升机制分配，以多通道竞争+安全网维持成员留存——形成「资源获取→分配→消耗→再获取」的闭环。本条目参考 `docs/世界观参考/宗门运行流程与制度平衡分析.md` 提炼的九部修仙小说通用模型落地。

## 运行架构约束

- 门派仍复用 `FactionEntity`，不新增独立门派实体。
- 宗门宏观资源继续由 `ResourceRegistry` + `FactionState` 管理；宗门实物库存只进入 faction inventory。
- 通用任务板位于 `apps/game/js/engine/quest/`，不属于门派专用模块。宗门任务、个人悬赏、悬赏阁任务、坊市委托和动态事件任务都应复用同一任务仓储、状态机、可见性策略和去重策略。
- 门派运行位于 `apps/game/js/engine/sect/`，只注册宗门任务来源、门派运行规则和悬赏结算策略，负责门派组织、宗门财政、个人悬赏、月俸库存压力、离宗和倒闭。
- 个人悬赏奖励使用统一经济托管，不进入宗门普通库存，不叠加普通任务模板奖励。
- 最新门派运行默认进入正式流程；缺少组织、初始化、运行数值或引用配置时由 strict validator 报错，不保留旧月俸 fallback。

## 已敲定内容

### 资源层（来源 + 分配）

- **资源来源**：领地灵脉/产业产出（`act_develop`、`economy.veinOutput`）、任务体系反哺（弟子交付任务的 `factionStones`）、贸易（`act_trade`）、攻伐掠夺（`attackEnemy`）。
- **资源真相源**：势力资源（`low_spirit_stone`/`disciples`/`food`）以 `state` 为单一真相源，行为的资源增减统一声明在 `faction-actions.json` 的 `effects`（详见 ADR-015）。
- **资源分配梯度（月俸制）**：门派运行月俸以 `sect-operation.json.stipends.roleStones` 为主路径，按 `monthlyIntervalDays=30` 结算：掌门 200 > 长老 80 > 继承人 60 > 将军/执事 50 > 核心弟子 20 > 内门弟子 5 > 外门弟子 2；未配置职位不发放。宗门灵石不足则按门派运行规则扣稳定度并积累欠薪压力。
- **竞争性奖励**：月度贡献前三名额外奖灵石（月俸 × [5,3,2]）；门派大比前五名梯度奖励（灵石 [5000,1500,800,400,200]、贡献 [50,20,10,5,2]）。

### 制度层（组织架构 + 晋升机制）

- **职位阶梯**（自低到高，数据化于 `cultivation.promotion.ladder`）：
  `外门弟子 outer_disciple → 内门弟子 disciple → 核心弟子 core_disciple → 执事 officer / 将军 general → 长老 elder → 继承人 heir → 掌门 leader`。
- **掌门（leader）**：不在普通晋升通道内，只能由继任产生（见 `leader-succession.md`）。
- **高阶职位名额限制**（`promotion.quotaByRole`）：执事 3、将军 2、长老 4、继承人 1。满额则该级不再接纳新晋升者，形成稀缺与竞争。核心弟子及以下不限名额。

### 动力层（多通道竞争 + 外部威胁/安全网）

宗门提供 **4 条上升通道**（多通道原则，避免单一评价体系）：

1. **贡献晋升（透明通道）**：每 90 天结算，弟子终身累计贡献达 `promotion.contributionByStep[目标职位]` 且境界 order ≥ `promotion.rankOrderByStep[目标职位]`，沿阶梯晋升一级（受名额限制）。同势力内按终身贡献降序择优。
2. **大比晋升（竞技通道）**：每 360 天门派大比，**按境界分组比试**（同境界弟子才放一起排名，避免高境界碾压、低境界无机会，符合天骄战/内院选拔的同辈较量设定）。每个境界组各取前 5 名梯度奖励，**组内第一名（同境之冠）**获得一次沿阶梯晋升的机会（弹性，不受名额限制）。**治理层（掌门/继承人/长老）不参赛**——大比意在激励中下层后辈上升，顶层已是核心、不下场挤占名额（配置于 `grandCompetition.exemptRoles`）。
3. **挑战上位（弹性通道）**：`act_npc_challenge` 行为，成功则沿阶梯晋升一级。
4. **继任（特批通道）**：掌门死亡时，从本门核心成员按优先级继任。

**顶层稀缺席位制（长老 elder / 继承人 heir）**：

- 这两层是宗门稀缺席位，名额按宗门规模在 `factions.json` 的 `roleQuota` 各自配置（大宗 elder 6、中宗 4、小宗 2；heir 恒为 1）。无配置时回退全局 `promotion.quotaByRole`。
- 晋入这两层（无论走贡献晋升、大比冠军还是挑战上位通道）统一遵守：
  - **有空缺**（现任人数 < 名额）：达标者**直接补位**，无需挑战。
  - **已满员**：必须**挑战现任**——引擎取实力最弱的现任者（按境界 `successionScore` 为主、`qi` 为次），若挑战者更强则**现任降一级**（退到挑战者原来的职位，你上我下），挑战者上位；否则晋升失败。
- 掌门 `leader` 不可挑战，只能由继任产生。

**安全网原则**：考核未达标的弟子被贬为外门弟子（`outer_disciple`），而非淘汰出宗门；外门弟子仍可通过上述通道重新晋升，避免「失败即出局」的人才恐慌。

**考核/淘汰节奏**：
- 月度贡献考核（每 30 天）：非治理层弟子当月贡献需达 `monthlyContribution.quotaByRank[境界]`，否则贬外门。治理层（掌门/长老/继承人）豁免。
- 门派考核（每 180 天）：年龄 ≥16 且境界低于炼气期（order 20）的非新晋弟子贬外门。

## 叙事表现

- 弟子日志会出现「晋升为内门弟子 / 核心弟子」「大比夺魁晋升」「挑战上位成功」「考核未达标贬为外门」「继任掌门」等事件（记录于 `sectEventLog`）。
- 宗门稳定度受月俸支付能力、攻伐、外部威胁影响；高稳定度宗门吸引更多弟子、可举办论道大会提升声望。

## 规则边界

- 晋升通道只作用于**有宗门归属**的具名 NPC（`factionId` 非空）。散修（`wanderer`）不参与职位晋升，走悬赏阁/坊市谋生。
- 抽象弟子数（`faction.disciples` 资源）与具名 NPC 成员是两套人口模型：前者用于宏观势力 AI（招募/攻伐/扩张），后者用于个体行为与晋升。二者暂未强绑定（待扩展）。
- 与 `leader-succession.md` 冲突时，掌门职位以继任规则为准（leader 不经普通晋升产生）。

## 数据与实现提示

- 门派组织配置：`apps/game/data/definitions/sect-organization.json`，由 `data-manifest.json` 输出为 `sectOrganization`。
- 门派初始化 profile：`apps/game/data/definitions/sect-seed-profiles.json`，由 `data-manifest.json` 输出为 `sectSeedProfiles`。其中 `resourceProfiles` 只定义宏观资源 profile，应用后仍交给 `ResourceRegistry.initialStateFrom()`；`inventoryProfiles` 与 `npcStarterKits` 只定义实物物品，所有 `itemId` 必须经 `itemDefs.items` 校验。
- 门派运行数值：`apps/game/data/balance/sect-operation.json`，由 `data-manifest.json` 输出为 `balanceSectOperation`，覆盖月俸、丹药俸禄、维护费、安全库存线、离宗阈值、任务板策略和个人悬赏手续费。
- strict 校验入口：`apps/game/js/core/game-data-validator.js`；`apps/game/tools/test-sect-config-load.mjs` 只验证 validator 覆盖，不维护第二套规则。
- 晋升体系配置：`apps/game/data/balance/cultivation.json` 的 `promotion` 段（ladder/roleRankByStep/contributionByStep/rankOrderByStep/quotaByRole）。
- 考核与大比配置：同文件 `monthlyContribution` 与 `sectEvents` 段。
- 月俸梯度：`apps/game/data/balance/sect-operation.json` 的 `stipends.roleStones`，结算周期来自 `monthlyIntervalDays`；旧经济薪酬段不作为新门派运行主路径。
- 实现：`apps/game/js/engine/world/tick-manager.js` 的 `_processMonthlyContribution` / `_processSectEvents` / `_processPromotions` / `_promoteRole`；挑战上位见 `npc-actions.js` 的 `NPCChallengeExecutor`。
- 势力行为与资源结算：`apps/game/data/actions/faction-actions.json` + `apps/game/js/engine/faction/faction-actions.js`（资源单一真相源约定见文件头注释与 ADR-015）。

## 待扩展

- 抽象弟子数与具名 NPC 成员池的统一（招募时生成具名外门弟子、人口上限联动）。
- 派系博弈（长老分派系，影响晋升与资源分配的扭曲）。
- 外部威胁节奏对内部凝聚力的显式建模（战争期间暂缓内部考核/提升凝聚力）。
- 学院制 / 国家体制等非传统宗门模板（参考资料模板 B/C）。

## 来源

- 项目文档：`docs/世界观参考/宗门运行流程与制度平衡分析.md`（九部修仙小说宗门制度综合分析，三层六要素框架）。
- 项目文档：`docs/decisions/adr-011-cultivation-incentive-system.md`（任务-贡献-修炼场经济链）。
- 用户确认：参考宗门运行资料优化宗门与成员制度，符合现有项目规则与规范（数据驱动、开闭原则、单一职责）。
