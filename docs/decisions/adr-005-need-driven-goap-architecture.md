# ADR-005: 需求驱动 GOAP 世界模拟架构

> 日期：2026-05-28
> 状态：已采纳

## 背景

现有的势力 AI 采用简单的加权随机选行为模式（`faction-ai.md`），无法支撑以下需求：
- 需求优先级动态计算
- 行为链自动生成（多步骤规划）
- 资源消耗/产出闭环
- 大规模扩展（新需求、新行为只需配置）

## 决策

采用 Entity + Need + GOAP + Item 四位一体架构：

1. **统一实体模型（BaseEntity）**：所有实体（势力、NPC、世界）共享组合模式结构——静态数据 + 运行时状态 + 需求系统 + 行为系统 + 物品容器。
2. **需求驱动（NeedSystem）**：需求由状态驱动，优先级通过 NeedEvaluator 策略实时计算。
3. **GOAP 规划（GOAPPlanner）**：采用 A* 正向搜索算法，从当前状态出发，找到达成目标状态的最低代价行为链。
4. **物品系统（ItemRegistry + Inventory）**：行为的消耗/产出通过物品系统形成闭环。
5. **数据驱动（NeedPool + ActionPool）**：需求和行为模板从 JSON 配置加载，新增类型不修改核心代码。

## 代码位置

所有新架构代码位于 `apps/game/js/engine/`：
- `abstract/` —— 抽象核心层（10 个文件）
- `items/` —— 物品系统（3 个文件）
- `pools/` —— 需求池和行为池（2 个文件）
- `faction/` —— 势力具体实现（5 个文件）
- `npc/` —— NPC 具体实现（5 个文件）
- `world/` —— 世界实体（4 个文件）
- `world-engine.js` —— 引擎主入口
- `world-engine.worker.js` —— Worker 入口

模拟界面：`apps/game/simulation.html` + `js/simulation-main.js`

## 设计模式使用

组合模式、策略模式、命令模式、工厂模式、注册表模式、观察者模式、模板方法模式、享元模式、中介者模式、建造者模式、责任链模式、装饰器模式。

## 与现有代码的关系

| 现有模块 | 处理方式 |
|---------|---------|
| GameManager | 保留作为主线程协调器 |
| EventBus | 保留，引擎内部和 Worker 通信共用 |
| constants.js | 后续扩展 |
| Renderer / UI | 保留，后续适配新 Tick 结果格式 |
| factions.json / npcs.json | 直接被新引擎读取使用 |

## 扩展性

- 新增势力/NPC 行为：只需在 JSON 配置 + 实现 executor
- 新增需求类型：只需在 JSON 配置 + 实现 evaluator
- 新增物品：只需编辑 JSON
- 新增实体类型（如玩家、建筑）：新增目录 + 继承 BaseEntity

## 后果

- 正面：架构高度可扩展，GOAP 自动生成行为链，需求优先级实时计算
- 正面：数据驱动设计使策划人员可通过 JSON 调整行为规则
- 风险：GOAP 搜索在大行为池时可能有性能问题（已通过 maxDepth/maxIterations 限制）
- 风险：新架构与现有简单 AI 逻辑并存，需要后续统一
