# 修仙世界模拟器 —— 文档中心

> 项目代号：WorldDynamic  
> 创建日期：2026-05-23  
> 最后更新：2026-06-06（新增修士战斗属性体系规格与世界观 Wiki 条目；记录妖兽属性模板与境界清理 ADR、系统文档和数据模型）

## 当前事实

以下信息来自当前代码与数据文件：

- 游戏运行时入口：`apps/game/index.html`；自动模拟入口：`apps/game/simulation.html`。
- 编辑器入口：`apps/editor/data-editor.html`；桌面壳为 Tauri 2 + Rust。
- 地图：`apps/game/data/world/map.json`，300×300，共 90,000 格。
- 初始实体：`apps/game/data/entities/factions.json` 有 16 个势力/组织；`apps/game/data/entities/npcs.json` 有 126 个初始 NPC。
- 妖兽定义：`apps/game/data/definitions/monsters.json` 有 36 条。
- 可持有物品：`apps/game/data/items/` 按 category 拆分，加载后合并为 74 项。

## 阅读顺序

1. `overview.md`：项目定位、当前实现范围和运行方式。
2. `architecture/system-overview.md`：主线程、Worker、引擎、编辑器的边界。
3. `architecture/file-structure.md`：当前源码和数据目录结构。
4. `data/data-config-rules.md`：`apps/game/data/` 的现行配置规范。
5. `systems/`：各运行时子系统设计。
6. `data-models/`：核心 JSON 数据模型。
7. `worldbuilding/` 与 `worldbuilding/wiki/`：世界观、规则和已敲定设定。
8. `decisions/`：ADR 架构与机制决策历史。

## 文档结构

```text
docs/
├── README.md
├── overview.md
├── architecture/
│   ├── system-overview.md
│   ├── file-structure.md
│   ├── design-patterns.md
│   └── reference-acs-rimworld.md
├── data/
│   └── data-config-rules.md
├── data-models/
│   ├── world-map.md
│   ├── faction.md
│   ├── npc.md
│   ├── monster.md
│   ├── ranks.md
│   ├── player.md
│   ├── relationship.md
│   ├── info-propagation.md
│   ├── behavior-configs.md
│   └── world-modifiers.md
├── systems/
│   ├── behavior-tree.md
│   ├── job-toil-ai-spec.md
│   ├── event-system.md
│   ├── faction-ai.md
│   ├── gameplay-ability-system.md
│   ├── info-sense.md
│   ├── item-covet.md
│   ├── monster-attribute-templates.md
│   ├── opportunity-system.md
│   ├── renderer.md
│   ├── save-system.md
│   ├── stability.md
│   ├── time-action.md
│   ├── ui.md
│   └── world-tick.md
├── balance/
│   └── simulation-iteration-process.md
├── decisions/
│   └── adr-001..adr-052-*.md
├── superpowers/
│   ├── specs/
│   │   ├── 2026-06-05-Job-Toil正式启用前收尾规格.md
│   │   ├── 2026-06-05-StoryGraph小说图谱设计.md
│   │   ├── 2026-06-05-StoryGraph单作品本地索引库规格.md
│   │   ├── 2026-06-05-妖兽伤害与斩妖历练修为规格.md
│   │   ├── 2026-06-06-妖兽属性模板与境界清理-design.md
│   │   └── 2026-06-06-修士战斗属性体系-design.md
│   ├── plans/
│   │   ├── 2026-06-05-ADR-050-收尾实施计划.md
│   │   ├── 2026-06-05-Job-Toil-AI重构实施计划.md
│   │   ├── 2026-06-05-妖兽伤害斩妖Job修为实施计划.md
│   │   ├── 2026-06-06-NPC战斗智能闭环补完实施计划.md
│   │   ├── 2026-06-06-NPC战斗智能闭环-阶段1-Reaction即时战斗.md
│   │   ├── 2026-06-06-NPC战斗智能闭环-阶段2-GOAP风险分支.md
│   │   ├── 2026-06-06-NPC战斗智能闭环-阶段3-路线与目标重定向.md
│   │   ├── 2026-06-06-NPC战斗智能闭环-阶段4-组队斩妖.md
│   │   ├── 2026-06-06-NPC战斗智能闭环-阶段5-统一战斗与历练修为.md
│   │   ├── 2026-06-06-NPC战斗智能闭环-阶段6-任务实例与总验证.md
│   │   ├── 2026-06-05-StoryGraph单作品本地索引库实施计划.md
│   │   ├── 2026-06-05-StoryGraph小说图谱MVP实施计划.md
│   │   ├── 2026-06-05-跟随角色状态面板实施计划.md
│   │   ├── 2026-06-06-妖兽属性模板与境界清理实施计划.md
│   │   └── 2026-06-06-提交前收尾修复计划.md
│   └── reports/
│       ├── 2026-06-05-Job-Toil启用前验证.md
│       ├── 2026-06-05-Job-Toil默认启用验证.md
│       └── 2026-06-06-NPC战斗智能闭环验证.md
├── worldbuilding/
│   ├── README.md
│   ├── continent.md
│   ├── factions.md
│   ├── npcs.md
│   ├── history.md
│   ├── relations.md
│   └── wiki/
└── 世界观参考/
    └── 模板/
```

## 关键文档

| 主题 | 文档 |
|------|------|
| 当前项目状态 | `overview.md` |
| 运行时架构 | `architecture/system-overview.md` |
| 文件结构 | `architecture/file-structure.md` |
| 数据配置 | `data/data-config-rules.md` |
| AI 架构 | `systems/behavior-tree.md`、`systems/job-toil-ai-spec.md`、`decisions/adr-048-four-layer-reactive-ai.md`、`decisions/adr-050-goap-job-toil-layered-ai.md` |
| Job/Toil 正式启用 | `superpowers/specs/2026-06-05-Job-Toil正式启用前收尾规格.md`、`superpowers/plans/2026-06-05-ADR-050-收尾实施计划.md`、`superpowers/reports/2026-06-05-Job-Toil默认启用验证.md` |
| Job/Toil 实施计划 | `superpowers/plans/2026-06-05-Job-Toil-AI重构实施计划.md` |
| 动态事件/动态目标 | `systems/event-system.md`、`decisions/adr-049-dynamic-goal-interrupt-policy.md` |
| GAS 机制资产 | `systems/gameplay-ability-system.md`、`decisions/adr-042-gameplay-ability-system.md` |
| 妖兽属性模板与境界清理 | `superpowers/specs/2026-06-06-妖兽属性模板与境界清理-design.md`、`superpowers/plans/2026-06-06-妖兽属性模板与境界清理实施计划.md`、`decisions/adr-052-monster-templates-and-rank-cleanup.md`、`systems/monster-attribute-templates.md`、`data-models/monster.md` |
| 物品与怀璧其罪 | `systems/item-covet.md`、`decisions/adr-025-item-covet-system.md` |
| 信息传播与机会点 | `systems/opportunity-system.md`、`decisions/adr-024-info-propagation-opportunity.md` |
| 世界观 Wiki | `worldbuilding/wiki/README.md` |
| 世界观参考调研模板 | `世界观参考/模板/README.md` |
| 世界观参考原文补充修正计划 | `superpowers/plans/2026-06-05-世界观参考原文补充修正计划.md` |
| StoryGraph 小说图谱设计 | `superpowers/specs/2026-06-05-StoryGraph小说图谱设计.md` |
| StoryGraph 单作品本地索引库规格 | `superpowers/specs/2026-06-05-StoryGraph单作品本地索引库规格.md` |
| StoryGraph 小说图谱 MVP 实施计划 | `superpowers/plans/2026-06-05-StoryGraph小说图谱MVP实施计划.md` |
| StoryGraph 单作品本地索引库实施计划 | `superpowers/plans/2026-06-05-StoryGraph单作品本地索引库实施计划.md` |
| 跟随角色状态面板 | `superpowers/plans/2026-06-05-跟随角色状态面板实施计划.md` |
| 妖兽伤害、斩妖任务与历练修为规格 | `superpowers/specs/2026-06-05-妖兽伤害与斩妖历练修为规格.md` |
| 妖兽伤害斩妖 Job 修为实施计划 | `superpowers/plans/2026-06-05-妖兽伤害斩妖Job修为实施计划.md` |
| 修士战斗属性体系 | `superpowers/specs/2026-06-06-修士战斗属性体系-design.md`、`worldbuilding/wiki/rules/combat-attributes-and-realms.md` |
| NPC 战斗智能闭环补完实施计划 | `superpowers/plans/2026-06-06-NPC战斗智能闭环补完实施计划.md`（总入口；阶段 1-6 文档位于同目录） |
| NPC 战斗智能闭环验证报告 | `superpowers/reports/2026-06-06-NPC战斗智能闭环验证.md` |
| 数值修为与 NPC Action Job 化迁移 | `decisions/adr-051-numeric-cultivation-and-job-action-migration.md` |
| 提交前收尾修复计划 | `superpowers/plans/2026-06-06-提交前收尾修复计划.md` |

## 清理原则

- 旧实施计划、旧执行计划、旧待办文档、调参备份和调参流水账已删除；对应结论以 ADR、系统文档和当前数据为准。
- ADR 保留历史决策，不当作当前配置清单；当前事实以代码和 `apps/game/data/` 为准。
- `docs/世界观参考/` 是世界观设定来源库，按项目规则保留。

## 维护规则

- 新增或修改文档时，在文件头部更新“最后更新”日期。
- 新增数据文件时，同步更新 `data/data-config-rules.md`。
- 新增架构或机制决策时，使用 ADR 格式写入 `decisions/`。
- 世界观决策落地到 `worldbuilding/wiki/`，并标明来源。
- 世界观参考调研文档新增或重写时，优先使用 `世界观参考/模板/` 下的对应模板。

