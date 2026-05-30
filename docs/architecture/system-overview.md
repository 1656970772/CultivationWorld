# 系统架构总览

> 最后更新：2026-05-28

## 技术方案

纯前端单体架构，零后端依赖。

- **技术栈：** 原生 JavaScript（ES Module）+ Canvas 2D + IndexedDB
- **部署：** 静态文件（GitHub Pages 等）
- **兼容性：** 现代浏览器（Chrome / Firefox / Edge）

数据编辑器作为独立开发工具链升级为 Tauri 2 + Rust 后端 + WebView2 桌面工具。该工具链只负责编辑 `data/` JSON 数据，不替代游戏主入口，不改变游戏运行时的纯前端架构。

- **游戏运行时：** `apps/game/index.html` + 原生 JavaScript + Canvas 2D + Web Worker + IndexedDB
- **桌面编辑器：** `apps/editor/` 下的 Tauri 2 + Rust commands + WebView2 + 编辑器 Web UI
- **边界：** 编辑器可以读写项目 `data/` 文件；游戏本体仍从静态资源和浏览器存储运行

## 桌面编辑器工具链

桌面编辑器面向开发和内容生产场景，负责更稳定地打开项目、读取数据、保存 JSON、创建备份和执行校验。

```
┌─────────────────────────────────────────────────────┐
│             Tauri 桌面数据编辑器（开发工具）          │
│                                                     │
│  WebView2 前端                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │ data-editor.html + js/editor/                 │  │
│  │ 表单编辑 / 校验面板 / 地图编辑器 / 保存按钮      │  │
│  └───────────────────────┬───────────────────────┘  │
│                          │ invoke                  │
│  Rust 后端 commands      ▼                         │
│  ┌───────────────────────────────────────────────┐  │
│  │ 项目目录解析 / JSON 读写 / 备份 / 路径安全 / 校验 │  │
│  └───────────────────────┬───────────────────────┘  │
│                          │                         │
└──────────────────────────┼──────────────────────────┘
                           ▼
                    data/*.json
```

该工具链与游戏运行时共享 `data/` 文件格式。编辑器保存出的 JSON 必须保持兼容现有 `WorldEngine`、渲染器和 UI 读取逻辑。

## 模块划分

```
┌─────────────────────────────────────────────────────┐
│                    主线程 (Main Thread)               │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Renderer │  │UIManager │  │   SaveManager    │   │
│  │ (Canvas) │  │  (DOM)   │  │   (IndexedDB)    │   │
│  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
│       │              │                │              │
│       └──────────────┼────────────────┘              │
│                      │                               │
│              ┌───────┴────────┐                      │
│              │  GameManager   │                      │
│              │  (协调器/中介者) │                      │
│              └───────┬────────┘                      │
│                      │ postMessage                   │
├──────────────────────┼──────────────────────────────┤
│                      │                               │
│              ┌───────┴────────┐   Web Worker Thread  │
│              │  WorldEngine   │                      │
│              │  ┌───────────┐ │                      │
│              │  │TickManager│ │                      │
│              │  ├───────────┤ │                      │
│              │  │GOAPPlanner│ │                      │
│              │  ├───────────┤ │                      │
│              │  │NeedSystem │ │                      │
│              │  ├───────────┤ │                      │
│              │  │BehaviorSys│ │                      │
│              │  ├───────────┤ │                      │
│              │  │EntityReg. │ │                      │
│              │  ├───────────┤ │                      │
│              │  │ItemRegistry│ │                      │
│              │  └───────────┘ │                      │
│              └────────────────┘                      │
└─────────────────────────────────────────────────────┘
```

## 需求驱动世界模拟架构（v2）

v2 引擎采用 Entity-Need-GOAP-Item 四位一体设计：

- 所有实体（势力、NPC、世界）共享抽象 BaseEntity 结构
- 需求由状态驱动，优先级实时计算
- 行为通过 GOAP 规划器自动生成行为链
- 物品系统是行为的输入输出介质

```
BaseEntity
├── StaticData         出生时设定，运行时不可变
├── RuntimeState       可观察的动态属性容器
├── NeedSystem         需求管理（按优先级排序）
├── BehaviorSystem     GOAP 行为规划与执行
└── Inventory          物品容器（资源/道具）
```

引擎子系统位于 `apps/game/js/engine/`，按抽象核心层、数据驱动池、具体实现层三级组织。详见 `file-structure.md`。

## 模块职责

| 模块 | 运行位置 | 职责 | 对外接口 |
|------|----------|------|----------|
| **GameManager** | 主线程 | 中介者，协调各模块通信，管理游戏生命周期 | 初始化、暂停、恢复、存读档 |
| **WorldEngine** | Worker / 主线程 | 世界引擎主入口，初始化所有子系统并驱动 Tick | init / tick / getWorldSnapshot |
| **TickManager** | Worker 内 | Tick 编排器，协调世界→势力→NPC 的执行顺序 | tick / multiTick |
| **GOAPPlanner** | Worker 内 | A* 正向搜索规划器，生成行为链 | plan(current, goal, actions) |
| **NeedSystem** | Worker 内 | 实体需求管理，优先级排序，产出统一 Goal | evaluate / getTopNeeds / getTopGoals |
| **BehaviorSystem** | Worker 内 | 行为链执行，支持中断、重规划、执行期实时重选 | plan / executeStep / reselectCurrentAction |
| **BTRunner / PlannerNode** | Worker 内 | GOBT 行为树驱动 + 选目标/规划/执行节点（ADR-018） | run / tick |
| **MemorySystem** | Worker 内 | NPC 长期记忆（定长环形队列，ADR-019） | add / decayTick / getStrongest |
| **ObsessionSystem** | Worker 内 | NPC 执念（先天+后天），产出高优先 Goal（ADR-019） | add / toGoals |
| **EmotionSystem** | Worker 内 | NPC 情绪，作为 Utility 乘子调制 Goal（ADR-019） | onMemoryEvent / modulateGoal |
| **EntityRegistry** | Worker 内 | 全局实体注册表，按类型索引 | register / getById / getByType |
| **ItemRegistry** | Worker 内 | 物品定义注册表（单例） | get / loadFromArray |
| **NeedPool** | Worker 内 | 需求模板注册表 | create / loadFromArray |
| **ActionPool** | Worker 内 | 行为模板注册表 | create / loadFromArray |
| **Renderer** | 主线程 | Canvas 大地图渲染 | 接收世界快照 → 绘制画面 |
| **UIManager** | 主线程 | DOM 面板交互 | 事件弹窗、日志、状态栏 |
| **SaveManager** | 主线程 | IndexedDB 存档管理 | 存 / 读 / 删 / 导出导入 |

## 数据流

```
玩家操作
    │
    ▼
UIManager ──捕获操作──▶ GameManager ──postMessage──▶ WorldEngine
                                                        │
                                                   演化计算（Tick）
                                                        │
                                                   演化结果
                                                        │
                        GameManager ◀──postMessage──────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          Renderer      UIManager     SaveManager
         (更新地图)    (更新日志/弹窗)  (自动存档)
```

## 通信协议

主线程与 Worker 之间通过 `postMessage` 通信，消息格式统一为：

```javascript
{
  type: "ACTION_TYPE",   // 消息类型枚举
  payload: { ... }       // 数据负载
}
```

详见 `design-patterns.md` 中的消息总线设计。
