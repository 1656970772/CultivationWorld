# 修士战斗属性体系

> 最后更新：2026-06-07
> 关联：`docs/decisions/adr-053-cultivator-combat-attributes.md`

## 目标

修士战斗属性体系把旧的 `hp/maxHp + baseDef 比例减伤 + rank/qi 战力估值` 迁移为“境界裸表 × 小层倍率 + AttributeSet/GAS 修正 + 数值护甲伤害”的统一模型。

## 数据来源

| 文件 | 职责 |
|------|------|
| `apps/game/data/definitions/combat-base-table.json` | 境界参考基表，提供六项属性参考值和小层倍率 |
| `apps/game/data/definitions/cultivator-combat.json` | 普通修士裸面板，作为 NPC 新属性路径的基础表 |
| `apps/game/data/definitions/monster-combat.json` | 普通妖兽危险层级参考表，不替代妖兽模板运行时 |
| `apps/game/data/balance/combat.json` | 迁移开关和数值护甲开关 |
| `apps/game/data/definitions/techniques.json` | NPC 修炼功法定义表，承载功法 `effects.combatModifiers`；秘籍物品在 `apps/game/data/items/technique.json` |
| `apps/game/data/items/artifact.json` | 法宝 `combatModifiers` 与旧 `combatBonus` |

## 属性

| 属性 | 含义 |
|------|------|
| `hp/maxHp` | 当前气血与气血上限 |
| `yuan/maxYuan` | 战斗真元与战斗真元上限 |
| `attack` | 普攻、术法、法宝的基础攻击面板 |
| `defense` | 数值护甲 |
| `speed` | 战斗速度、追逃、反应、机动能力 |
| `soul` | 神魂、感知、幻术、威压和 AI 估值 |

`qi` 仍是修炼与突破资源；`yuan/maxYuan` 是战斗资源。任何战斗消耗不得污染突破真气。

## 初始化流程

`WorldEngine` 加载三张战斗属性表后，把它们放入 NPC 构造配置的 `combatTables`。当 `combat.cultivatorAttributes.enabled=true` 时，`NPCEntity._initCombatAttributes()` 调用 `calculateCultivatorCombatAttributes()`：

```text
普通修士裸表[rankId] × stageMultipliers[rankStage]
  -> maxHp/maxYuan/attack/defense/speed/soul 基础面板
  -> hp = maxHp, yuan = maxYuan
```

凡人的 `rankStage` 固定为 `null`；炼气及以上支持 `early/middle/late/perfection`，非法值回退为 `early`。

第一阶段为兼容仍直接读取 `state.maxHp` 的旧消费点，新开关开启时 `state.maxHp/hp` 写入体质血量倍率后的运行时上限。突破刷新只抬高或夹取 `hp/yuan`，不默认回满。

## 修正层

功法和法宝不改裸表，而是通过 AttributeSet 修正有效属性：

```text
有效属性 = state 基础面板
        + technique_combat 修正层
        + artifact_combat 修正层
        + trait/buff/item 等 GAS 修正层
```

`NPCEntity.refreshTechniqueCombatModifiers()` 使用 `techniqueRegistry` 读取当前功法的 `effects.combatModifiers`；`refreshArtifactCombatModifiers()` 使用 `ItemRegistry` 读取当前装备法宝的 `combatModifiers`。装备、抢夺和 Toil 直接装备路径在修改 `equippedArtifactId` 后必须刷新法宝修正层。

`combatBonus` 是旧战力估值字段，保留给旧路径。新开关开启后的战力估值读取 `attack/defense/speed/soul` 的有效值，不再额外乘旧法宝系数。

## 伤害

`combat.cultivatorAttributes.numericArmorDamage=false` 时，战斗入口保留旧比例减伤。开启后使用数值护甲公式：

```text
damage = max(1, attack * skillMultiplier * sceneMultiplier
                * attack / (attack + defense)
                * randomMultiplier * extraReductionMultiplier)
```

当前接入点包括统一 PvP/遭遇战、妖兽攻击修士和斩妖相关战斗估值。

## 回退与验证

- `enabled=false`：保留旧 `npcHp/baseDef` 路径。
- `enabled=true, numericArmorDamage=false`：初始化六项属性，但伤害仍走旧比例减伤。
- `enabled=true, numericArmorDamage=true`：六项属性与数值护甲同时生效。

验证必须看真实行为数据：focused tests 确认加载、计算、刷新和开关分支；多种子模拟观察低阶危险、同阶妖兽压制、功法/法宝加成、小层倍率、境界压制和突破节奏。
