# ADR-012：灵根（资质）与体质系统

> 日期：2026-05-29
> 状态：已接受 · **已实现**（数值层已落地并通过赋值/速度验证；体质 specialEffects 仍为占位待定）
> 关联：ADR-011（修炼激励系统）、ADR-005（需求驱动 GOAP）、`wiki/rules/spirit-root.md`、`wiki/rules/physique.md`

## 背景

当前修炼系统中，所有 NPC 的修炼速度仅由"境界基础速度 × 随机波动(0.7~1.3) × 功法 × 修炼场加成"决定，**缺乏先天个体差异**——无法解释"为什么有人是天才、有人终生平庸"，也无法支撑修仙世界典型的"天骄 vs 芸芸众生"的阶层叙事。

参考资料中存在两套成熟体系：
- **凡人修仙传的灵根体系**：量化分级（灵根数越少越纯），直接影响修炼速度与突破成功率。
- **完美世界的体质/血脉体系**：稀有定性标签（至尊骨、涅槃之体等），赋予特殊神通与质变增益。

用户决定**两套都做**，因为它们机制互补：灵根管"大盘资质分布"，体质管"金字塔尖天骄"。

## 决策

### 1. 灵根（资质）—— 人人都有的 5 档量化资质

- 5 档：天灵根 `heaven` / 双灵根 `dual` / 三灵根 `triple`（基准）/ 四灵根 `quad` / 伪灵根 `false`。
- 作用：`speedMultiplier`（乘修炼速度）+ `breakthroughBonus`（加突破成功率）。
- 初始按分布权重随机抽取（天才稀少、平庸众多）。
- 详见 `wiki/rules/spirit-root.md`。

### 2. 体质 —— 凡体为主 + 稀有特殊体质

- ~95% 凡体 `mortal_body`（无加成），~5% 特殊体质（灵体/道体/战体/涅槃之体等）。
- 作用：在灵根之上**额外叠加** `speedMultiplier` × `breakthroughBonus` + `lifespanBonus` + 预留 `specialEffects`（特殊效果逻辑待定）。
- 详见 `wiki/rules/physique.md`。

### 3. 作用链（与现有系统的接入方式）

最终修炼速度（连乘，复用现有 `speedMultiplier` 链）：

```
speed = baseSpeed
      × 速度波动(0.7~1.3)
      × 功法 cultivationSpeedMultiplier
      × 修炼场 extraSpeedMultiplier
      × 灵根 speedMultiplier        ← 新增
      × 体质 speedMultiplier        ← 新增
```

最终突破成功率（累加，复用现有 `_getBreakthroughRate`/`_tryBreakthrough`）：

```
finalRate = (基础成功率 + 功法 breakthroughBonus + 灵根 breakthroughBonus + 体质 breakthroughBonus)
          × 年龄惩罚
```

寿元：突破刷新寿命时，体质 `lifespanBonus` 按比例叠加。

### 4. 都影响功法选择

灵根档位与体质亲和共同影响 NPC 可修/适配的功法（高灵根可修高阶功法；体质亲和特定流派）。具体匹配/亲和表待与功法体系联调时细化，本期先打通数值层。

### 5. 实现范围

数值层已全部落地；体质 `specialEffects`（涅槃重生/降心魔/战力）仍为数据占位，逻辑待逐个明确。功法精确匹配/亲和表延后。

## 实现记录（已完成）

1. ✅ **数据配置** — `cultivation.json` 新增 `spiritRoot`（5 档：倍率/加成/分布权重）与 `physique`（体质池：倍率/加成/寿元/specialEffects/分布权重）。
2. ✅ **NPC 状态** — `npc-state.js` 新增 `spiritRootId`（默认 `triple`）、`physiqueId`（默认 `mortal_body`）。
3. ✅ **初始化分布** — `NPCEntity._initTalent` + `_weightedPick` 按权重随机抽取；`npcConfig.spiritRootId/physiqueId` 可显式指定覆盖。
4. ✅ **修炼接入** — `NPCCultivateExecutor`：灵根/体质 `speedMultiplier` 连乘进 `speedMultiplier`（已验证天灵根≈×2、伪灵根≈×0.4、天灵根+道体叠加≈×3）。
5. ✅ **突破接入** — `_tryBreakthrough`：灵根/体质 `breakthroughBonus`（+顺带修复了未生效的功法 `techniqueBreakthroughBonus`）累加进 `baseRate` 再过年龄惩罚；体质 `lifespanBonus` 在突破刷新寿命时按比例叠加。
6. ⏳ **功法选择接入** — 延后（匹配/亲和表待细化）。
7. ⏳ **特殊效果** — `physique.specialEffects` 占位，逻辑待定。
8. ✅ **文档** — `data-config-rules.md`、`README.md`、wiki README 已更新。
9. ✅ **验证** — 赋值分布符合权重（凡体≈95%、特殊体质≈5%）；修炼速度按灵根/体质连乘正确。

## 后果

### 正面
- 修仙世界出现真实的"天才—中坚—边缘"分层，叙事张力大增。
- 完全数据驱动（`cultivation.json`），分布与数值可调；复用现有乘法/加法链，改动收敛。
- 灵根（连续大盘）+ 体质（稀有尖端）两层正交，组合空间丰富（天灵根+道体=绝世天才）。

### 负面/风险
- 引入两个新的速度乘数 + 突破加成，会显著改变既有平衡（突破率、晋升速度、人口结构），需模拟重新校准 ADR-011 的数值。
- 体质 `specialEffects` 是开放式扩展，逻辑未定，需控制范围避免无限膨胀。
- 灵根/体质与功法匹配度若做得过细会增加复杂度，本期仅打通数值层、匹配表延后。

## 涉及文件（实现阶段）
- 改 `apps/game/data/balance/cultivation.json`（新增 `spiritRoot`、`physique`）
- 改 `apps/game/js/engine/npc/npc-state.js`（`spiritRootId`、`physiqueId`）
- 改 `apps/game/js/engine/npc/npc-actions.js`（修炼速度连乘）
- 改 `apps/game/js/engine/npc/npc-entity.js`（突破成功率/寿元接入、初始化分布、功法选择）
- 改 `docs/data/data-config-rules.md`、`docs/README.md`、`docs/worldbuilding/wiki/README.md`（文档）
