# 战斗属性数据模型

> 最后更新：2026-06-07

## NPC 运行时字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `rankStage` | string/null | `early`、`middle`、`late`、`perfection`；凡人为 `null` |
| `hp` | number | 当前气血 |
| `maxHp` | number | 气血上限；新开关第一阶段写入体质倍率后的运行时值 |
| `yuan` | number | 当前战斗真元 |
| `maxYuan` | number | 战斗真元上限 |
| `attack` | number | 普攻、术法、法宝基础攻击面板 |
| `defense` | number | 数值护甲 |
| `speed` | number | 战斗速度、追逃和反应标尺 |
| `soul` | number | 神魂、感知、幻术、威压和 AI 估值 |
| `qi` | number | 修炼与突破真气，不作为战斗真元 |
| `equippedArtifactId` | string/null | 当前装备法宝，改变后刷新 `artifact_combat` 修正层 |

## 定义表

三张表都位于 `apps/game/data/definitions/`，并由 `ConfigLoader.loadGameConfigs()` 显式加载。

| 文件 | 关键字段 |
|------|----------|
| `combat-base-table.json` | `version`、`attributeKeys`、`stageMultipliers`、`ranks` |
| `cultivator-combat.json` | `version`、`source`、`ranks` |
| `monster-combat.json` | `version`、`source`、`ranks` |

`ranks` 以 `rankId` 为键，每个境界包含：

```json
{
  "name": "炼气",
  "hp": 220,
  "yuan": 150,
  "attack": 48,
  "defense": 18,
  "speed": 25,
  "soul": 32
}
```

三张表可包含未来高阶层级作为参考，但不扩展 `ranks.json` 的 canonical runtime 境界。

## 功法修正

功法在 `effects.combatModifiers` 内声明战斗属性修正：

```json
"combatModifiers": [
  { "attribute": "attack", "op": "multiply", "magnitude": 1.12 },
  { "attribute": "speed", "op": "multiply", "magnitude": 1.08 }
]
```

运行时以 `technique_combat` 作为 AttributeSet 来源分组，刷新时先移除旧分组再添加当前功法修正。

## 法宝修正

法宝保留旧 `combatBonus`，并新增 `combatModifiers`：

```json
{
  "id": "artifact_green_sword",
  "combatBonus": 0.05,
  "combatModifiers": [
    { "attribute": "attack", "op": "multiply", "magnitude": 1.15 }
  ]
}
```

`combatBonus` 只服务旧路径；`combatModifiers` 服务新 AttributeSet 路径。两者不得互相自动推导，避免双计。

## 通用 GE

`apps/game/data/effects/core-effects.json` 提供两个通用原语：

| id | durationType | 用途 |
|----|--------------|------|
| `ge_add_combat_attribute` | `instant` | 即时增加某个战斗属性 |
| `ge_combat_attribute_modifier` | `infinite` | 常驻战斗属性修正层 |

调用 `EffectEngine.applyEffect(target, def, { spec })` 时，`spec.attribute`、`spec.op`、`spec.magnitude` 可覆盖 GE 默认 modifier，用同一个 GE 表达不同属性和数值来源。
