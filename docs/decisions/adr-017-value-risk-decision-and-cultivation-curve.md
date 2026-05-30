# ADR-017: 价值-风险决策系统 + 修炼曲线改造

> 日期：2026-05-30
> 状态：已采纳

## 背景

ADR-016 让游历由 GOAP 自然涌现，但 NPC 的行为选择仍只看「基础消耗」(`weight + duration-1`)，
无法表达「这件事值不值得做」「这件事有多危险」。同时修炼曲线是「闭关撞 cap 即停」的硬墙，
缺少边际递减的真实感，也没有约束「闭关进度至少占多少」，存在纯靠游历感悟速成突破的漏洞。

用户诉求：
1. 决策应分层：先比基础消耗，再比「风险 vs 价值」。
2. 引入概率性「上头」：很小概率下给某行为价值注入一个很大的加成，使 NPC 冲动行事，并打标记。
3. 给每个行为/道具标记「价值」（数据驱动）。
4. 新增「正义感」性格维度（本期仅字段+赋值+遗传，不接逻辑）。
5. 修炼曲线：闭关边际递减但可缓慢到顶；闭关进度至少占 30%；游历/闭关先后顺序随机。

## 决策

### 1. 价值-风险决策模型（GOAP cost 改造）

把单步 step cost 从「基础消耗」升级为分层加权：

```
decisionCost = 基础消耗(weight + duration-1)
             + λ_risk × 期望风险损失(行为, 实体)
             − λ_value × 行为价值(行为基础价值 [+ 预期道具价值, 预留])
最终 cost = max(costFloor, decisionCost)   // 防负、防 A* 退化
```

- **期望风险损失**：复用 `risk.json` 分项与性格加成，用**期望值** `Σ(chance × severity)`（不 roll），
  与 `settleRisk` 同一套触发概率公式。`severity` 按 effect 类型给权重（death 最高）。见 `estimateRiskCost`。
- **行为价值**：`action.valueScore`（数据驱动，见 `npc-actions.json`）+（命中上头时）`headstrongValueBonus`。
  道具期望价值预留（`resources.json` 已加 `value` 字段，待道具产出系统落地后在 `computeActionValue` 接入）。
- 系数集中在 `ai-config.json` 的 `npc.decision` 块：`lambdaRisk`/`lambdaValue`/`headstrongChance`/`headstrongValueBonus`/`costFloor`。

### 2. 「上头」机制（概率性冲动 + 标记）

每次大决策**开始时**，对每个可用行为按 `headstrongChance`（很小，默认 0.03）roll 一次；
命中则该行为在本次 `computeActionValue` 中额外注入 `headstrongValueBonus`（很大），使其在 cost 比较中胜出，
模拟「上头」。规划完成后，若最终计划的**首个行为**命中上头，则在 state 打标记：
`lastDecisionHeadstrong = true` + `headstrongActionId = <id>`；否则置 false/null。

### 3. A* step cost 稳定性约束（关键）

A* 要求 step cost 在**单次规划内稳定**。因此：

- 「上头 roll」与「风险/价值评估」必须在 `NPCEntity._planBehavior` 进入规划**之前**一次性算好，
  构建一份固定的 `costMap`（行为 id → cost）与 per-decision 上下文，规划全程读同一份，
  **绝不在 A* 每次扩展节点时重新 roll**。见 `_buildDecisionCostFn`。
- `GOAPPlanner.plan()` 新增可选 `costFn(action)` 入参；**慢路径** `stepCost` 与**快路径** `_compileFast` 的 `cost`
  均改为优先用 `costFn(action)`（当次固定），无 `costFn` 时回退 `getPlanCost()`（保证既有调用方/golden test 不变）。
  快路径仍在编译期固化 cost，故定长值数组优化保留。
- 贪心回退 `_tryGreedyFallback` 改用同一 `costFn` 排序，与规划器一致。

### 4. 正义感性格维度（仅字段+赋值+遗传）

- `personality.json`：`traits` 增加 `justice`（正义感，default 50），`needBoosts.justice: []` 占位。
- 出生遗传：`tick-manager.js _processBirths` 中 `courage`/`justice` 走通用「双亲均值 + 变异」遗传
  （`child = clamp(0~100, 父母均值 ± personalityMutationRange)`，父母缺该维度回退 50）。
- 本期**不接决策逻辑**，后续接入行侠/除魔/护道等行为。

### 5. 修炼曲线改造

- **闭关边际递减但可到顶**（`NPCCultivateExecutor`）：
  `有效增量 = 基础增量 × e^(-k × current/cap)`，`k = cultivation.json.cultivationDecayK`（默认 2.5）。
  越接近 cap 增量越小但永不为 0，故能缓慢逼近/到顶；仍夹 cap 防溢出。道侣双修额外进度同样走衰减。
- **闭关至少占 30%**：`minCultivationRatio`（默认 0.3）入 `cultivation.json`。
  - `NPCExploreExecutor` 的 insight 累加封顶 `1 - minCultivationRatio`（默认最多 70%）。
  - `_tryBreakthrough` 增加 `cultivationProgress >= minCultivationRatio` 兜底，确保闭关根基达标才突破。
- **cap 前置阈值**：闭关行为前置改为 `cultivationProgress < cap × 0.999`，
  因边际递减后实际很难精确到 cap，避免规划层永久允许闭关却几乎不前进。

### 6. 游历/闭关顺序随机

- 每进入新境界（构造/突破成功）roll `breakthroughPathOrder ∈ {cultivate_first, explore_first}` 写入 state。
- `explore_first` 时：`computeDecisionCost` 给游历的基础消耗乘 `exploreFirstCostFactor`(<1) 降 cost，
  让 A* 先选游历；`cultivate_first` 为默认（不调整）。
- 因「相加制」下先游历或先闭关最终都能到 `totalProgress >= 1.0`，顺序只影响路径不影响可达性。

## 代码位置

- 配置：`data/config/ai-config.json`(npc.decision)、`data/balance/cultivation.json`(cultivationDecayK/minCultivationRatio)、
  `data/balance/personality.json`(justice)、`data/balance/social.json`(personalityMutationRange)、
  `data/actions/npc-actions.json`(valueScore/riskKey)、`data/definitions/resources.json`(value 预留)。
- 决策计算：`js/engine/npc/npc-actions.js`（`estimateRiskCost`/`computeActionValue`/`computeDecisionCost`、修炼衰减、insight 封顶）。
- 行为基类：`js/engine/abstract/action.js`（`valueScore`/`riskKey`/`getBaseCost`）。
- 规划器：`js/engine/abstract/goap-planner.js`（`plan(costFn)`，慢/快路径用 costFn）。
- 行为系统：`js/engine/abstract/behavior-system.js`（透传 costFn，贪心回退按 costFn 排序）。
- 实体：`js/engine/npc/npc-entity.js`（`_buildDecisionCostFn`/`_markHeadstrongFromPlan`/`_rollBreakthroughPathOrder`、
  cap 前置阈值、突破最低闭关比例）。
- 状态：`js/engine/npc/npc-state.js`（`lastDecisionHeadstrong`/`headstrongActionId`/`breakthroughPathOrder`）。
- 遗传：`js/engine/world/tick-manager.js`（courage/justice 双亲均值+变异遗传）。

## 后果

- 正面：决策可表达「值不值/危不危险」，行为更像人；系数全数据驱动可调。
- 正面：「上头」给世界增添偶发的冲动/意外，且可被标记观测。
- 正面：修炼曲线更真实（边际递减），闭关/游历有最低占比与顺序随机，路径更多样。
- 影响：state 新增 3 个字段，进入 GOAP 状态键，但不被任何 goal/precondition 引用，仅增加状态向量长度。

## 验证（2026-05-30）

- `node tools/test-goap-golden.mjs` 指纹 **`989688d2`**：因 `costFn` 为可选、默认仍走 `getPlanCost()`，
  该测试不传 costFn，故规划逻辑零漂移、指纹与改造前一致（确认 GOAP 默认路径无回归）。价值-风险仅在 NPC 实际决策时经 `_planBehavior` 传入 costFn 生效。
- `node tools/simulate-analysis.mjs 500`：500 天长程模拟无崩溃（~32s）。
- 一次性校验脚本 16 项全过：风险期望值（境界减免↓、勇敢↑）、上头价值注入、`computeDecisionCost`（上头/explore_first 降 cost）、
  闭关指数衰减可累加到顶、insight 封顶 `1-minCultivationRatio`。
- 全部改动 JS `ReadLints` 无错；所有改动 JSON 解析通过。

## 待扩展

- 道具期望价值接入 `computeActionValue`（待道具产出系统）。
- 正义感接入决策（行侠/除魔/护道），以及更多性格维度对风险/价值的加成。
- λ/k/severity/headstrong 参数按长程模拟结果调参；可加上头计数器/日志。
