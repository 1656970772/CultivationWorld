# ADR-043：资源与物品统一分类体系（灵石可货币可服用）

最后更新：2026-06-03

状态：已采纳并实施（2026-06-03）。零漂移（指纹 `1169158b` 不变），多种子长程模拟通过。

> 关联：[ADR-006](adr-006-spirit-stone-unified-currency.md)（灵石统一计价）、[ADR-025](adr-025-item-covet-system.md)（可转移实物与怀璧其罪）、[ADR-042](adr-042-gameplay-ability-system.md)（GAS 通用 Effect 原语化）。

## 背景

历史上「资源」与「物品」分散在两个数据文件，分类标准不一致：

- `data/definitions/resources.json`（416 行）混入了：货币（灵石 currency）、势力宏观资源（粮食 supply / 弟子 population）、炼丹炼器材料（灵药/灵矿/妖丹/妖材 material）、**重复的丹药（consumable）**、符箓、阵旗、储物袋、功法秘籍。
- `data/items/items.json` 混入：材料、丹药（pill）、法宝（artifact）、符（talisman）。

问题：

1. **两套标准混用**：两个文件其实都被加载进同一个 `ItemRegistry`（`world-engine._registerSystems`），但分文件的依据模糊。
2. **重复定义**：聚气丹同时存在 `qi_gathering_pill`(resources, consumable) 与 `item_qi_pill`(items, pill)，ID 不一致、数值两份。
3. **死代码**：`ItemDefinition.isResource()/isProp()` 与 `ItemRegistry.getResources()/getProps()` 按 `'resource'/'prop'` 匹配，而真实数据没有这两个 category，永远返回空。
4. **灵石只是货币**：`resources.json` 里灵石带 `qiValue` 字段，但未接入 Effect 系统，无法「服用灵石吸纳真气」。

世界观依据（[凡人修仙传/物品设定.md](../世界观参考/凡人修仙传/物品设定.md)）：物品 = 资源类（灵石/灵脉/灵材天材地宝）+ 道具类（法宝/功法/丹药/阵法/符箓/储物袋）。灵石**既是货币又有「灵气含量」**，可被修炼吸收——印证「灵石能加真气」。

## 决策

### 1. 统一「物品」体系，按 category 区分

所有可被 NPC / 势力持有、消耗、产出、转移的物品归入 `data/items/items.json`，用 `category` 区分语义：

| category | 含义 | 示例 ID |
|----------|------|---------|
| `currency` | 货币灵石（可计价 + 可服用吸纳真气） | `low_spirit_stone`..`top_spirit_stone` |
| `material` | 炼丹炼器材料/天材地宝 | `spirit_herb`/`ore`/`monster_core_gN`/`beast_material_gN`/`item_spirit_fruit`/`item_strong_blood` |
| `pill` | 丹药 | `item_qi_pill`/`item_breakthrough_pill` |
| `artifact` | 法宝法器古宝灵宝 | `item_artifact_low`..`item_artifact_immortal` |
| `talisman` | 符箓 | `item_escape_talisman`/`item_escape_talisman_high` |
| `technique` | 功法秘籍 | `technique_book_low`..`technique_book_legend` |

**势力宏观资源**（不属于「实物道具」，仅势力以抽象数量持有）独立放 `data/definitions/macro-resources.json`：

| category | 含义 | 示例 ID |
|----------|------|---------|
| `supply` | 后勤物资 | `food` |
| `population` | 人口规模 | `disciples` |

两文件仍都加载进 `ItemRegistry`（运行时统一查询），但**分类依据清晰**：实物道具 vs 势力宏观资源。

### 2. 去重：统一一套 ID

`resources.json` 中重复/未接入的丹药（`qi_gathering_pill`/`cultivation_pill`/`foundation_pill`/`healing_pill`/`life_extension_pill`）、符（`talisman`）、阵旗（`formation_flag`）、储物袋（`storage_bag`）属历史遗留死数据（几乎无代码引用），已删除，统一用 `item_` 系。功法秘籍 `technique_book_*` 因被任务模板引用而保留（category 由 `technique_book` 规范为 `technique`）。

被经济/势力 AI/任务/妖兽掉落引用的 ID（灵石、`food`、`disciples`、`spirit_herb`、`ore`、`monster_core(_gN)`、`beast_material(_gN)`）**全部沿用原 ID**，迁移仅换文件不改名，保证零漂移。

### 3. 灵石接入通用 Effect（可服用加真气）

四档灵石各加 `effects: [{ "effect": "ge_add_qi", "magnitude": <qiValue> }]`，复用 ADR-042 的通用原语 `ge_add_qi`，数值取自各自 `qiValue`（low=1 / mid=120 / high=15000 / top=1800000）。服用走已有统一入口 `npc-economy.applyItemEffects(entity, itemId)`，与丹药/灵果/精血同一机制。

**默认不自动触发**：本期只让「灵石可服用」这一能力存在，不新增自动消耗逻辑（无行为驱动则不发生），因此对现有模拟零影响——指纹 `1169158b` 不变。

### 4. 修复注册表死代码

`ItemDefinition` 新增按真实 category 的判断：`isMacroResource()`（supply/population）、`isCurrency()`、`isMaterial()`、`isHoldable()`（非宏观资源即可持有）。`ItemRegistry` 的 `getResources()/getProps()` 改为 `getMacroResources()/getHoldables()`。

## 后果

- **正面**：分类标准单一清晰；消除重复定义；灵石货币+可服用双重身份落地，复用通用 Effect 无新增专用代码；死代码修复。
- **负面**：旧 `resources.json` 路径被 14 处工具/加载器硬编码引用，需一次性改为 `macro-resources.json`（已全部更新）。
- **零漂移验证**：`verify-determinism`（指纹 `1169158b` 不变）、`verify-effect-reuse`（新增灵石服用断言：low +1 / mid +120 复用 `ge_add_qi`）、`verify-gas-combat`（3 种子 × 800 天真实长程，锁血/遁地生效，无回归）。

## 实现位置

- 数据：`data/items/items.json`（统一物品）、`data/definitions/macro-resources.json`（势力宏观资源，新建）；删除 `data/definitions/resources.json`。
- 代码：`config-loader.js`、`world-engine._registerSystems`、`item-definition.js`、`item-registry.js`；工具脚本路径同步。
- 验证：`tools/verify-effect-reuse.mjs`（扩展灵石服用断言）。

## 未来扩展

- 灵脉（产灵石的资源点）、储物袋/阵旗等道具如需重新建模，按本 ADR 的 category 体系新增。
- 灵石「服用吸纳真气」的行为驱动（如缺真气时优先服用低级灵石）待后续行为系统接入时再开。
