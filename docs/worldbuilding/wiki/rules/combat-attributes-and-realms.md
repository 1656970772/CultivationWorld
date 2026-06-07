# 战斗属性与境界阶位

> 最后更新：2026-06-07
> 状态：已实现，默认主路径开启
> 类型：规则
> 关联文档：`docs/decisions/adr-054-twelve-realm-runtime-chain.md`、`docs/decisions/adr-053-cultivator-combat-attributes.md`、`docs/systems/cultivator-combat-attributes.md`、`docs/data-models/combat-attributes.md`
> 数据来源：本项目 2026-06-07 十二境界运行时主链决策；妖兽属性模板参考既有妖兽规划与 `docs/worldbuilding/wiki/creatures/monsters.md`

## 主境界链

项目运行时主境界链为：

```text
凡人 → 炼气 → 筑基 → 金丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘 → 渡劫 → 地仙 → 天仙
```

凡人不拆小层；炼气及以上拆为初期、中期、后期、圆满。小层倍率为：

| 小层 | 倍率 |
|------|-----:|
| 初期 | 1.00 |
| 中期 | 1.15 |
| 后期 | 1.45 |
| 圆满 | 2.00 |

`rankId` 只表示修仙境界；弟子、长老、掌门、将领等身份只作为 `role` 或社会职位。大罗天仙、道祖不属于本轮运行时主链，也不作为战斗表 key。

## 妖兽等阶

妖兽最低层级为猛兽/凡兽，对应凡人层级。之后妖兽等阶与十二境界平行：

| 妖兽层级 | 对应境界层级 |
|----------|--------------|
| 猛兽/凡兽 | 凡人 |
| 一阶妖兽 | 炼气 |
| 二阶妖兽 | 筑基 |
| 三阶妖兽 | 金丹 |
| 四阶妖兽 | 元婴 |
| 五阶妖兽 | 化神 |
| 六阶妖兽 | 炼虚 |
| 七阶妖兽 | 合体 |
| 八阶妖兽 | 大乘 |
| 九阶妖兽 | 渡劫 |
| 十阶妖兽 | 地仙 |
| 十一阶妖兽 | 天仙 |

该对应是危险层级和调参参考，不代表同阶修士与妖兽必须战力相等。

## 战斗属性

修士与妖兽统一六项基础属性：

| 属性 | 含义 |
|------|------|
| 气血 | 最大生命、肉身承伤能力 |
| 真元 | 战斗中可调动的真元上限和技能耐力 |
| 攻击 | 普攻、术法、法宝基础伤害能力的通用面板 |
| 防御 | 数值护甲，参与通用伤害公式 |
| 速度 | 战斗速度、追逃、反应、机动能力标尺 |
| 神魂 | 感知、幻术攻防、驯化难度、威压和 AI 估值 |

`qi` 与 `yuan/maxYuan` 分开：`qi` 是修炼和突破资源，`yuan/maxYuan` 是战斗真元。凡人和猛兽也进入统一表，但真元默认为 0 或极低。

## 基表规则

项目维护一张境界战斗基表，作为同层级参考强度。修士基础属性表与妖兽基础属性表都参考这张基表，但不强制由它推导，也不互相强绑定。

三张战斗表的 rank key 必须与运行时十二境界完全一致。表内数值按旧 12 槽位迁移，只改 key 和显示名，不重调战斗数值。

修士裸表只表示普通修士基础体魄与可调动真元。修士主要依靠功法和装备提升属性，最终有效属性通过 GAS/AttributeSet 叠加：

```text
有效属性 = 境界裸表 × 小层倍率
        + 功法修正
        + 装备/法宝修正
        + 体质/灵根修正
        + 丹药/符箓/阵法/临时状态修正
```

普通无装备修士不应轻松正面压制同阶妖兽；有好功法和好法宝的修士可以越阶或反杀强妖。

## 运行时落地

当前运行时使用以下数据表：

| 表 | 用途 |
|----|------|
| `apps/game/data/definitions/combat-base-table.json` | 境界参考基表与小层倍率 |
| `apps/game/data/definitions/cultivator-combat.json` | 普通修士裸面板 |
| `apps/game/data/definitions/monster-combat.json` | 普通妖兽危险层级参考表 |

`combat.cultivatorAttributes.enabled=true` 与 `numericArmorDamage=true` 为默认主路径。NPC 初始化和突破刷新会写入 `rankStage`、`maxHp/hp`、`maxYuan/yuan`、`attack`、`defense`、`speed`、`soul`。为兼容旧血量消费点，新开关开启时 `state.maxHp/hp` 暂写入体质倍率后的运行时值。

功法和法宝通过 `combatModifiers` 影响有效属性。旧 `combatBonus` 只保留给旧战力路径，不作为新 AttributeSet 修正自动生效。
