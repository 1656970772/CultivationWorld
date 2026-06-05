# ADR-046：删除泛称材料 ID（spirit_herb/ore/monster_core/beast_material），全部改指具体道具

最后更新：2026-06-03

状态：已采纳并实施（2026-06-03）。确定性摘要 `1169158b` 默认关闭不改变既有行为，3 种子 × 800 天长程模拟与删除前逐字一致。

> 关联：[ADR-044](adr-044-concrete-items-and-subcategory.md)（具体道具替换泛称占位项；当时保留这 4 个"机制必需泛 ID"）、[ADR-045](adr-045-item-files-split-by-category.md)（物品按 category 拆分多文件）、[ADR-043](adr-043-item-resource-unified-taxonomy.md)（资源与物品统一分类）。

## 背景

ADR-044 删除了纯泛称占位道具，但**保留**了 4 个"机制必需泛 ID"：`spirit_herb`(灵药)、`ore`(灵矿石)、`monster_core`(妖兽内丹)、`beast_material`(灵兽材料)，理由是它们被任务/捐献/妖兽掉落引用。

复审后认定：这 4 个仍是「没有专有名词的空泛类别名」，不符合"物品应是具体的东西"。其引用本质分两类：

1. **作为可被持有/发放的物品 ID**（quest-templates 奖励、economy 捐献/兑换）——应改指具体道具。
2. **作为妖兽掉落分级机制的"家族前缀名"**（`monster_core`/`beast_material` 在 `monsters.json` drops 作 sourceItemId，运行时由 `gradedMonsterResourceId` 按 grade 映射成 `_gN`）——可在数据层静态展开为具体 `_gN`，消除运行时泛 ID。

## 决策

### 1. 删除 4 个泛 ID 的物品定义

从 `items/material.json` 删除 `spirit_herb`/`ore`/`monster_core`/`beast_material` 四项定义。`_gN` 分级妖丹妖材（`monster_core_g1..g9`/`beast_material_g1..g9`）与具体材料（`mat_*`）保留。

### 2. 引用改指具体道具（映射表）

| 旧泛 ID | 新具体道具 | 用途 |
|---------|-----------|------|
| `spirit_herb` | `mat_century_ginseng`（百年人参，herb g1）| 采药任务奖励 `qt_herb`、捐献表、聚气丹兑换要求 |
| `ore` | `mat_black_iron_ore`（玄铁精矿，ore g2）| 采矿任务奖励 `qt_mine_ore`、捐献表、法器兑换要求 |
| `monster_core` | `monster_core_g1`（任务奖励）/ 妖兽 drops 按 coreGrade 展开为 `_g{coreGrade}` | 斩妖任务奖励、捐献表、妖兽掉落 |
| `beast_material` | `beast_material_g1`（任务奖励）/ 妖兽 drops 按妖兽 grade 展开为 `_g{grade}` | 斩妖任务奖励、捐献表、妖兽掉落 |

具体改动文件：

- `data/definitions/monsters.json`：~36 妖兽、72 条 drops 静态展开为具体 `_gN`（`monster_core` 用 `coreGrade`、`beast_material` 用妖兽 `grade`），删除已展开进 id 的 `coreGrade` 字段。
- `data/quests/quest-templates.json`：`qt_herb`→`mat_century_ginseng`、`qt_mine_ore`→`mat_black_iron_ore`、斩妖类（`qt_slay_monster`/`qt_exterminate`/`qt_hunt_beast`）奖励 `monster_core`/`beast_material`→`_g1`。
- `data/balance/economy.json`：捐献表 4 项与兑换要求改指上述具体道具。
- 工具脚本 `tools/test-quest-reward-economy.mjs` 的夹具/断言同步改具体 ID。

### 3. 代码侧清理

- `npc-economy.isMonsterExchangeItem`：移除裸 `monster_core`/`beast_material` 分支（仅保留 `_gN` 正则）。
- `npc-action-utils.rollAndGrantReward`：opportunity_corpse fallback 由裸 `monster_core`/`beast_material` 改为 `monster_core_g1`/`beast_material_g1`（保证总指向存在物品）。
- 保留 `monster-resources.GRADED_BASE_IDS` 与 `gradedMonsterResourceId` 映射机制：它现在主要服务于对任意 `_gN` 输入的健壮性与 `test-monster-resource-loop` 单元测试（输入泛 ID 验证映射），不再有泛 ID 物品定义依赖它。`npc-action-utils` 中以 `'monster_core'`/`'beast_material'` 作 `_gN` 拼接前缀的用法保留（家族前缀名，非物品查询）。

## 影响

- 物品体系不再有"空泛类别名"被当作可持有物品；所有发放/持有/掉落都是具体命名道具。
- 任务奖励/捐献/妖兽掉落的物品价值改用具体道具价值（如 spirit_herb value 30 → 百年人参 80），属预期变化；但默认配置长程模拟终态摘要未变。

## 验证（默认关闭不改变既有行为 + 真实模拟）

- 6 分类文件合并后 74 项（78−4）无重复 ID；`spirit_herb`/`ore`/`monster_core`/`beast_material` 均不在物品表。
- 全仓库代码/数据无残留 `"itemId": "<泛ID>"` 引用（monsters/quest/economy 已全部展开为具体）。
- `tools/test-monster-resource-loop.mjs`：品阶化资源定义与掉落映射断言全 OK（`monster_core_g3`/`beast_material_g3` 经映射正确发放）。崩溃点 `npc-state rng` 为 ADR-038 引入的 pre-existing 测试夹具缺陷，与本次无关。
- `tools/verify-effect-reuse.mjs`：通过。
- `tools/verify-determinism.mjs`：seed=12345 摘要 `1169158b`（默认关闭不改变既有行为）。
- `tools/verify-gas-combat.mjs`（3 种子 × 800 天）：通过，存活/死因/锁血/遁地输出与删除前逐字一致，妖兽掉落/经济/战斗链长程无退化。

