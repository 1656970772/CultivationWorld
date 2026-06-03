# ADR-045：物品定义按 category 拆分为多文件 + 加载时合并

最后更新：2026-06-03

状态：已采纳并实施（2026-06-03）。纯文件组织调整，内容/字段/ID/数值与拆分前逐一等价，确定性指纹 `1169158b` 零漂移。

> 关联：[ADR-044](adr-044-concrete-items-and-subcategory.md)（具体道具 + subCategory）、[ADR-043](adr-043-item-resource-unified-taxonomy.md)（资源与物品统一分类）、[ADR-042](adr-042-gameplay-ability-system.md)（GAS 通用 Effect 原语化，EffectPool 合并加载 `effects/` 全部文件的先例）。

## 背景

`data/items/items.json` 单文件已累积 78 项、约 900+ 行，涵盖 6 个 category（currency/material/pill/artifact/talisman/technique）。单文件带来：

- 编辑时跨类别滚动、定位困难，合并冲突面大。
- 与 `effects/` 目录「按机制类型一目录多文件、加载合并」的既有约定不一致（ADR-042 已确立 EffectPool 合并加载 `effects/combat-effects.json` + `effects/core-effects.json`）。
- AGENTS.md「单一职责 / 有结构的配置」精神：同一 category 的物品应聚在一处，不同 category 物理分开。

## 决策

### 1. 按 category 拆分为 6 个文件

`items/items.json` → 拆为 `items/` 目录下每 category 一文件：

| 文件 | category | 项数 | 含 |
|------|----------|------|----|
| `currency.json` | currency | 4 | 四档灵石（机制必需泛类货币） |
| `material.json` | material | 36 | 泛 ID + 分级妖丹妖材 `_gN` + 具体天材地宝/灵草/精血/灵果/矿材(`mat_*`) + Effect 复用示例 |
| `pill.json` | pill | 8 | 机制丹(`item_qi_pill`/`item_breakthrough_pill`) + 具体丹药(`pill_*`) |
| `artifact.json` | artifact | 14 | 具体法宝(`artifact_*`)，含 gradeName + combatBonus |
| `talisman.json` | talisman | 5 | 能力符(`item_escape_talisman(_high)`) + 具体符箓(`talisman_*`) |
| `technique.json` | technique | 11 | 具体功法(`tech_*`)，含 gradeName |

各文件结构统一为 `{ "_description": "...", "items": [...] }`，合并后共 **78 项、无重复 ID**，与拆分前逐一等价（字段/数值/effects/grantsAbilities 原样迁移）。

### 2. 加载时显式列举 6 文件并合并（仿 effects/，非目录遍历）

下游 `WorldEngine`/`ItemRegistry` 期望单一 `itemDefs.items` 数组，故在加载层合并：

- **运行时** `js/core/config-loader.js`：在 `Promise.all` 中并行 `fetch` 这 6 个文件，再 `flatMap` 合并为 `itemDefs = { items: [...] }`。与同文件 effects 合并（combat + core）写法一致。
- **工具脚本**（14 个：`verify-determinism`/`verify-gas-combat`/`verify-effect-reuse`/`verify-promotion`/`verify-revenge-pursuit`/`perf-profile`/`trace-genius`/`simulate-analysis`/`refactor-baseline`/`test-info-propagation`/`test-quest-reward-economy`/`test-relationship-goals`/`test-monster-resource-loop`/`test-master-disciple`）：加载点统一改为
  `['currency','material','pill','artifact','talisman','technique'].flatMap(c => load(\`data/items/${c}.json\`).items)`。

**为何显式列举而非目录遍历**：浏览器 `fetch` 无法列目录；显式清单跨浏览器/Node 一致、可控加载顺序、与 `effects/` 既有约定统一。**代价**：新增 category 时需在加载器文件清单中登记（已在 `data-config-rules.md` 标注）。

### 3. 下游消费结构不变

`world-engine.js` 仍读 `configs.itemDefs.items` 调 `ItemRegistry.loadFromArray`，`ItemRegistry`/`ItemDefinition`/`npc-economy` 等零改动。

## 影响

- 物品配置可读性与可维护性提升；合并冲突面缩小到单 category。
- 加载逻辑新增「物品文件清单」单点（加载器），与 effects 清单对称。
- 不改变任何运行时语义。

## 验证（零漂移 + 真实模拟）

- 6 文件 JSON 合法、合并后 78 项无重复 ID（与原 `items.json` 一致）。
- `tools/verify-effect-reuse.mjs`：通过（聚气丹/灵果/强者精血/灵石多来源复用 `ge_add_qi` 等，数值各取自各自 effects）。
- `tools/verify-determinism.mjs`：seed=12345 指纹 `1169158b`（与拆分前一致，**零漂移**）；同种子复现、不同种子区分均通过。
- `tools/verify-gas-combat.mjs`（3 种子 × 800 天）：通过；锁血/遁地经统一管线生效，法宝/符箓战斗系统无退化。
