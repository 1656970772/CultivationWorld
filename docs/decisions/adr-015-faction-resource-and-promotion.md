# ADR-015：宗门资源真相源统一与成员晋升体系

> 日期：2026-05-30
> 状态：已接受 · 已实现并验证（720 天无头模拟：晋升/继任/考核事件正常触发、无报错、性能无回退）
> 关联：`docs/decisions/adr-011-cultivation-incentive-system.md`（任务-贡献-修炼场经济链）、`docs/worldbuilding/wiki/rules/sect-operation.md`、`docs/worldbuilding/wiki/rules/leader-succession.md`、`docs/世界观参考/宗门运行流程与制度平衡分析.md`

## 背景

参考《宗门运行流程与制度平衡分析》（九部修仙小说综合）提炼的「三层六要素」框架（资源层/制度层/动力层），审视现有宗门与成员实现，发现三个结构性问题：

1. **资源双轨 bug**：`FactionEntity` 的 tick 流程为 `onPreTick(inventory→state) → execute(costs/yields 改 inventory，effects 改 state) → onPostTick(state→inventory 覆盖)`。结果 `costs/yields/executor` 对 inventory 的修改被 `onPostTick` 用 state 覆盖而**全部丢失**，势力实际只按 JSON `effects` 结算资源；`attackEnemy/trade` 的跨实体掠夺/交换写 inventory 同样丢失。
2. **晋升体系不完整**：职位阶梯只打通到 `core_disciple`（大比冠军 `outer→disciple→core` 封顶），`officer/general/elder/heir` 无正式晋升路径；`act_npc_challenge` 仅涨孤立数字 `roleRank`，不改 `currentRole`。
3. **继任与 Wiki 不一致**：`leader-succession.md` 规定同职位内按 `successionScore`→`loyalty`→`id` 排序，代码却只比 `roleRank`；且 Wiki 引用了不存在的 `behaviors/succession.json`。

## 决策

### 一、资源单一真相源（state）

势力资源（`low_spirit_stone`/`disciples`/`food`）**统一以 `state` 为单一真相源**：

- 资源的消耗与产出全部声明在 `faction-actions.json` 的 `effects`（走 state）；`costs`/`yields`（走 inventory）不再用于这三种资源。
- executor 只负责 effects 无法表达的逻辑：跨实体作用（贸易/结盟/论道）、世界调用（扩张/攻伐）、对本门 NPC 的批量影响（开放秘境）、非资源派生状态。executor 改资源时一律写 `entity.state`。
- `attackEnemy`/`FactionTradeExecutor` 改为读写 state（含对方 state），战果不再丢失。
- `onPostTick` 钳制资源下限为 0，防止负向 add（消耗）压到负数。
- 每个资源键在一次行为内只被改一次（避免双计）；攻伐的兵力/灵石损耗由 `attackEnemy` 按战力比动态结算，故从 `act_attack.effects` 移除 disciples/stone/stability，仅留 `enemyCount-1` 与出征粮草。

### 二、全职位晋升阶梯（数据驱动 + 多通道 + 安全网）

新增 `cultivation.json → promotion` 段，定义完整阶梯 `outer_disciple→disciple→core_disciple→officer→general→elder→heir`、各级 `roleRank`、贡献门槛、境界门槛、高阶名额上限。提供 4 条上升通道：

1. **贡献晋升**（`_processPromotions`，每 90 天）：终身贡献 + 境界达标，沿阶梯升一级，受名额限制，同门按贡献择优。
2. **大比晋升**（每 360 天，按境界分组比试——同境界弟子单独排名、各组取前 5 名梯度奖励、组内第一名沿阶梯晋升一级，弹性不受名额限制；可 `byRank=false` 回退全门派混排）。
3. **挑战上位**（`NPCChallengeExecutor` 经 worldContext `promoteByLadder` 沿阶梯晋升）。
4. **继任**（掌门由继任产生，不走普通通道）。

**安全网**：考核未达标贬为外门弟子而非淘汰，仍可重新晋升，避免人才恐慌（参考资料『安全网原则』）。`_promoteRole` 重写为全阶梯数据驱动，带名额检查与 `isElder` 同步。

### 二·补充、顶层稀缺席位与挑战上位制

长老 `elder`、继承人 `heir` 为宗门稀缺顶层席位，名额按宗门规模在 `factions.json → roleQuota` 各自配置（大宗 elder 6 / 中宗 4 / 小宗 2；heir 恒 1），无配置回退全局 `promotion.quotaByRole`。晋入这两层（贡献晋升 / 大比冠军 / 挑战上位三通道统一）遵守：**有空缺直接补位；满员则挑战现任**——引擎取最弱现任（`successionScore` 为主、`qi` 为次），挑战者更强则现任降一级（退到挑战者原职位，你上我下），否则失败。掌门 `leader` 不可挑战，只能继任。逻辑集中于 `TickManager._promoteRole`，挑战行为经 worldContext `promoteByLadder` 调用，避免重复实现。

### 二·补充·二、性格系统驱动挑战上位

为给"挑战上位"提供内在动机，引入**数据驱动的性格系统**（`data/balance/personality.json`，详见 wiki/rules/personality.md）：

- 性格维度 `ambition/caution/loyalty/diplomacy`（0-100，存于 `staticData.personality`）通过 `needBoosts` 表换算为对需求优先级的加成；`ConfigurableEvaluator._personalityBoost` 在评估时施加。性格存于 state 专用字段、**不进 GOAP 状态键**（golden 指纹不变）。
- 新增需求 `need_npc_ambition`（晋升）：野心越高优先级越高，并在**本境修为饱和（cultivationProgress ≥ 0.85）**时进一步抬升，从而压过修炼需求，触发 `act_npc_challenge` → `promoteByLadder`。体现"先修为、后争位"。
- 探针验证：野心 92、修为 0.9 的弟子规划结果即为"挑战上位"，机制打通。

> 已知调参点（结构与动机均已就绪、但受全局修炼进度制约）：实跑中绝大多数弟子修为长期 < 0.3（受月度考核频繁抽贡献、修炼速度偏慢影响），鲜有人达到"修为饱和"门槛，故顶层席位实际流动仍少。这属于**全局修炼节奏/月度考核强度**的平衡问题（影响整个世界演化），需单独定夺：可下调高阶贡献门槛、放宽月度考核、提高修炼速度，或下调野心触发的修为门槛。结构层面已完整、可随调随生效。

### 三、继任排序对齐 Wiki

`_triggerSuccession` 改为：优先级来自 `social.json → succession.rolePriority`（数据驱动）；同职位内按 `ranks.json.successionScore`（按 NPC `rankId` 查，缺省回退 `order`）→ `personality.loyalty` → `id` 字典序排序。`social.json → roles.rankMap` 补 `outer_disciple/wanderer`。

## 影响

- 资源模拟正确性修复（攻伐掠夺、贸易、各行为消耗不再被覆盖丢失）。
- 成员有了清晰、透明、多通道、有安全网的上升路径，职位分布在长期模拟中动态演化（720 天验证：promotion 58 次、grand_competition 130 次、月度考核正常）。
- 继任结果稳定可复现且符合 Wiki。
- 性能无回退（400 天平均 56.93ms/天，与 ADR-014 优化后持平甚至更好）。

## 备选与取舍

- **资源真相源选 inventory 还是 state**：选 state，因为 GOAP 行为 `effects` 天然写 state，且派生状态（stability/relations 等）已在 state，统一后语义最简单。
- **晋升门槛/名额数值**：给出符合参考资料梯度的合理默认值，全部数据化便于后续调参（用户将于复盘后微调）。
- **抽象弟子数 vs 具名 NPC 两套人口模型**：本次不强行统一（风险大、超出范围），列入 `sect-operation.md` 待扩展。

## 待扩展

- 抽象弟子数与具名成员池统一（招募生成具名外门弟子）。
- 派系博弈、外部威胁节奏对凝聚力的显式建模。
- 学院制/国家体制等非传统宗门模板。
