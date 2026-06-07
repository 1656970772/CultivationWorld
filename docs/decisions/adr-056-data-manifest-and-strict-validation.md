# ADR-056：数据清单与严格校验

最后更新：2026-06-08

## 状态

已决策，分阶段实施并由主代理做最终整体验收。

本 ADR 记录数据清单、严格校验、资源注册、关系投影、编辑器数据集/适配器和展示元数据配置化的目标架构。不同 worker 可按职责边界拆分实现，但最终必须汇总到同一套配置化正式路径，不能留下代码内固定清单或旧数据镜像。

## 背景

项目已经形成大量数据驱动机制，但仍存在两类风险：

1. 运行时数据文件、合并目录和校验入口分散在加载器、文档和工具脚本中，新增文件时容易遗漏加载或校验。
2. 资源、旧关系边投影、编辑器地图字段和数据集列表曾由代码内固定表维护，新增规则时容易退回硬编码。
3. UI 展示颜色、图例、badge、地形图标和排序曾散落在 UI/渲染代码中，新增地形或势力需要修改代码，违背开闭原则。

这些问题会让“新增配置”退化成“新增代码分支”，并使验证结果依赖人工记忆。

## 决策

1. 引入数据 manifest 作为运行时数据文件和合并规则的清单来源。加载器和校验器应优先读取 manifest，而不是在多个模块里重复列举文件。
2. 严格校验成为配置变更的默认路径。新增或修改数据时，应验证 ID 命名、引用完整性、目录归属、必填字段、展示元数据和机制资产前缀。
3. `ResourceRegistry` 是宏观资源、货币资源和组织点数的统一解释入口。势力状态、经济资产适配和交易结算不得维护固定资源白名单。
4. 旧 ADR-027 关系边 API 的兼容投影写入 `apps/game/data/relationships/projections/legacy-edge-projections.json`。三层账本 mark/tag 与旧边类型的双向映射应来自配置，不再留在 `RelationshipSystem` 代码内。
5. 编辑器以 `apps/editor/data/schemas/*.json` 管理 Dataset/Field/Reference Registry，以 `apps/editor/data/adapters/*.json` 管理地图编辑器等专用适配。`apps/editor/data/` 不保存运行时数据镜像。
6. UI 展示元数据写入数据对象的 `presentation` 字段。地形使用 `presentation.color`、`presentation.icon`、`presentation.order`；势力/组织使用 `presentation.color`、`presentation.badge`、`presentation.order`。
7. UI 和渲染代码不得为具体势力 ID、具体地形列表或展示颜色维护固定表。缺失展示元数据时可以使用中性兜底以避免崩溃，但正式配置应由严格校验暴露并修复。
8. 验证报告记录真实命令输出、真实行为观察字段和遗留风险，不使用摘要值或二进制一致性作为功能正确性的证据。

## 影响

- 新增地形、势力或组织时，维护者只改数据配置即可影响地图图例、缩略图和 TileRenderer 展示。
- manifest 与严格校验完成后，配置文件遗漏、跨文件引用错误和展示元数据缺失应在审计阶段暴露。
- 新增资源、旧关系兼容投影、编辑器数据集或地图 tile 字段时，维护者优先改配置资产和校验规则，不修改核心服务分支。
- 文档导航需要同时指向实施计划、ADR 和验证报告，避免只在对话中沉淀架构决策。

## 验收关注

- `apps/game/data/definitions/terrains.json` 中地形展示颜色、图标和排序来自 `presentation`。
- `apps/game/data/entities/factions.json` 中势力/组织展示颜色、徽记和排序来自 `presentation`。
- `MapLegend`、`Minimap`、`TileRenderer` 不再维护固定势力 ID 颜色表或固定地形图例列表。
- `data-manifest.json` 覆盖运行时目录组，`game-data-validator.js` 能阻止缺引用和未登记配置进入默认流程。
- `ResourceRegistry` 覆盖宏观资源、货币和组织点数，相关业务代码不再维护硬编码白名单。
- `legacy-edge-projections.json` 已补齐，并由 Runtime worker 或主代理确认 `RelationshipSystem` 实际读取该配置。
- `map-editor.json` 已补齐，并由 Editor worker 或主代理确认地图编辑器实际读取该 adapter。
- 最终验收由主代理补全，并在验证报告中记录命令、退出码、真实行为观察和仍未接入的风险。
