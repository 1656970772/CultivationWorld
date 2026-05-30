# 设计模式与原则

> 最后更新：2026-05-28

## 设计原则

1. **单一职责（SRP）** —— 每个模块/类只做一件事
2. **开闭原则（OCP）** —— 对扩展开放，对修改关闭。新增地形、势力类型、事件规则不需要改动核心代码
3. **依赖倒置（DIP）** —— 高层模块不依赖低层实现，依赖抽象接口
4. **低耦合** —— 模块间通过消息/事件通信，不直接引用内部实现
5. **高内聚** —— 相关逻辑集中在同一模块内

## 采用的设计模式

### 1. 中介者模式（Mediator） —— GameManager

**问题：** 多个模块（Renderer、UIManager、SaveManager、WorldEngine）需要互相通信，如果直接引用会产生网状依赖。

**方案：** GameManager 作为中介者，所有模块只与 GameManager 通信，不直接互相引用。

```
不要这样：
  Renderer ←→ UIManager ←→ SaveManager ←→ WorldEngine

而是这样：
  Renderer ──┐
  UIManager ─┼──▶ GameManager ◀── WorldEngine
  SaveManager┘
```

### 2. 观察者模式（Observer） —— 事件总线

**问题：** 世界演化产生的变化需要通知多个消费者（UI 更新、地图重绘、日志追加等）。

**方案：** GameManager 内置事件总线（EventBus），模块通过 subscribe/publish 通信。

```javascript
// 接口定义
class EventBus {
  subscribe(eventType, callback)
  publish(eventType, data)
  unsubscribe(eventType, callback)
}
```

关键事件类型：
- `WORLD_TICK_COMPLETE` —— 世界完成一天演化
- `PLAYER_MOVED` —— 玩家移动
- `EVENT_TRIGGERED` —— 世界事件触发
- `EVENT_CHOICE_MADE` —— 玩家做出事件选择
- `INFO_RECEIVED` —— 玩家收到新信息/传闻
- `SAVE_COMPLETE` —— 存档完成
- `LOAD_COMPLETE` —— 读档完成

### 3. 策略模式（Strategy） —— 势力 AI

**问题：** 不同势力类型（正派/邪派/妖族/凡人）的决策逻辑不同，未来还会扩展新类型。

**方案：** 将决策算法抽象为策略接口，每种势力类型实现自己的策略。

```javascript
// 策略接口
class FactionStrategy {
  evaluate(faction, worldState) → { action, target, priority }
}

// 具体策略
class RighteousFactionStrategy extends FactionStrategy { ... }
class EvilFactionStrategy extends FactionStrategy { ... }
class DemonFactionStrategy extends FactionStrategy { ... }
class MortalKingdomStrategy extends FactionStrategy { ... }
class NeutralFactionStrategy extends FactionStrategy { ... }
```

新增势力类型只需新增一个策略类，不修改已有代码。

### 4. 模板方法模式（Template Method） —— 世界 Tick

**问题：** 世界每天的演化流程是固定的步骤顺序，但每个步骤的内部逻辑可能变化。

**方案：** WorldEngine 的 tick 方法定义流程骨架，每个步骤委托给子系统。

```javascript
class WorldEngine {
  tick() {
    this.updateWorldModifiers()    // 步骤1：全局状态
    this.runFactionDecisions()     // 步骤2：势力决策
    this.triggerEvents()           // 步骤3：事件触发
    this.executeEvents()           // 步骤4：事件执行
    this.updateStability()         // 步骤5：稳定度
    this.updateRelations()         // 步骤6：关系
    this.propagateInfo()           // 步骤7：信息传播
    this.updateNPCs()              // 步骤8：NPC 状态
  }
}
```

### 5. 工厂模式（Factory） —— 事件创建

**问题：** 事件有多种类型（攻伐、结盟、秘境、天灾等），创建逻辑各不相同。

**方案：** 事件工厂根据类型创建对应的事件实例。

```javascript
class EventFactory {
  static create(type, params) → Event
}
```

新增事件类型只需在工厂中注册，不修改事件系统核心逻辑。

### 6. 数据驱动（Data-Driven） —— 规则与配置

**问题：** 事件规则、地形属性、势力初始数据等如果硬编码在代码中，修改和扩展困难。

**方案：** 所有可配置数据抽离到 JSON 文件中，代码只负责读取和执行。

```
data/
├── map.json          # 地形数据
├── factions.json     # 势力初始配置
├── npcs.json         # NPC 配置
├── events.json       # 预设事件模板
├── rules.json        # 规则引擎配置
├── terrains.json     # 地形类型定义
└── modifiers.json    # 世界状态类型定义
```

新增地形/事件/规则只需编辑 JSON，不改代码。

## v2 引擎新增设计模式

### 7. 组合模式（Composition） —— BaseEntity

**方案：** 实体 = 静态数据 + 运行时状态 + 需求系统 + 行为系统 + 物品容器。替代继承，每个组件独立可替换。

### 8. 命令模式（Command） —— Action

**方案：** 每个行为封装为可序列化的命令对象，包含前置条件、效果、消耗、产出。支持 GOAP 规划器搜索。

### 9. 注册表模式（Registry） —— EntityRegistry / ItemRegistry / NeedPool / ActionPool

**方案：** 全局单例管理所有注册类型，支持从 JSON 批量加载和按 ID/类型查询。

### 10. 享元模式（Flyweight） —— StaticData / ItemDefinition

**方案：** 不可变数据通过 Object.freeze 共享，运行时不复制。

### 11. 建造者模式（Builder） —— FactionEntity / NPCEntity 构造器

**方案：** 实体构造时分步初始化静态数据、状态、需求、行为，每步独立可定制。

### 12. 责任链模式（Chain of Responsibility） —— TickManager 冲突解决

**方案：** 多势力争夺同一目标时，按链依次处理冲突。

### 13. 装饰器模式（Decorator） —— WorldModifier

**方案：** 世界状态（魔气上涨、灵气复苏等）叠加影响行为结果和资源产出。

## 设计模式汇总（v2）

| 模式 | 应用位置 | 用途 |
|------|---------|------|
| **组合模式** | BaseEntity | 实体 = 静态数据 + 状态 + 需求 + 行为 + 物品 |
| **策略模式** | NeedEvaluator, ActionExecutor | 不同实体类型可替换评估和执行策略 |
| **命令模式** | Action | 行为封装为可序列化的命令对象 |
| **工厂模式** | NeedPool.create, ActionPool.create | 从 JSON 配置创建实例 |
| **注册表模式** | EntityRegistry, ItemRegistry, NeedPool, ActionPool | 全局单例管理所有注册类型 |
| **观察者模式** | EventBus, RuntimeState.onChange | 状态变更通知、跨实体通信 |
| **模板方法模式** | TickManager.tick(), BaseEntity.tick() | 固定流程骨架，子步骤可覆写 |
| **享元模式** | StaticData, ItemDefinition | 不可变数据共享 |
| **中介者模式** | TickManager, WorldEngine | 协调各实体间交互 |
| **建造者模式** | EntityBuilder | 复杂实体的分步构建 |
| **责任链模式** | 冲突解决器 | 多势力争夺同一目标时按链处理 |
| **装饰器模式** | WorldModifier | 世界状态叠加影响行为结果 |

## 扩展指南

| 扩展需求 | 需要做的 | 不需要改的 |
|---------|---------|-----------|
| 新增地形类型 | 在 `terrains.json` 加一条 | 渲染器会自动读取 |
| 新增势力类型 | 在 `faction-templates.json` 加模板 + 需求/行为 JSON 配置 | 抽象层、GOAP、其他势力代码 |
| 新增 NPC 行为 | 在 `npc-actions.json` 加一条 + 实现 executor | 需求系统、其他行为 |
| 新增需求类型 | 在 `*-needs.json` 加一条 + 实现 evaluator | GOAP、行为系统 |
| 新增物品类型 | 在 `resources.json` / `props.json` 加一条 | 所有代码 |
| 新增世界规则 | 在 `world-rules.json` 加一条 + 实现 executor | 实体系统 |
| 增加玩家 | 创建 `player/` 目录，PlayerEntity 继承 BaseEntity | 所有已有实体和系统 |
| 新增 UI 面板 | 新增面板类 + 在 GameManager 注册事件 | 其他面板不受影响 |
