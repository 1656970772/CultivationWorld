# 实施计划

> 最后更新：2026-05-30
> 总共 6 个阶段，每个阶段有明确的交付物和验收标准
>
> **状态说明**：本文为早期分阶段实施计划，文中 100×100 地图、12 势力等验收项为历史目标。
> 当前真实范围见 `docs/overview.md`「当前实现范围」与体检报告 `docs/reports/2026-05-30-项目分析与下一步建议.md`。

## 总览

```
阶段1：地基层         ──▶  阶段2：世界引擎        ──▶  阶段3：渲染与交互
(核心框架+数据配置)       (演化逻辑+调试时间线)        (Canvas地图+UI面板)
     │                        │                          │
     │ 可独立验证              │ 可独立验证（纯数据跑）    │ 可独立验证（看到世界）
     │                        │                          │
     ▼                        ▼                          ▼
阶段4：玩家系统        ──▶  阶段5：存档系统        ──▶  阶段6：联调与打磨
(移动+事件交互+感知)       (IndexedDB+多存档)          (平衡性+BUG+体验)
```

每个阶段完成后可以独立验证，不需要等后续阶段。

---

## 阶段 1：地基层（核心框架 + 数据配置）

> 目标：搭好项目骨架，所有模块能互相通信，数据配置就位

### 任务清单

| 编号 | 任务 | 产出文件 | 子 Agent |
|------|------|---------|---------|
| 1.1 | 创建 `index.html` 入口 + `css/style.css` 基础样式 | `index.html`, `css/style.css` | Agent-A |
| 1.2 | 实现 `EventBus` 事件总线 | `js/core/event-bus.js` | Agent-A |
| 1.3 | 实现 `constants.js` 枚举与常量 | `js/core/constants.js` | Agent-A |
| 1.4 | 实现 `GameManager` 中介者骨架 | `js/core/game-manager.js` | Agent-A |
| 1.5 | 实现 `main.js` 主入口 | `js/main.js` | Agent-A |
| 1.6 | 创建地形类型配置 | `data/definitions/terrains.json` | Agent-B |
| 1.7 | 创建世界状态类型配置 | `data/world/modifiers.json` | Agent-B |
| 1.8 | 创建固定地图数据（100×100） | `data/world/map.json` | Agent-B |
| 1.9 | 创建势力初始配置 | `data/entities/factions.json` | Agent-B |
| 1.10 | 创建 NPC 初始配置 | `data/entities/npcs.json` | Agent-B |
| 1.11 | 创建规则引擎配置 | `data/rules.json` | Agent-B |
| 1.12 | 创建预设事件模板 | `data/events.json` | Agent-B |

### 子 Agent 分工

- **Agent-A：项目骨架**
  - 负责：`index.html` + `css/` + `js/core/` + `js/main.js`
  - 约束：只搭骨架和接口定义，不实现业务逻辑
  - 依赖文档：`architecture/system-overview.md`, `architecture/design-patterns.md`, `architecture/file-structure.md`

- **Agent-B：数据配置**
  - 负责：`data/` 下所有 JSON 文件
  - 约束：严格按照 `data-models/` 和 `worldbuilding/` 文档中的数据结构和世界观设定生成
  - 依赖文档：`data-models/*`, `worldbuilding/*`
  - 重点：`map.json` 需要生成 100×100 = 10,000 格的地形数据，按照 `continent.md` 的分区规划填充地形和势力领地

### 验收标准

- [ ] 浏览器打开 `index.html` 不报错
- [ ] `EventBus` 可以 publish/subscribe/unsubscribe
- [ ] `GameManager` 能初始化并加载所有数据配置
- [ ] 控制台打印出加载的势力数量（12个）、地图尺寸（100×100）

---

## 阶段 2：世界引擎（演化逻辑 + 调试时间线）

> 目标：世界能自动运转，每天 Tick 产生决策和事件，调试面板能看到全部数据

### 任务清单

| 编号 | 任务 | 产出文件 | 子 Agent |
|------|------|---------|---------|
| 2.1 | 实现 `DebugTimeline` 决策时间线记录器 | `js/engine/debug-timeline.js` | Agent-C |
| 2.2 | 实现 `WorldEngine` 世界引擎 + Tick 流程 | `js/engine/world-engine.js` | Agent-C |
| 2.3 | 实现 `Web Worker` 入口和消息协议 | `js/engine/world-engine.worker.js` | Agent-C |
| 2.4 | 实现 `ModifierSystem` 世界状态系统 | 集成在 `world-engine.js` 或独立 | Agent-C |
| 2.5 | 实现 `StabilitySystem` 稳定度系统 | `js/engine/stability.js` | Agent-D |
| 2.6 | 实现 `InfoPropagation` 信息传播系统 | `js/engine/info-propagation.js` | Agent-D |
| 2.7 | 实现 `RelationSystem` 关系更新系统 | 集成在 `world-engine.js` 或独立 | Agent-D |
| 2.8 | 实现 `FactionAI` 策略调度器 | `js/engine/faction-ai.js` | Agent-E |
| 2.9 | 实现 5 个势力策略类 | `js/engine/strategies/*.js` | Agent-E |
| 2.10 | 实现 `EventSystem` 规则引擎 | `js/engine/event-system.js` | Agent-F |
| 2.11 | 实现 `EventFactory` 事件工厂 + 各事件类型 | `js/engine/event-factory.js` | Agent-F |
| 2.12 | 实现 NPC 系统（死亡、继任） | 集成在 `world-engine.js` | Agent-F |

### 子 Agent 分工

- **Agent-C：引擎核心 + 调试时间线**
  - 负责：`WorldEngine`（Tick 流程骨架）+ `Worker` 入口 + `DebugTimeline` + `ModifierSystem`
  - 约束：Tick 的每一步都必须调用 `timeline.log()` 记录完整数据；Worker 消息协议按 `system-overview.md` 定义
  - 依赖文档：`systems/world-tick.md`, `systems/debug-timeline.md`, `systems/time-action.md`, `data-models/world-modifiers.md`
  - 关键：DebugTimeline 是第一个实现的，其他子系统都依赖它来记录

- **Agent-D：稳定度 + 信息传播 + 关系**
  - 负责：`StabilitySystem` + `InfoPropagation` + `RelationSystem`
  - 约束：每个系统都是纯函数式（输入世界状态 → 输出变更），调用 `timeline.log()` 记录
  - 依赖文档：`systems/stability.md`, `data-models/info-propagation.md`, `systems/info-sense.md`

- **Agent-E：势力 AI**
  - 负责：`FactionAI` 调度器 + 5 个策略类
  - 约束：严格遵循策略模式；权重计算过程必须完整记录到 DebugTimeline（每项基础权重、性格修正、世界状态修正、局势修正、归一化概率、随机值）
  - 依赖文档：`systems/faction-ai.md`, `architecture/design-patterns.md`（策略模式部分）, `worldbuilding/npcs.md`

- **Agent-F：事件系统**
  - 负责：`EventSystem` 规则引擎 + `EventFactory` + 各事件类型实现 + NPC 系统
  - 约束：规则从 `data/rules.json` 读取，不硬编码；事件触发的每个条件检查结果都记录到 DebugTimeline
  - 依赖文档：`systems/event-system.md`, `architecture/design-patterns.md`（工厂模式部分）, `data-models/npc.md`

### 依赖关系

```
Agent-C (引擎核心 + DebugTimeline)
  ├── Agent-D (稳定度 + 信息传播 + 关系) —— 依赖 DebugTimeline 接口
  ├── Agent-E (势力 AI) —— 依赖 DebugTimeline 接口
  └── Agent-F (事件系统) —— 依赖 DebugTimeline 接口
```

**执行顺序：** Agent-C 先行，定义好 DebugTimeline 接口和 WorldEngine 骨架后，Agent-D/E/F 并行开发。

### 验收标准

- [ ] WorldEngine 可以在 Worker 中运行，完成 Tick
- [ ] 不需要 UI，纯数据运行 100 天，控制台输出 DebugTimeline 日志
- [ ] 日志中可以看到：世界状态变化、每个势力每天的决策权重和结果、事件触发和执行、稳定度变化、关系变化、信息传播过程
- [ ] 12 个势力在 100 天内有合理的交互（有攻伐、有结盟、有稳定度崩溃等）
- [ ] 大势力不会无限扩张（稳定度机制生效）

---

## 阶段 3：渲染与基础交互

> 目标：在浏览器中看到地图、势力领地、迷雾，可以点击地图查看格子信息

### 任务清单

| 编号 | 任务 | 产出文件 | 子 Agent |
|------|------|---------|---------|
| 3.1 | 实现 `Camera` 相机（拖拽平移、滚轮缩放） | `js/renderer/camera.js` | Agent-G |
| 3.2 | 实现 `TileRenderer` 格子渲染（地形颜色、势力颜色） | `js/renderer/tile-renderer.js` | Agent-G |
| 3.3 | 实现 `FogRenderer` 迷雾渲染 | `js/renderer/fog-renderer.js` | Agent-G |
| 3.4 | 实现 `Renderer` 主渲染器（组合以上 + 渲染循环） | `js/renderer/renderer.js` | Agent-G |
| 3.5 | 实现 `StatusBar` 状态栏 | `js/ui/status-bar.js` | Agent-H |
| 3.6 | 实现 `LogPanel` 日志面板 | `js/ui/log-panel.js` | Agent-H |
| 3.7 | 实现 `DebugPanel` 开发者调试面板 | `js/ui/debug-panel.js` | Agent-H |
| 3.8 | 实现 `Minimap` 小地图 | `js/ui/minimap.js` | Agent-H |
| 3.9 | 实现 `UIManager` UI 总管理器 | `js/ui/ui-manager.js` | Agent-H |
| 3.10 | 更新 `style.css` 完整布局样式 | `css/style.css` | Agent-H |

### 子 Agent 分工

- **Agent-G：Canvas 渲染**
  - 负责：`js/renderer/` 下所有文件
  - 约束：只从世界快照数据读取渲染，不修改世界状态；视口裁剪只渲染可见格子；地形基础层缓存到离屏 Canvas
  - 依赖文档：`systems/renderer.md`, `data-models/world-map.md`

- **Agent-H：UI 面板**
  - 负责：`js/ui/` 下所有文件（除 `event-dialog.js` 和 `save-panel.js`，放到后续阶段）+ `css/style.css`
  - 约束：通过 EventBus 与 GameManager 通信，不直接引用其他模块
  - 依赖文档：`systems/ui.md`, `systems/debug-timeline.md`（DebugPanel 部分）, `systems/info-sense.md`

### 验收标准

- [ ] 打开浏览器看到 100×100 地图，地形颜色正确
- [ ] 势力领地用不同颜色标记
- [ ] 可以拖拽平移、滚轮缩放
- [ ] 迷雾正确显示（玩家初始位置周围可见，其余灰暗）
- [ ] 状态栏显示天数、行动点、坐标
- [ ] 日志面板可以显示信息
- [ ] 调试面板可以按天展示 DebugTimeline 数据
- [ ] 小地图显示全局缩略

---

## 阶段 4：玩家系统（移动 + 事件交互 + 感知）

> 目标：玩家可以点击移动、触发事件选项、看到传闻，完整的游戏循环跑通

### 任务清单

| 编号 | 任务 | 产出文件 | 子 Agent |
|------|------|---------|---------|
| 4.1 | 实现玩家点击移动（点击格子 → 寻路 → 逐格移动 → 消耗行动点） | `GameManager` 中补充 | Agent-I |
| 4.2 | 实现行动点 → 世界 Tick 联动 | `GameManager` 中补充 | Agent-I |
| 4.3 | 实现打坐（快进时间） | `GameManager` / UI 中补充 | Agent-I |
| 4.4 | 实现 `EventDialog` 事件弹窗 | `js/ui/event-dialog.js` | Agent-I |
| 4.5 | 实现玩家介入事件逻辑（选择 → 影响事件结果） | `WorldEngine` 中补充 | Agent-I |
| 4.6 | 实现神识范围感知（动态更新可见区域） | `Renderer` + `GameManager` 中补充 | Agent-I |
| 4.7 | 实现信息传播 → 玩家日志联动 | `InfoPropagation` + `LogPanel` 联动 | Agent-I |

### 子 Agent 分工

- **Agent-I：玩家系统（独立完成）**
  - 负责：玩家移动、行动点消耗、Tick 触发、事件弹窗、玩家介入、神识感知、日志联动
  - 约束：这些功能互相依赖较强，由同一个 Agent 完成保证一致性
  - 依赖文档：`systems/time-action.md`, `systems/info-sense.md`, `systems/event-system.md`（玩家介入部分）, `data-models/player.md`

### 验收标准

- [ ] 点击地图格子，玩家角色移动过去，行动点减少
- [ ] 沼泽消耗双倍行动点，河流不可通行
- [ ] 行动点用完自动触发世界 Tick，地图上势力领地发生变化
- [ ] 打坐可以快进时间
- [ ] 进入事件范围弹出选项弹窗，选择后影响事件结果
- [ ] 信息传播到玩家时，日志面板显示传闻/确认消息
- [ ] 神识范围随玩家移动更新

---

## 阶段 5：存档系统

> 目标：可以存档、读档、回档、导出导入

### 任务清单

| 编号 | 任务 | 产出文件 | 子 Agent |
|------|------|---------|---------|
| 5.1 | 实现 `SaveManager` IndexedDB 存储 | `js/storage/save-manager.js` | Agent-J |
| 5.2 | 实现 `SavePanel` 存档 UI 面板 | `js/ui/save-panel.js` | Agent-J |
| 5.3 | 实现世界状态序列化/反序列化 | `SaveManager` + `WorldEngine` 配合 | Agent-J |
| 5.4 | 实现自动存档（每 N 天） | `GameManager` 中补充 | Agent-J |
| 5.5 | 实现导出/导入 JSON 文件 | `SaveManager` 中补充 | Agent-J |

### 子 Agent 分工

- **Agent-J：存档系统（独立完成）**
  - 负责：IndexedDB 操作、UI 面板、序列化、自动存档、导出导入
  - 依赖文档：`systems/save-system.md`

### 验收标准

- [ ] 可以手动保存到任意存档槽位
- [ ] 可以读取存档，世界恢复到保存时的状态
- [ ] 多存档槽位（至少 10 个）
- [ ] 自动存档正常工作
- [ ] 可以导出 JSON 文件、导入 JSON 文件恢复存档

---

## 阶段 6：联调与打磨

> 目标：完整游戏循环流畅运行，规则平衡，体验顺滑

### 任务清单

| 编号 | 任务 | 子 Agent |
|------|------|---------|
| 6.1 | 全链路联调：玩家行动 → Tick → 渲染 → UI 更新 → 存档 | Agent-K |
| 6.2 | 跑 200 天无人模式，通过 DebugTimeline 验证规则平衡性 | Agent-K |
| 6.3 | 调整数值平衡（权重、概率、稳定度衰减速度等） | Agent-K |
| 6.4 | 性能优化（大地图渲染帧率、Worker 计算时间） | Agent-K |
| 6.5 | 修复 BUG | Agent-K |
| 6.6 | UI 交互打磨（动画过渡、提示文案、颜色美化） | Agent-K |

### 子 Agent 分工

- **Agent-K：联调打磨（独立完成）**
  - 这个阶段需要对全局有理解，由单一 Agent 负责
  - 依赖：全部文档

### 验收标准

- [ ] 完整玩一局（100 天以上），体验流畅
- [ ] DebugTimeline 中所有决策数据合理
- [ ] 无 JavaScript 报错
- [ ] 200 天无人模式下世界不崩溃（不出现所有势力消亡等极端情况）
- [ ] 帧率 60fps（正常缩放下）

---

## 子 Agent 总览

| Agent | 负责内容 | 阶段 | 可并行 |
|-------|---------|------|--------|
| Agent-A | 项目骨架（HTML/CSS/Core） | 阶段1 | 与 Agent-B 并行 |
| Agent-B | 数据配置（data/*.json） | 阶段1 | 与 Agent-A 并行 |
| Agent-C | 引擎核心 + DebugTimeline | 阶段2 | 先行 |
| Agent-D | 稳定度 + 信息传播 + 关系 | 阶段2 | 与 E/F 并行（C 完成后） |
| Agent-E | 势力 AI（策略模式） | 阶段2 | 与 D/F 并行（C 完成后） |
| Agent-F | 事件系统 + NPC | 阶段2 | 与 D/E 并行（C 完成后） |
| Agent-G | Canvas 渲染 | 阶段3 | 与 Agent-H 并行 |
| Agent-H | UI 面板 | 阶段3 | 与 Agent-G 并行 |
| Agent-I | 玩家系统 | 阶段4 | 独立 |
| Agent-J | 存档系统 | 阶段5 | 独立 |
| Agent-K | 联调打磨 | 阶段6 | 独立 |

## 并行执行图

```
时间线 ──────────────────────────────────────────────────▶

阶段1:  ┌─ Agent-A (骨架) ─┐
        │                  ├──▶ 阶段1完成
        └─ Agent-B (数据) ─┘
                               │
阶段2:                         ├─ Agent-C (引擎核心) ──┐
                               │                      ├─ Agent-D (稳定度/传播) ─┐
                               │                      ├─ Agent-E (势力AI)      ├──▶ 阶段2完成
                               │                      └─ Agent-F (事件系统)    ─┘
                                                                                │
阶段3:                                                                          ├─ Agent-G (渲染) ─┐
                                                                                │                  ├──▶ 阶段3完成
                                                                                └─ Agent-H (UI)   ─┘
                                                                                                    │
阶段4:                                                                                              └─ Agent-I (玩家) ──▶ 阶段4完成
                                                                                                                          │
阶段5:                                                                                                                    └─ Agent-J (存档) ──▶ 阶段5完成
                                                                                                                                                │
阶段6:                                                                                                                                          └─ Agent-K (联调) ──▶ 完成
```

## 每个子 Agent 的上下文注入

每个子 Agent 启动时需要注入以下信息：

1. **项目规则** —— `.cursor/rules/project-rules.md`
2. **对应的设计文档** —— 见各 Agent 的"依赖文档"
3. **文件结构** —— `docs/architecture/file-structure.md`
4. **设计模式** —— `docs/architecture/design-patterns.md`
5. **前置 Agent 的产出** —— 已完成的代码文件（阶段间依赖）
