# ADR-024：信息传播与机会点系统

最后更新：2026-05-30

## 背景

此前世界存在一个根本问题：**事件 ≠ 信息**。世界发生的大事（妖王陨落、秘境开启、宗门大战）要么被 NPC 机制全知（势力关系），要么走到机构即知（任务）。没有"谁、何时、以多高可信度知道某事"的概念，导致：

- NPC 无法因"听闻某地有机缘"而主动远赴该地。
- 不会出现"群体涌向同一热点"的江湖涌现现象。
- 游历/夺宝只是 `wander_far` 随机点，秘境只是无坐标的全局 buff，NPC 不会"奔向同一处"。

参考凡人修仙传等原著：消息以口耳相传、坊市传闻、宗门情报网扩散，强者因得知机缘而出动，信息不对称本身就是修仙江湖的核心张力。

## 决策

引入完整闭环：**世界事件 → WorldNews（消息）→ 多渠道传播 → NPC 知晓 → 关联 WorldOpportunity（机会点）→ Utility 评估收益-风险 → 生成 Goal → GOAP 规划 → 前往结算**。

### 两个核心实体

| 实体 | 含义 | 文件 |
|------|------|------|
| `WorldNews` | 关于某事件的"消息"，有来源坐标、重要性、可信度、传播半径，会衰减/过期 | `js/engine/world/info-propagation.js` |
| `WorldOpportunity` | 由事件派生的"机会点"，有坐标/价值/过期/参与上限，统一所有"值得前往"的目标 | `js/engine/world/opportunity.js` |

**关键设计：NPC 不直接响应事件，而是响应机会点。** 多个 NPC 知晓同一消息 → 关联同一机会点 → 涌向同一坐标，产生热点涌现；机会点的 `maxClaims`/`expireDay` 避免无限聚集。

### 枚举（遵循"枚举而非字符串"项目规则）

- `NewsType`：tribulation / monster_king_death / secret_realm_open / auction / faction_war / treasure_born / wealth_exposed（见 `core/constants.js`）。
- `OpportunityType`：treasure / auction / war / recruitment / inheritance / monster_corpse / secret_realm / wealth_target。

### 五种传播渠道（数据驱动开关，`data/world/news.json` channels）

| 渠道 | 机制 | 实现 |
|------|------|------|
| 天地异象（radius） | 高 importance 事件大半径直接传播，每天 `spreadRadius += spreadSpeed` 覆盖到 NPC 即知晓 | `InfoPropagationSystem.tick` |
| 口耳相传（oral） | 相遇（曼哈顿距离 < meetDistance）的 NPC 互传消息，转述使可信度衰减 | `exchangeNews` |
| 城镇广播（town） | 进入有坊市/酒馆的机构 HQ 时获得近期热门消息 | `broadcastTownNews` |
| 宗门情报网（sect） | 同 factionId 成员按周期同步已知消息（长老知→弟子知），高可信度 | `syncSectNews` |
| 商会情报网（guild） | 商会/王朝类机构成员跨地点共享，体现大组织信息优势 | `syncGuildNews` |

### 决策层（复用 ADR-022 期望收益 / risk.json）

NPC 选目标阶段（`collectExtraGoals`）遍历 `knownNews` → 查关联 `WorldOpportunity` → 按 `value × reliability × winFactor − 路程折损` 打分（`_bestOpportunityFor`）→ 高于 `minScore` 则生成 `GoalSource.OPPORTUNITY` 的 Goal → 新行为 `act_npc_goto_opportunity`（`targetResolver: nearest_opportunity`）→ 到达后 `NPCGotoOpportunityExecutor` 按 `rewardSource`/`riskKey` 结算，产出真实物品（见 ADR-025）。

可信度门槛：`reliability < personality.beliefThreshold`（默认 `news.json defaultBeliefThreshold`）的消息被忽略。

## 默认关闭不改变既有行为保证

- `news.json` / `opportunities.json` 默认 `enabled: false`，禁用态下不产生任何新闻/机会/事件，`tickLog.infoEvents` 仅含既有战报。
- 新增行为 `act_npc_goto_opportunity` 仅在机会系统启用且 NPC 知晓可行机会时，`collectExtraGoals` 才产出对应 Goal，故不改变既有规划。
- 验证：`test-goal-equivalence`（400 用例主路径默认关闭不改变既有行为）通过；`test-info-propagation` 第 6 项确认禁用态零信息事件；激活态（`INFO_ACTIVE=1`）下 `simulate-analysis` 观测到 news_spread / wealth_exposed / opportunity_expired 等涌现事件。

## 关联

- 数据模型：`docs/data-models/info-propagation.md`（已落地为运行时系统）。
- 感知设计：`docs/systems/info-sense.md`。
- 系统文档：`docs/systems/opportunity-system.md`。
- 实物与怀璧其罪：ADR-025。

