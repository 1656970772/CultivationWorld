# ADR-044：具体命名道具替换泛称占位项 + 引入 subCategory 子类

最后更新：2026-06-03

状态：已采纳并实施（2026-06-03）。仅换具体 ID/补 subCategory，数值（value/combatBonus/effects 数值）严格等价，零漂移。

> 关联：[ADR-043](adr-043-item-resource-unified-taxonomy.md)（资源与物品统一分类）、[ADR-042](adr-042-gameplay-ability-system.md)（GAS 通用 Effect 原语化）、[ADR-025](adr-025-item-covet-system.md)（可转移实物与怀璧其罪）。

## 背景

`data/items/items.json` 中存在两类「泛」物品：

1. **机制必需的泛类**（货币、分级基底、任务兼容 ID）——是系统运行依赖的抽象单位，不该删。
2. **纯泛称占位道具**——只是「下品法器/中品法宝/上品古宝/仙家灵宝」「功法秘籍（下乘/中乘/上乘/仙家）」这类没有专有名词、缺乏世界观质感的占位项，与 `docs/世界观参考/<作品>/物品设定.md` 中大量具体道具（青竹蜂云剑、虚天鼎、大衍诀、九曲灵参……）脱节。

问题：泛称占位道具让世界缺乏辨识度；且 `artifact`/`technique`/`material` 等顶层 category 之下没有「子类」维度（法器/法宝/古宝/灵宝、正道/魔道/佛门……），无法表达品类差异。

## 决策

### 1. 删除纯泛称占位道具，改为具体命名道具

删除并替换（用具体语义 ID）：

| 旧泛称占位 ID | 新具体道具（示例）| 沿用数值 |
|---------------|-------------------|----------|
| `item_artifact_low` | `artifact_green_sword`（青锋飞剑，法器）| value 500 / combatBonus 0.05 |
| `item_artifact_mid` | `artifact_wulong_halberd`（乌龙夺，法宝）| value 4000 / 0.12 |
| `item_artifact_high` | `artifact_void_cauldron`（虚天鼎，古宝）| value 30000 / 0.25 |
| `item_artifact_immortal` | `artifact_green_bamboo_sword`（青竹蜂云剑，灵宝）| value 200000 / 0.5 |
| `technique_book_low/mid/high/legend` | `tech_*`（敛息术/玉清纯阳功/长春功/大衍诀 等）| 按品阶沿用 value |
| `item_spirit_herb` | `mat_century_ginseng`（百年人参）| value 80 |
| `item_rare_ore` | `mat_black_iron_ore`（玄铁精矿）| value 300 |

并按 11 个世界观目录各补代表性具体道具（遮天荒塔/虚空镜、斗破玄重尺/焚诀、仙逆古神诀、一念永恒龟纹锅、牧神记开皇剑/霸体三丹功、武逆乾坤乾坤镜、武破九荒九劫剑/金刚不坏体、大道争锋太乙分光剑、阳神赤霄神剑 等）。

### 2. 保留机制必需的泛类（不删）

- 四档灵石货币 `low/mid/high/top_spirit_stone`（被势力资源/经济主循环/地形产出/晋升奖励等数十处硬编码）。
- 分级妖丹妖材 `monster_core_g1..g9` / `beast_material_g1..g9`（`monster-resources.js` 分级机制基底）。
- 任务兼容泛 ID `spirit_herb`/`ore`/`monster_core`/`beast_material`（任务模板与捐献规则引用）。
- 丹药机制 `item_qi_pill`/`item_breakthrough_pill`、Effect 复用示例 `item_spirit_fruit`/`item_strong_blood`、能力符 `item_escape_talisman(_high)`。

### 3. 引入 `subCategory` 子类字段

在顶层 `category` 下新增可选 `subCategory`，复用现有 `grade`/`gradeName` 标品阶：

| category | subCategory 枚举 |
|----------|------------------|
| `artifact` | `magic_artifact`/`magic_treasure`/`ancient_treasure`/`spirit_treasure`/`heavenly_treasure`（法器/法宝/古宝/灵宝/通天灵宝）|
| `technique` | `righteous`/`evil`/`buddhist`/`beast`/`auxiliary`（正道/魔道/佛门/御兽/辅助）|
| `material` | `herb`/`ore`/`blood`/`fruit`/`special`/`monster_core`/`beast_material` |
| `pill` | `cultivation`/`breakthrough`/`healing`/`recovery` |
| `talisman` | `escape`/`attack`/`defense`/`healing` |

### 4. 可服用具体道具补 effects（复用通用原语，零新属性）

灵草/灵果/精血/破境丹/疗伤丹等可服用具体道具的 `effects` 复用 ADR-042 通用原语（`ge_add_qi`/`ge_add_hp`/`ge_add_progress`/`ge_add_breakthrough_bonus`/`ge_full_heal`），数值写在各物品 `effects`。**不新增专用 GE**（遵守 AGENTS.md「GE 必须是通用机制原语」），**不引入未消费属性**（`attribute-set.js` 阶段2 仅 hp/qi/progress/breakthroughAidBonus 走管线，延寿/洗髓类暂作高价至宝材料，待 GAS 寿元/资质接入后再挂 effect）。

## 影响

- `npc-economy.isArtifact()` 经 `category === 'artifact'` 分支识别新法宝（不再依赖 `item_artifact_` 前缀），装备链零改动。
- 被旧泛称占位 ID 引用处全部改指新 ID（`reward.json` opportunity_* 掉落、`economy.json` artifact_low 兑换、`quest-templates.json` 秘境随机奖励、`test-quest-reward-economy.mjs`/`test-info-propagation.mjs` 断言），保持 prob/value/qty/combatBonus 不变。
- `monsters.json`/`monster-resources.js`/`donationRules`/`factions.json`/`terrains.json`/`constants.js` 因只用保留的泛类，**无需改动**。

## 验证（禁止黄金指纹自证）

1. items.json JSON 合法、无重复 ID、无残留旧泛称占位 ID。
2. 运行时/脚本无残留旧 ID 引用（全量搜索确认）。
3. 现有验证脚本通过：`verify-effect-reuse`、`test-quest-reward-economy`、`test-monster-resource-loop`、`test-info-propagation`、`verify-gas-combat`。
4. `verify-determinism` 指纹前后一致（仅换 ID、数值等价）。
5. `simulate-analysis` 多种子、足量天数、全量 NPC 真实长程模拟，经济/掉落/装备分布无退化。
