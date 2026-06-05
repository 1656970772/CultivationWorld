# ADR-014：GOAP 规划性能优化（定长值数组快路径）

> 日期：2026-05-30
> 状态：已接受 · 已实现并验证（旧摘要回归回归 + 无头基准）
> 关联：`docs/decisions/adr-005-need-driven-goap-architecture.md`（GOAP 架构）、`docs/decisions/adr-013-jps-hierarchical-pathfinding.md`（寻路优化）

## 背景

寻路优化（ADR-013）完成后，CPU profiling 显示 GOAP 规划成为绝对主瓶颈：`plan`(43.6%) + `_stateKey`(12.9%) + `_applyActionForward`(10.4%) + `_actionApplicable`(4.4%) + `getEffects`(4.2%) + 其余，合计约 **80%**。单天模拟约 268.79ms，无法支撑"模拟 300 年"。

根因：GOAP 用 A* 在状态空间反向/正向搜索，状态以 plain object 表示。每扩展一个搜索节点都要：① `{...state}` 浅拷贝整个状态对象；② `Object.entries(goalState)` / `Object.entries(action.effects)` 反复创建临时数组；③ `getEffects()` 每次重建对象；④ `_stateKey` 把全部"键名:值"拼成字符串。80 天约 3888 次规划、61 万次迭代，上述每节点开销被急剧放大。

## 决策

在**不改变任何规划结果**（行为默认关闭不改变既有行为）前提下，分三轮做纯性能优化：

1. **静态数据预计算（Action）**：`effects`/`preconditions` 在 Action 构造后不可变。构造时一次性规范化并缓存 `_effectsNorm`、`_effectEntries`、`_preconditionEntries`、`_planCost`。`getEffects()` 直接返回缓存对象，新增 `getEffectEntries()`/`getPreconditionEntries()` 供热路径以数组下标遍历，消除每节点的 `Object.entries` 与对象重建。

2. **一次规划内的不变量预存（Planner）**：`goalState` 在一次 `plan()` 内不变，预存 `_goalEntries`（带 `_goalEntriesFor` 身份校验，外部直接调用时安全回退）。`_stateKey` 改为仅按固定键顺序拼接**值**（键顺序在本次规划内固定，无需写键名）。

3. **定长值数组快路径 + parent 链回溯（核心）**：`plan()` 入口将状态编译为"定长值数组"——所有 currentState/goal/action 引用到的键取**并集**映射到固定下标（缺失键初值 `undefined`，与慢路径 `state[key]===undefined` 语义一致，故无需因"新键"回退）。搜索过程中：
   - 状态拷贝 `{...state}` → `vals.slice()`（数组切片远快于对象展开）；
   - `_stateKey` 拼全部"键:值" → `_valsKey` 仅拼值；
   - effect/precondition/goal 编译为 `{idx, op, value}` 下标化操作，匹配/距离/应用全部按下标访问；
   - 节点不再每个拷贝 `actions` 数组，改存 `parent` + `action`，成功时回溯重建（消除每节点 O(depth) 的数组复制）；
   - 每节点 stateKey 生成一次后缓存在 `node.key`，pop 时复用（原先 pop 与 push 各算一次，减半）。
   仅当存在无法编译的情形才回退原 plain-object 慢路径（实测真实数据回退率 **0%**）。

## 验证

- **正确性（行为默认关闭不改变既有行为）**：新增 `tools/test-goal-equivalence.mjs`，用真实行为数据 + 600 个确定性场景（NPC/Faction，覆盖修炼/疗伤/贡献/资源/成员/领地等目标）对 `plan()` 输出（成功标志 + cost + 行为 id 序列）做 FNV 摘要。基线摘要 `f08c3248`，三轮优化后逐轮重跑**均保持一致**。
- **快路径覆盖**：插桩实测 80 天 3988 次规划中，编译回退慢路径 **0 次**；真正需要搜索的规划 **100%** 走数组快路径（其余为目标已满足、顶层秒返回）。
- **性能（无头基准，80 天，151 NPC + 18 势力 + 400 妖兽，300×300）**：

| 阶段 | ms/天 | 相对基线 |
|------|-------|----------|
| 优化前（ADR-013 后） | 268.79 | — |
| 第一轮（缓存 + 预存 entries + stateKey 只拼值） | 170.32 | -37% |
| 第二轮（定长值数组快路径 + parent 链回溯） | 89.02 | -67% |
| 第三轮（stateKey 缓存复用 + 提前深度剪枝） | **78.09** | **-71%（3.44×）** |

GOAP 自耗时占比由约 80% 降至以 `_planFast`(40%) + `_valsKey`(15%) 为主，其余系统重新可见。

## 后果

### 正面
- 单天模拟提速 3.44 倍，从 268.79ms 降至 78.09ms，"模拟 300 年"从约 12 小时级别降到可接受范围。
- 行为完全不变（旧摘要回归回归保证），玩家端与模拟器观感一致。
- `test-goal-equivalence.mjs` 作为长期回归测试，后续改动 GOAP 可一键校验无漂移。

### 负面 / 权衡
- `getEffects()` 现返回共享缓存对象（只读契约）；调用方不得就地修改 effects（已确认现有调用全为只读遍历）。
- Planner 新增快/慢双路径，代码量增加；慢路径保留为兼容兜底（罕见编译失败）。
- 进一步提速需减少搜索迭代数（收紧 `maxIterations`/调整启发式），但那会改变规划结果，已超出"纯性能优化"边界，留待显式决策。

## 后续

- 当前剩余瓶颈是 A* 搜索本身（平均约 157 迭代/次规划）。若仍需更快，可探索：启发式增强以减少展开、决策结果缓存（相同 state+goal 复用计划）、或降低规划频率——但均需评估对行为/最优性的影响，应单独立项。

