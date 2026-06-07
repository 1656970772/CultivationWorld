# ADR-054: 十二境界运行时主链

最后更新：2026-06-07

## 状态

Accepted

## 背景

运行时境界、修炼门槛、寿元桶、战斗属性表和妖兽危险层级需要统一到一条可直接运行的主链。此前战斗属性参考表保留了 12 个槽位，但其中包含“大罗天仙 / 道祖”等未来或传说位格；`ranks.json` 则只开放到化神，导致运行时境界、战斗表和高阶妖兽资料之间口径不一致。

## 决策

运行时主链固定为 12 档：

```text
凡人 → 炼气 → 筑基 → 金丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘 → 渡劫 → 地仙 → 天仙
```

`spirit_transformation` 继续表示化神并保持第六档，不改 ID、不降级。`great_luo_heaven_immortal` 与 `dao_ancestor` 不再作为运行时 rank 或战斗表 key 出现；后续如需使用，可作为传说位格、称号、Boss 或另一个扩展设计处理。

`ranks.json` 保留现有嵌套寿元结构：`lifespan.baseYears` 与 `lifespan.varianceYears`。`cultivationRequired` 与 `qiRequired` 必须同步。天仙最大寿元为 4999 年，本轮不实现 4999 年大劫机制。

三张战斗属性表的 `ranks` key 必须与这 12 个运行时境界完全一致。数值按当前旧 12 槽位迁移，只替换 key 和显示名，不重调战斗数值。默认开启 `combat.cultivatorAttributes.enabled=true` 与 `numericArmorDamage=true`，让修士六项属性与数值护甲成为主干路径。

## 后果

运行时系统、数据校验、模拟报告和文档都以 12 档主链为准。旧高阶名称只允许出现在历史 ADR、规格讨论、实施计划或明确说明“非运行时表项”的文本中，不允许再作为 `apps/game/data`、`apps/game/js` 或 `apps/game/tools` 的活跃 key。

高阶修炼速度、灵石消耗、真气收益和移动/风险补表只是保证运行时可读的主链基础；它们仍需通过多种子长程模拟继续观察平衡，尤其是默认数值护甲开启后的斩妖击杀率。
