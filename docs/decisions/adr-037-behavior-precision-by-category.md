# ADR-037：逐类行为精准化（按类别画像驱动的四项行为修复）

最后更新：2026-06-02

状态：已实现（妖兽分化 + 散修生计 + 关系/师徒激活 + 复仇追击；流派执念复核达标；妖族 demon 已诊断归独立立项）

## 背景

长周期模拟中，"每类 NPC/妖兽行为太统一、来来回回就那几个、不像真实修仙世界"是反复出现的体感问题。
此前 `simulate-analysis.mjs` 只输出**全局聚合**统计（总攻伐/总死亡/行为排行），无法回答"**哪一类**人没做它该做的事"。

为系统化定位，先给模拟器加**按类别行为画像**（NPC 按 职位/境界/势力类型/主执念，妖兽按 阶/族/类型 分桶统计行为分布），
再逐批（1-3 类）对照 `docs/世界观参考/` 找出"行为不符 / 关键行为缺失"，最小改动后重跑验证（遵循 ADR-033 闭环）。

画像一上线就暴露多处病症：妖兽 96% 纯游荡、散修/妖族修炼占比畸高、整套关系/师徒互动 700 天 0 触发、复仇追而不杀。

## 决策

按"一轮撬 1-3 个杠杆、区分参数/结构问题"的纪律（ADR-033），本轮完成四项修复 + 一项复核 + 一项诊断立项。

### 一、妖兽行为分化（结构问题）

`monsterWander` / `monsterPatrolTerritory` 原把 96% 时间归为单一"游荡"。改为按 tier 数据驱动分化出
**觅食(forage) / 归巢栖息(lair) / 领地巡逻(patrol) / 群居聚拢(pack cohesion)** 等本能行为；
参数（`lairChance`/`forageChance`/`packCohesion`/`lairRestDays`）配置在 `monster-spawn.json` 的 `behaviorByTier`。
体现参考文档里"妖兽极强领地意识、栖息巢穴、高阶守护资源"的设定。

### 二、散修生计需求（结构问题）

散修（`isWanderer`）所有"产出型需求"都依赖宗门（职责/猎妖/上交/兑丹/兑器），无门派则全不触发，只剩修炼。
新增 `need_npc_wanderer_subsistence`（仅 `isWanderer` 触发，goalState=`questTurnedIn`），驱动散修赴坊市悬赏接活求生，
契合"散修求生型：外出闯荡"的设定。同时修复 `npc-entity._initNeeds` 的**硬编码 needIds 白名单**（新需求不在列表则永不加载）。

### 三、关系/师徒互动激活（结构问题，本轮最隐蔽）

ADR-028/029 的驰援/报恩/传功/护徒/探望整套行为 700 天 **0 触发**。逐层诊断（系统已注入 ✓、边存在 ✓、Goal 已产出 ✓、GOAP 可规划 ✓）后定位到**两个叠加根因**：

- **`plan()` 命中即返回**：`behavior-system.plan()` 按 score 降序遍历，第一个能规划成功的 Goal 即 return。修炼/任务 score 高且必成功 → 关系 Goal 即使进候选也永远排其后、轮不到。
- **consideration 乘法压垮 priority（致命）**：全激活态 `utility.json enabled=true` 下，`score = (priority+Σdelta) × Π(mult) × Π(consideration)`。关系 Goal 的 consideration 基线过低（如传功 base 0.4），把 **priority 78 的 score 压到 25**，而修炼 `bottleneck`(inverse 曲线) 在低进度时≈1.0 保持高位。

修复：①把关系/师徒 Goal 的 `priority` 提到**高于日常修炼/任务(60-70)**区间（产出本身受低频概率门控，高 priority 不会霸占行为）；②把 `utility.json` 中这些 Goal 的 consideration **基线提到 0.85-0.92、slope 大幅降低**（消除乘法压制，保留极轻微梯度）；③放宽/提频（传功 `discipleMaxTotalProgress` 0.6→0.95、`teachChancePerTick`/`visitChancePerTick` 翻倍）。

### 四、复仇追击破局（结构问题）

复仇者追踪触发多但击杀≈0（"追而不杀"）。精确计数发现 hunt 绝大多数卡在 traveling、极少结算。
根因是 `movement.json` 中 **NPC 速度统一 1 格/天**——追击者与仇人同速，追"仇人旧坐标"、仇人又移走，几乎永远差一步（**同速追逐困局**）。

修复：①`_refreshRevengeState` 中复仇/夺舍执念在身时给追击者**提速**（`revengePursuitSpeed=2`，仇人失联即恢复），体现"穷追不舍、千里追杀"；②`act_npc_kill_enemy` 由 `requiresTravel:false/self` 改为 `true/revenge_target`，击杀阶段持续移动到仇人**当前**坐标发动攻击，而非在 hunt 锁定的旧坐标扑空。

### 五、流派执念复核（已达标，不改）

复核（批四修复后）显示各流派特征已鲜明：power 夺权挑战上位、longevity 逐机缘求长生、revenge 追踪仇人、resurrection 找复活素材、supremacy 修炼证道。无需结构改动；`obsession.json goalMult.enabled` 保持关闭（启用反而放大 supremacy 修炼单一化）。

### 六、妖族 demon（诊断未改，归独立立项）

demon 势力 NPC 修炼 89-95%，根因是**妖族经济死循环**：`breakthrough_aid` 依赖势力库存（由 NPC 猎妖上交累积），demon 猎妖/上交需求低频不触发 → 库存空 → 援助永不触发 → 只能修炼。正确修复是给妖族补**符合世界观的"妖修掠夺/吞噬"产出体系**（类比散修生计但非人类经济），属较大新增，本轮不撬，列为独立立项。

## 设计模式映射

- **数据驱动 + 开闭原则**：妖兽分化参数、散修需求、关系 priority/consideration、复仇提速系数全部配置化（monster-spawn / npc-needs / relationship / utility / movement），调参不改核心代码。
- **单一职责 / 策略**：行为分化在 `monster-entity` 策略方法内分流；新增需求即新增策略，不改选目标主流程。
- **诊断先于修复**：每项病症先用临时计数/对比脚本逐层定位根因（区分"参数问题 vs 结构问题"），再最小改动。

## 数据与接口

- `js/engine/monster/monster-entity.js`：`monsterWander`/`monsterPatrolTerritory` 分化 + `_findNearbySameSpecies`。
- `data/balance/monster-spawn.json`：`behaviorByTier` 新增 `lairChance/lairRestDays/forageChance/packCohesion`。
- `data/needs/npc-needs.json`：新增 `need_npc_wanderer_subsistence`；`js/engine/npc/npc-entity.js` `_initNeeds` 默认 needIds 补该需求。
- `data/balance/relationship.json`：关系/师徒 Goal priority 提到 72-88 区间；放宽距离/提频。
- `data/balance/utility.json`：关系/师徒 Goal 的 consideration 基线 0.85-0.92。
- `js/engine/npc/npc-entity.js` `_refreshRevengeState`：复仇追击提速（`revengePursuitSpeed`，默认 2，记 `_baseSpeed` 还原）。
- `data/actions/npc-actions.json` `act_npc_kill_enemy`：`requiresTravel` true + `targetResolver` revenge_target。
- 工具：`simulate-analysis.mjs` 新增 NPC/妖兽按类别行为画像；新增 `tools/verify-revenge-pursuit.mjs` 端到端验证。
- 不改任何对外 API 签名。

## 后果

- 妖兽行为种类 3 → **5-6**，按阶位呈"越高阶越守巢"的合理梯度。
- 散修出现完整"接活→执行→交付"求生链，修炼占比 87.5% → ~71%。
- 师徒传功 0 → **14**、探望恩师 0 → **82**（500 天全激活态），师傅角色画像出现"点化徒弟"。
- 复仇者能从 75 格外**追上并手刃仇人**（端到端确定性验证），破解同速追逐困局。
- 流派执念各类特征鲜明（基线 supremacy 99% 病态单一 → 现 66% 且多元）。
- 全程数据驱动可回退。

## 验证

- GOAP 旧摘要回归 `5740e12a` **全程默认关闭不改变既有行为**（摘要用 utility.enabled=false 基线，priority/consideration 改动不影响）。
- 单元/端到端测试全绿：goal-equivalence / master-disciple / relationship-goals / relationship / revenge / monster-resource-loop / **verify-revenge-pursuit** / obsession。
- 500 天全激活态 KPI 健康：存活 NPC 123、出生 51、攻伐 1455、道侣对 40。
- 详见 `ADR-037`（含每批完整诊断过程与数据）。

## 未解问题

- **妖族 demon**（批 F）：需"妖修掠夺/吞噬"专属产出体系，独立立项。
- **结仇事件源频率**：某些局势 enemy 边=0、无人结仇 → 无复仇者；复仇**总量**受势力攻战/夺宝冲突频率制约（本 ADR 只根治"有仇追不上"，频率是另一维度）。
- 驰援同门/护徒/报恩仍低频：依赖"同门/徒弟正陷战"或"恩义边"前置，当前世界 PvP/恩义事件少——机制已通，触发前置罕见，待"冲突频率"侧改善。

## 工程教训

**全激活态下，高 priority ≠ 高 score**——`score = (priority+Σdelta) × Π(mult) × Π(consideration)`，consideration ∈[0,1] 会乘法压低。批三的关系 Goal 卡死整整查了一长链才定位到此。今后新增任何"应当能插队"的 Goal，必须同步检查 `utility.json` 里它的 consideration 基线，否则 priority 形同虚设。

## 相关

- ADR-033（自迭代优化流程）+ `docs/balance/simulation-iteration-process.md` —— 本轮遵循的诊断/调参/验证闭环与归因决策树。
- ADR-020（Consideration Utility 与复仇链）—— 复仇 hunt/kill 链与 consideration 乘法机制的源头。
- ADR-023（流派执念体系）—— 批五复核的对象。
- ADR-028（关系驱动决策）/ ADR-029（师徒互动）—— 批三激活的整套行为的定义来源。
- ADR-026（妖兽资源化）—— 批一妖兽行为、批六妖族经济死循环的相关闭环。

