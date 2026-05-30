# ADR-025：实物系统与怀璧其罪

最后更新：2026-05-30

## 背景

ADR-024 建立了信息传播与机会点闭环，但要支撑用户提出的标志性场景——「某 NPC 使用了好的功法/武器或持有高价值物品，被别人看到，消息传到宗门大佬耳中，可能被直接抢夺，也可能根据身份放他一马」（怀璧其罪），还缺两块：

1. **可觊觎的"璧"**：运行时只有 `low_spirit_stone` 流动，法宝/装备未落地，`techniqueId` 不可转移也无价值分。没有真实的高价值标的，掠夺就无从谈起。
2. **暴露—觊觎—抢夺/放过的决策链**：谁会起贪念、谁会放手，需要基于实力/身份/恩义/性格的理性判定。

参考凡人修仙传「杀人夺宝」、完美世界等：财不露白，宝物招祸；但同门、恩人、道侣、受敬重的长辈往往被放过。

## 决策

### 一、实物系统（可转移物品）

- 新增 `data/items/items.json`：法宝（artifact）/材料（material）/丹药（pill），每项含 `value`（身家估值）、`grade`（品阶，影响暴露概率）、`transferable`（可否被抢夺）、`combatBonus`（装备战力加成，可选）。
- `ItemDefinition` 扩展：把配置上的领域字段（value/transferable/grade/combatBonus）并入 `properties`，供资产估值/转移/战力统一读取。
- NPC 掉落落地：游历/夺宝/机会点结算改用 `rollAndGrantReward`——若 outcome 带 `itemId` 则发放**真实物品写入背包**（替换原来只加 qi 的占位）；`reward.json` 新增 `opportunity_*` 与扩展 `obsession_plunder` 掉落表。
- NPC state 新增 `equippedArtifactId`：已装备法宝，进 `assetScore`，可被抢夺转移；`_npcCombatPower` 接通其 `combatBonus`（无装备系数=1，零漂移）。

### 二、身家估值 assetScore

```
assetScore = 灵石 + Σ(可转移物品 value × 数量) + 已装备法宝 value + 功法品阶 × 800
```

见 `computeAssetScore`（`js/engine/npc/info-actions.js`）。

### 三、怀璧其罪闭环（data/balance/covet.json）

1. **暴露**：持有 `assetScore ≥ exposeThreshold` 的 NPC，周围 `witnessDistance` 内有目击者且概率命中 → 生成 `WorldNews(type=wealth_exposed)` + `WorldOpportunity(type=wealth_target)` 注入传播系统。
2. **传播**：复用 ADR-024 的半径/口耳/宗门/商会渠道，使消息可达远处强者。
3. **觊觎决策**（`decideCovet`）：
   - 起贪念条件：目标身家高 && 自身战力 > 目标战力 × `powerSafetyFactor` && 贪婪/勇敢性格达标（greedScore 门槛）。
   - **放他一马**（按权重累加 spareScore ≥ 阈值）：同 factionId、对方为受保护职位（leader/heir/elder）、对其有恩义（gratitude）、道侣关系、自身高正义/外交 → 放过。
   - 否则发动抢夺。
4. **抢夺结算**（`settleRobbery`）：胜率 = `myPower/(myPower+targetPower)`。胜则转移可转移物品 + 部分灵石 + 夺取法宝（`transferLoot`），并按 `killChanceOnWin` 概率"杀人夺宝"；被抢者记仇（humiliated 记忆），打通既有恩怨→复仇闭环。

## 零漂移保证

- `covet.json` 默认 `enabled: false`，禁用态下不计算 assetScore、不暴露、不抢夺。
- `equippedArtifactId` 默认 `null`，`_artifactCombatFactor` 返回 1，战力计算与现状一致。
- `ItemDefinition` 字段合并仅扩充 `properties`，不改变既有 resources 的行为。
- 验证：`test-info-propagation` 覆盖 assetScore 估值、觊觎/放过/实力不足三类决策；激活态模拟可观测 wealth_exposed → covet_rob/covet_spare 事件序列。

## 关联

- 信息传播与机会点：ADR-024。
- 系统文档：`docs/systems/item-covet.md`。
- 世界观：`docs/worldbuilding/wiki/rules/怀璧其罪.md`。
