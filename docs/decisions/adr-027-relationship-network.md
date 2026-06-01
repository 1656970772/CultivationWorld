# ADR-027：关系网系统（NPC / 妖兽 / 势力统一关系图）

最后更新：2026-06-01

状态：已实现（第一期：数据层 + 事件驱动 + 可视化/存档，暂不驱动 NPC 决策）

## 背景

此前项目中"关系"散落在四处、彼此不联通，无法支撑"全量统一关系网 + 妖兽接入"：

- 个人恩怨：`apps/game/js/engine/npc/relationship.js` 的 `RelationshipGraph` 仅有 `grudge` / `gratitude` 两个**单向标量 Map**，无边类型、无双向、不含妖兽。
- 势力外交：`faction.state.relations`（-100~100 矩阵），见 ADR-015 / `combat.json`。
- 妖兽仇恨：`monster-state.js` 仅 `grudgeTargetId` 单个目标，无记忆/族群/阵营。
- 零散弱关系：`daoCompanionId`、职位 `role`、`childrenCount`，无师徒边、无子女 id 列表。

世界观参考支持把"关系"作为一等系统建模：

- `docs/世界观参考/凡人修仙传/人物关系与事件分析.md`：7 类核心关系（师徒/道侣/利益同盟/敌对/灵宠主仆/同门/交易），并给出信任度/背叛、隐秘关系暴露追杀等机制。
- `docs/世界观参考/凡人修仙传/妖兽与修士关系分析.md`、`docs/世界观参考/遮天/妖兽与修士关系分析.md`：人妖关系（领地守卫、灵药守卫、族群报复、化形建势力、半驯化共生、灵宠养成）。

## 决策

新增世界级 `RelationshipSystem`（单一真相源），统一管理所有实体之间的**有向带类型边**，覆盖三层：人际（NPC↔NPC）、人妖（NPC↔妖兽）、妖妖（妖兽↔妖兽）。与势力外交（`faction.state.relations`）**分层**：本系统是个人/族群层关系，势力层仍走 `combat.json`。

### 一、统一关系模型

- `RelationType` 枚举（`relationship-system.js`，与 `relationship.json` 的 `edgeTypes` 键对齐）：
  - 人际：`master` / `disciple` / `dao_companion` / `kin` / `same_sect` / `ally` / `rival` / `enemy` / `benefactor` / `grudge` / `gratitude`
  - 人妖：`spirit_pet` / `mount` / `beast_grudge` / `territory_threat`
  - 妖妖：`pack_member` / `pack_leader` / `beast_rival`
- `RelationEdge { fromId, toId, type, affinity(-100~100), strength(0~100), originTick, originEventType }`。
- 边按 `fromId → Map<"toId|type", edge>` 分桶存储，便于"某实体对谁有什么关系"查询。
- 对称类型（道侣/血亲/同门/盟友/同群）通过 `symmetricType` 自动建反向边。
- 强度语义：显式 `strengthDelta` 的边按增量累积（grudge/gratitude/enemy），无 delta 的边用类型默认 `strength`（master/dao_companion 等定值型）。

### 二、与既有个人恩怨图的兼容（重构而非另起一套）

`RelationshipGraph` 重构为 `RelationshipSystem` 的**兼容查询视图**：

- 绑定模式（NPC 持有，构造传入 `{ system, ownerId }`）：`grudge` / `gratitude` 读写委托给世界级系统，表达为 `type='grudge'/'gratitude'` 的边。
- 独立模式（无 system，如单测 `new RelationshipGraph()`）：回退内部 Map，行为与 ADR-019 完全一致。
- 对外接口（`addGrudge` / `getGrudge` / `topGrudge` 等）保持不变，故复仇链（`tick-manager._resolveRevengeTarget → npc.relationships.topGrudge()`）**零改动**。

### 三、事件驱动更新（不改 Tick 主骨架）

在 `tick-manager.js` 既有事件结算点旁挂关系更新（`relationship.json` 的 `eventBindings` 数据驱动方向与强度）：

| 事件结算点 | 关系边 |
|------------|--------|
| 势力攻战（败方写 `attacked` 记忆处） | 败方成员 → 攻方成员 `enemy` |
| 道侣陨落（`companion_lost`） | 凶手 grudge（由 `recordMemory` 经兼容路径写入，不重复） |
| 抢夺受辱 / 夺职受辱（`humiliated`） | 受害者 → 加害者 `rival`（grudge 由记忆写入） |
| 被贬谪（`demoted`） | 被贬者 → 势力领袖 `rival` |
| 道侣匹配 | 双向 `dao_companion` |
| 生育 | 父母 ↔ 子女 `kin` |
| 妖兽被反击设 `grudgeTargetId` | 妖兽 → NPC `beast_grudge`（经 `worldContext.recordMonsterGrudge`） |

`RelationshipSystem.tick()` 挂在 `_updateRelations`（步骤 8）旁，按 `decay` 向 `decayFloor` 衰减边强度，归零边清理。妖兽死亡时 `_collectDeaths` 调 `removeEntity` 清理其出入边。

### 四、初始关系

`relationship-init.js` 据 `npcs.json` 的 `factionId + role` 推导：

- `same_sect`：同势力弟子两两互建（带 `maxPerFaction` 规模护栏）。
- `master` / `disciple`：同势力内 `leader`/`elder` 按境界就近收 `disciple`/`outer_disciple` 为徒。

势力外交沿用 `factions.json`，不在本系统重复。

### 五、可视化与存档

- `graph-builder.js` 新增 `RELATIONSHIP` 边类型与 `buildRelationshipEdges()`，把关系网注入关系图（`graph-panel.js` 实时刷新）；妖兽等无节点的实体按需建轻量节点。
- `WorldEngine.getWorldSnapshot()` 输出 `relationships`（扁平边数组）与 `relationshipStats`，经 `SaveManager` 序列化进存档；`RelationshipSystem.snapshot()/loadFrom()` 提供世界级（再）水化。

### 六、明确不做范围（第一期）

不新增关系驱动的 Goal/行为（护短同门、探望恩人、追杀仇人、妖兽护巢护群等）；不实现信任度/背叛、隐秘关系暴露追杀、灵宠养成/反噬、化形妖兽建势力、妖群/领地自动建边。详见 `docs/worldbuilding/wiki/characters/relationship-todo.md`。

## 数据与接口

- `apps/game/data/balance/relationship.json`：`edgeTypes`（类型/默认 affinity/strength/decay/对称性）、`eventBindings`（事件→边）、`init`（初始关系规则）。`enabled` 可整体停用。
- `apps/game/js/engine/world/relationship-system.js`：`RelationshipSystem` + `RelationType`。
- `apps/game/js/engine/world/relationship-init.js`：`initRelationships()`。
- `apps/game/js/engine/npc/relationship.js`：`RelationshipGraph` 重构为兼容视图。
- `apps/game/js/engine/npc/npc-entity.js`：构造时绑定 `relationshipSystem`。
- `apps/game/js/engine/world/tick-manager.js`：`_applyRelationEvent` / `_addRelationEvent` 封装 + 各事件钩子 + `relationshipSystem.tick()` + 妖兽死亡清理 + `worldContext.recordMonsterGrudge`。
- `apps/game/js/engine/monster/monster-entity.js`：被反击时落 `beast_grudge` 边。
- `apps/game/js/engine/world-engine.js`：创建 `relationshipSystem`、注入 `_entityConfig`、初始化关系、快照输出。
- `apps/game/js/core/config-loader.js`：加载 `balanceRelationship`。
- `apps/game/js/core/graph-builder.js` / `apps/game/js/ui/graph-panel.js`：关系边可视化。

## 后果

- 关系从四处零散字段统一为单一真相源的有向带类型图，妖兽/势力/个人三层贯通。
- 全部数据驱动，调参不改代码；复仇链等既有逻辑零改动（兼容视图）。
- 200 天端到端模拟：关系自然涌现（同门 1386、道侣、血亲、宿敌、竞争、妖兽仇敌等），核心 AI 黄金指纹与目标等价性回归全部通过（无行为漂移）。

## 验证

- `node apps/game/tools/test-relationship.mjs`（边一致性/对称/累加/衰减/清理/快照/兼容层/初始化，30 项）
- `node apps/game/tools/test-revenge.mjs`、`test-memory.mjs`、`test-obsession.mjs`（兼容层不破坏既有恩怨链）
- `node apps/game/tools/test-goal-equivalence.mjs`、`test-goap-golden.mjs`（核心决策零漂移）
- `node apps/game/tools/simulate-analysis.mjs --days=200`（端到端无报错）

## 相关

- ADR-019（长期心智：记忆/执念/情绪/个人恩怨）——本系统重构其 `RelationshipGraph`。
- ADR-020（Consideration Utility + 复仇 PvP）——复仇链依赖 `topGrudge`，零改动延续。
- ADR-015（宗门资源与晋升）、ADR-024（信息传播与机会点）——后续关系驱动 Goal 的接入基础。
- 世界观参考：凡人修仙传（7 类关系 / 妖兽资源与共生）、遮天（半驯化/混血/禁区守卫）。
