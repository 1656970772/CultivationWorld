# 项目文件结构

> 最后更新：2026-05-30

## 总体原则

项目按应用边界收拢到 `apps/` 目录：

- `apps/game/`：纯网页游戏运行时，面向玩家和玩法调试。
- `apps/editor/`：Win 端 Tauri 数据编辑器，面向数据生产、校验、保存和打包。
- 根目录只保留项目级规则、文档、记忆和隐藏配置。

## 当前结构

```text
WorldDymnic-Cursor/
├── .cursor/                           # Cursor 项目规则
├── apps/
│   ├── game/                          # 游戏 Web 端
│   │   ├── package.json               # 游戏脚本：serve / test / generate-map
│   │   ├── serve.py                   # 游戏本地静态服务，默认端口 8888
│   │   ├── index.html                 # 游戏入口
│   │   ├── css/
│   │   │   └── style.css              # 游戏 UI 样式
│   │   ├── data/                      # 游戏运行时 JSON 数据（五子目录详见下方）
│   │   ├── js/
│   │   │   ├── main.js                # 游戏启动入口
│   │   │   ├── simulation-main.js     # 模拟器启动入口
│   │   │   ├── core/                  # GameManager、事件总线、常量
│   │   │   ├── engine/                # 需求驱动世界模拟引擎（v2）
│   │   │   │   ├── abstract/          # 抽象核心层
│   │   │   │   │   ├── base-entity.js         # 实体基类（组合模式）
│   │   │   │   │   ├── static-data.js         # 静态数据基类（享元）
│   │   │   │   │   ├── runtime-state.js       # 运行时状态（可观察）
│   │   │   │   │   ├── need.js                # 需求基类 + 评估器接口
│   │   │   │   │   ├── need-system.js         # 需求管理器
│   │   │   │   │   ├── action.js              # 原子行为（命令模式）
│   │   │   │   │   ├── behavior-system.js     # 行为执行器
│   │   │   │   │   ├── goap-planner.js        # GOAP 规划器（A*）
│   │   │   │   │   ├── inventory.js           # 物品容器
│   │   │   │   │   └── entity-registry.js     # 全局实体注册表
│   │   │   │   ├── items/             # 物品系统
│   │   │   │   │   ├── item-definition.js
│   │   │   │   │   ├── item-registry.js
│   │   │   │   │   └── item-transaction.js
│   │   │   │   ├── pools/             # 需求池 & 行为池
│   │   │   │   │   ├── need-pool.js
│   │   │   │   │   └── action-pool.js
│   │   │   │   ├── faction/           # 势力具体实现
│   │   │   │   │   ├── faction-entity.js
│   │   │   │   │   ├── faction-static-data.js
│   │   │   │   │   ├── faction-state.js
│   │   │   │   │   ├── faction-needs.js
│   │   │   │   │   └── faction-actions.js
│   │   │   │   ├── npc/               # NPC 具体实现
│   │   │   │   │   ├── npc-entity.js
│   │   │   │   │   ├── npc-static-data.js
│   │   │   │   │   ├── npc-state.js
│   │   │   │   │   ├── npc-needs.js
│   │   │   │   │   └── npc-actions.js
│   │   │   │   ├── world/             # 世界实体
│   │   │   │   │   ├── world-entity.js
│   │   │   │   │   ├── world-state.js
│   │   │   │   │   ├── world-rules.js
│   │   │   │   │   └── tick-manager.js
│   │   │   │   ├── world-engine.js            # 引擎主入口
│   │   │   │   └── world-engine.worker.js     # Worker 入口
│   │   │   ├── renderer/              # Canvas 地图渲染
│   │   │   ├── storage/               # IndexedDB 存档
│   │   │   └── ui/                    # 游戏 UI 面板
│   │   └── tools/
│   │       ├── generate-map.cjs       # 生成地图数据
│   │       ├── test-engine.mjs        # 世界引擎冒烟测试
│   │       ├── simulate-world.mjs     # 自动世界模拟报告
│   │       └── test-*.mjs             # 模拟稳定性测试
│   │
│   └── editor/                        # Win/Tauri 数据编辑器
│       ├── package.json               # 编辑器脚本：editor:serve / editor:build 等
│       ├── package-lock.json
│       ├── node_modules/              # 本地依赖缓存，不作为源码提交
│       ├── serve.py                   # 编辑器本地静态服务，默认端口 8889
│       ├── data-editor.html           # 编辑器入口
│       ├── css/
│       │   └── data-editor.css        # 编辑器样式
│       ├── data/                      # 编辑器默认模板数据
│       ├── js/
│       │   └── editor/                # 编辑器 UI、schema、校验、Tauri 适配
│       ├── src-tauri/                 # Tauri 2 + Rust 后端工程
│       ├── desktop-dist/              # Tauri 前端资源输出，可重建
│       ├── artifacts/                 # 本地截图和视觉验证产物
│       └── tools/
│           ├── build-tauri-frontend.mjs
│           └── test-*.mjs
│
├── docs/                              # 项目文档
├── Memory/                            # 对话记录
├── start-game-web.cmd                 # 双击启动游戏网页预览
├── start-editor-dev.cmd               # 双击启动 Win 编辑器开发模式
├── start-editor-web.cmd               # 双击启动编辑器网页快速预览
├── .gitignore
└── AGENTS.md
```

## 应用边界

| 应用 | 入口 | 运行方式 | 数据目录 |
|------|------|----------|----------|
| 游戏 Web 端 | `apps/game/index.html` | 在 `apps/game/` 中运行 `npm run serve` 或 `python serve.py` | `apps/game/data/` |
| Win 端编辑器 | `apps/editor/data-editor.html` | 在 `apps/editor/` 中运行 `npm run editor:serve`、`npm run editor:dev` 或 `npm run editor:build` | `apps/editor/data/`，也可打开外部项目 `data/` |

## 目录职责

| 目录 | 职责 | 关键原则 |
|------|------|----------|
| `apps/game/js/core/` | 游戏协调层和共享常量 | 通过事件总线协调，不耦合 UI 细节 |
| `apps/game/js/engine/` | 世界演化业务逻辑 | Worker 内运行，不访问 DOM |
| `apps/game/js/renderer/` | Canvas 主地图渲染 | 只读取世界快照，不修改世界状态 |
| `apps/game/js/ui/` | 游戏 DOM 面板 | 通过 EventBus 与 GameManager 通信 |
| `apps/game/js/storage/` | 游戏存档 | 只负责序列化、反序列化和 IndexedDB |
| `apps/game/data/` | 游戏发行数据 | JSON 数据驱动，保持运行时可直接读取 |
| `apps/game/data/definitions/` | 静态定义（境界、资源、地形） | 全局共享的类型与枚举，不含实例数据 |
| `apps/game/data/world/` | 世界配置（地图、修正器） | 世界层初始数据与全局事件配置 |
| `apps/game/data/entities/` | 实体实例（势力、NPC） | 初始实体数据，每个实体一条记录 |
| `apps/game/data/needs/` | AI 需求池配置 | 势力/NPC 需求定义与评估规则 |
| `apps/game/data/actions/` | AI 行为池与世界规则 | GOAP 行为配置与世界规则 |
| `apps/editor/js/editor/` | 数据编辑器前端 | 表单、地图编辑、校验、Tauri 适配集中在编辑器项目内 |
| `apps/editor/src-tauri/` | 编辑器 Rust 后端 | 只服务编辑器，不参与游戏运行时 |
| `apps/editor/desktop-dist/` | 编辑器打包输出 | 由 `npm run editor:prepare` 生成，不手写维护 |
| `docs/` | 架构、设计、ADR 和计划 | 新增文档时同步 `docs/README.md` |

## 游戏数据分层

`apps/game/data/` 按数据职责分为五个子目录，详细配置规则见 `docs/data/data-config-rules.md`：

```text
data/
├── definitions/              # 静态定义层 — 全局类型与枚举
│   ├── ranks.json            # 境界/职位/寿元静态表
│   ├── resources.json        # 资源类物品定义（灵石、弟子、粮食等）
│   └── terrains.json         # 地形类型定义
├── world/                    # 世界层 — 地图与全局状态
│   ├── map.json              # 300×300 世界地图（90,000 格）
│   └── modifiers.json        # 世界修正器/事件定义
├── entities/                 # 实体层 — 初始实体实例数据
│   ├── factions.json         # 势力初始数据
│   └── npcs.json             # NPC 初始数据
├── needs/                    # 需求层 — AI 需求池配置
│   ├── faction-needs.json    # 势力需求定义
│   └── npc-needs.json        # NPC 需求定义
└── actions/                  # 行为层 — AI 行为池与世界规则
    ├── faction-actions.json  # 势力行为（GOAP 动作）
    ├── npc-actions.json      # NPC 行为
    └── world-rules.json      # 世界规则
```

## 清理规则

| 类型 | 路径 | 处理规则 |
|------|------|----------|
| 依赖缓存 | `apps/editor/node_modules/`、`apps/editor/src-tauri/target/` | 可本地保留以加快构建，不作为源码提交 |
| 可再生输出 | `apps/editor/desktop-dist/` | 可删除后通过 `npm run editor:prepare` 重建 |
| 临时文件 | `*.log`、`__pycache__/`、`*.pyc` | 可直接删除 |
| 视觉验证产物 | `apps/editor/artifacts/` | 可保留用于对比，也不作为核心源码 |
