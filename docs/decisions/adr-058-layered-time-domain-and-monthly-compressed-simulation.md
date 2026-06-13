# ADR-058：分层时间域与远处月压缩模拟

> 最后更新：2026-06-09
> 日期：2026-06-09
> 关联文档：`docs/architecture/world-simulation/README.md`、`docs/architecture/world-simulation/07-月压缩关键状态结算细节.md`、`docs/architecture/world-simulation/08-项目落地接口与改造路线.md`、`docs/systems/simulation-lod.md`、`docs/systems/player-encounter-dialogue.md`、`docs/data-models/simulation-time-domain.md`、`docs/data-models/player-encounter-dialogue.md`

## 状态

Accepted

## 背景

当前项目以日 Tick 推进世界。`TickManager.tick()` 每次执行世界规则、势力、移动、NPC、妖兽、死亡、信息、关系和月度门派处理；`multiTick(count)` 只是循环日 Tick。

正式运行期需要同时满足：

- 玩家附近有逐帧移动、战斗、相遇和剧情对话。
- 远处 NPC 不逐帧运行，但一个月一次结算完整世界变化。
- NPC 的关系、背包、修为、境界、地点轨迹、任务、死亡、日志和剧情状态都要变化。
- 重要 NPC 远离玩家时仍要保留高保真因果。
- 对话随境界、时间、地点、关系和近期经历变化，且配置化。

鬼谷八荒分析报告证明了一个可参考的结构：世界运行由多个管理器聚合，时间有阶段顺序，NPC 行为和对话均配置化，剧情包有持久状态机。该参考只作为架构启发，不作为算法或内容复用来源。

## 决策

采用三层时间域：

1. Hot 实时域：玩家附近逐帧推进移动、即时反应、战斗、相遇和对话。
2. Warm 日域：玩家附近外圈、玩家标记和近期可接触对象继续使用日 Tick 与 Job/Toil。
3. Cold 月压缩域：远处对象每 30 天或配置化月长执行一次月压缩 pipeline。

月压缩必须通过阶段流水线完成：

1. 构建月上下文。
2. 分配 NPC 保真等级。
3. 结算世界、势力和门派月阶段。
4. 为 NPC 生成月度 agenda。
5. 生成地点轨迹和 episode。
6. 结算事件、任务、经济、背包、修为、境界、关系、死亡、剧情包和日志。
7. 通过 `StateDeltaLedger` 校验和提交。

对话系统采用配置 DSL：

- 对话候选有条件、权重、优先级和节点。
- 选项有条件、成本、副作用命令和下一节点。
- 副作用通过命令写入关系、背包、任务、剧情包、战斗、记忆和日志。
- 对话上下文读取 NPC 当前 Job、月压缩 episode、地点、时间、境界差、关系和玩家已知信息。

## 后果

### 正向

- 近处体验和远处性能可以同时满足。
- 月压缩不会绕过现有关系、经济、修为、战斗、GAS 和任务服务。
- 重要 NPC 的经历可被玩家追踪和在对话中引用。
- 对话和剧情包可数据驱动扩展，新增境界、地点、关系对白不改核心代码。

### 代价

- 需要新增 `TimeDomainScheduler`、`SimulationZoneResolver`、`MonthlyCompressionEngine`、`StateDeltaLedger`、`DialogueResolver` 等基础设施。
- 月压缩 executor 必须处理顺序和一致性，例如死亡后停止后续 episode。
- 验证不能只看最终数值，需要长程模拟观察关系、背包、地点、日志和剧情包状态。

### 约束

- 不允许用 `multiTick(30)` 作为正式远处月压缩实现。
- 不允许为单个 NPC、单个地点或单个对白在代码中写固定分支。
- 不允许让 Hot/Warm/Cold 各自维护独立真相源。
- 新增运行时配置文件时必须更新 `data-manifest.json` 与 `docs/data/data-config-rules.md`。
