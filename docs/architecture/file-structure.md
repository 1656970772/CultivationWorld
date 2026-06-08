# 项目文件结构

> 最后更新：2026-06-08

## 总体原则

- `apps/game/` 是游戏运行时和模拟工具。
- `apps/editor/` 是数据编辑器和 Tauri 桌面壳。
- `docs/` 只保留当前文档、ADR、系统说明、数据规范和世界观资料。
- `apps/game/data/` 是运行时数据单一来源；`apps/editor/data/` 是编辑器模板数据。

## 当前结构

```text
CultivationWorld/
├── AGENTS.md
├── start-game-web.cmd
├── start-editor-web.cmd
├── start-editor-dev.cmd
├── apps/
│   ├── game/
│   │   ├── index.html
│   │   ├── simulation.html
│   │   ├── serve.py
│   │   ├── package.json
│   │   ├── css/
│   │   │   ├── style.css
│   │   │   └── simulation.css
│   │   ├── data/
│   │   │   ├── abilities/
│   │   │   ├── actions/
│   │   │   ├── balance/
│   │   │   ├── behavior-trees/
│   │   │   ├── config/
│   │   │   ├── definitions/
│   │   │   ├── economy/
│   │   │   ├── effects/
│   │   │   ├── entities/
│   │   │   ├── goals/
│   │   │   ├── items/
│   │   │   ├── jobs/
│   │   │   ├── needs/
│   │   │   ├── quests/
│   │   │   ├── relationships/
│   │   │   ├── tags/
│   │   │   ├── toils/
│   │   │   └── world/
│   │   ├── js/
│   │   │   ├── main.js
│   │   │   ├── simulation-main.js
│   │   │   ├── core/
│   │   │   ├── engine/
│   │   │   ├── renderer/
│   │   │   ├── storage/
│   │   │   └── ui/
│   │   └── tools/
│   └── editor/
│       ├── data-editor.html
│       ├── serve.py
│       ├── package.json
│       ├── css/
│       ├── data/
│       ├── js/editor/
│       ├── src-tauri/
│       ├── desktop-dist/
│       └── tools/
└── docs/
```

## 游戏代码目录

| 路径 | 职责 |
|------|------|
| `apps/game/js/core/` | 配置加载、事件总线、常量、GameManager、图谱构建 |
| `apps/game/js/engine/abstract/` | 实体、状态、需求、行为、GOAP、BT、GAS、记忆/情绪/执念等抽象层 |
| `apps/game/js/engine/combat/` | 统一伤害管线与能力执行器 |
| `apps/game/js/engine/economy/` | 统一经济交易底座：资产适配、估价、托管、原子交割、账本、债务、经济信号和抽象拍卖 |
| `apps/game/js/engine/faction/` | 势力实体、状态、需求和行为执行器 |
| `apps/game/js/engine/items/` | 物品定义、注册表和交易 |
| `apps/game/js/engine/monster/` | 妖兽实体、生成器、属性模板计算、资源掉落、行为树预设 |
| `apps/game/js/engine/npc/` | NPC 实体、状态、需求、生命周期、目标、Utility、动态目标、打断策略 |
| `apps/game/js/engine/npc/actions/` | NPC 行为执行器，按修炼/经济/战斗/关系/事件等业务拆分 |
| `apps/game/js/engine/npc/toils/` | NPC Job/Toil 执行器，按核心/动态事件/经济/社交拆分 |
| `apps/game/js/engine/pools/` | Need / Action / Job / Toil / Effect / Ability 模板池 |
| `apps/game/js/engine/quest/` | 通用任务板：任务仓储、状态机、可见性策略、去重策略、任务来源策略和交付处理器；不属于门派专用模块；本实施计划目标结构，后续实现新增 |
| `apps/game/js/engine/relationship/` | 三层关系底座：账本仓储、事件解释、selector、表达式、effect operator、信号输出 |
| `apps/game/js/engine/sect/` | 门派运行：门派组织、宗门财政、悬赏托管、月俸库存压力、离宗倒闭规则；只注册宗门任务来源、门派运行规则和悬赏结算策略；本实施计划目标结构，后续实现新增 |
| `apps/game/js/engine/world/` | 世界实体、TickManager、地图、移动、寻路、关系、信息、机会点、动态事件 |
| `apps/game/js/engine/world/services/` | Tick 子服务：上下文、势力 AI、晋升、人口、死亡、信息、妖兽重生 |
| `apps/game/js/renderer/` | Canvas/Pixi 地图渲染、相机、地形、迷雾、自动模拟渲染；地图展示颜色读取数据 `presentation` |
| `apps/game/js/ui/` | 日志、状态栏、调试、图谱、事件、存档、地图图例；图例和缩略图展示元数据来自运行时数据 |
| `apps/game/tools/` | 单元验证、长程模拟、性能分析、行为验证脚本 |

## 游戏数据目录

| 路径 | 职责 |
|------|------|
| `data/entities/` | 初始势力与 NPC；势力/组织可在 `presentation` 中声明展示颜色、徽记和排序 |
| `data/definitions/` | 境界、地形、妖兽、妖兽属性模板、修士/妖兽战斗属性表、NPC 修炼功法定义、武器、姓名、宏观资源；门派组织模板和门派初始化 profile 属于本实施计划目标结构，后续实现新增；地形展示元数据写入 `terrains.json` 的 `presentation` |
| `data/items/` | 可持有物品，按 `currency/material/pill/artifact/talisman/technique` 拆分；其中 `technique` 是秘籍物品，不是 NPC 当前修炼功法定义 |
| `data/actions/` | 势力/NPC SimpleAction/NPC JobAction/Reaction/世界规则行为，以及 NPC 默认行为集 |
| `data/jobs/` | NPC Job 定义，按动态事件/经济/社交拆分 |
| `data/toils/` | Toil 定义，按核心/动态事件/经济/社交拆分 |
| `data/needs/` | 势力和 NPC 需求 |
| `data/goals/` | 动态目标配置 |
| `data/world/` | 地图、世界修正器、消息、机会点、动态事件 |
| `data/balance/` | 战斗、经济、修炼、社交、风险、关系、反应等数值；门派运行数值属于本实施计划目标结构，后续实现新增 |
| `data/economy/` | 统一经济交易底座配置，如交易场景倍率、托管默认值、正式/私人交易规则、拍卖参数和债务逾期参数 |
| `data/behavior-trees/` | NPC、势力、妖兽行为树 JSON |
| `data/tags/` | GameplayTag 登记表 |
| `data/effects/` | GameplayEffect 定义，加载时合并 |
| `data/abilities/` | GameplayAbility 定义 |
| `data/config/` | 游戏和 AI 系统级配置 |
| `data/quests/` | 任务模板 |
| `data/relationships/` | 三层关系全数据平台配置：schema、mark/tag/signal/event 字典、event hook、impact rule、signal rule、group 定义和旧边兼容 projections |

详细字段规范见 `docs/data/data-config-rules.md`。

## 编辑器目录

| 路径 | 职责 |
|------|------|
| `apps/editor/data-editor.html` | 编辑器 Web 入口 |
| `apps/editor/js/editor/` | 数据扫描、schema 推断、表单、地图编辑、校验、Tauri 适配 |
| `apps/editor/src-tauri/` | Tauri 2 Rust 后端，负责项目目录、JSON 读写、备份、校验 |
| `apps/editor/data/schemas/` | 数据集注册表、字段 schema 和引用关系配置 |
| `apps/editor/data/templates/` | 新增记录模板 |
| `apps/editor/data/ui/` | 数据集分类、排序和展示配置 |
| `apps/editor/data/adapters/` | 地图编辑器等专用编辑体验的声明式适配配置 |
| `apps/editor/desktop-dist/` | 可再生前端打包输出 |
| `apps/editor/tools/` | 编辑器构建和验证脚本 |

## 清理规则

| 类型 | 路径 | 处理方式 |
|------|------|----------|
| 可再生输出 | `apps/editor/desktop-dist/` | 可删除后由 `npm run editor:prepare` 重建 |
| 本地依赖缓存 | `node_modules/`、`src-tauri/target/` | 不作为源码文档维护 |
| 模拟报告输出 | `apps/game/tools/report*.html`、`report-data.js` | 可按需要重跑生成 |
| 文档历史计划 | `旧实施计划目录（已清理）`、`旧执行计划目录（已清理）` | 已清理；机制结论以 ADR 和系统文档为准 |

