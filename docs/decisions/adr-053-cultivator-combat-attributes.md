# ADR-053：修士战斗属性体系

> 最后更新：2026-06-07
> 状态：已采纳
> 关联：ADR-041、ADR-042、ADR-051、ADR-052
> 来源：`docs/superpowers/specs/2026-06-06-修士战斗属性体系-design.md`、`docs/superpowers/plans/2026-06-07-修士战斗属性体系实施计划.md`

## 背景

旧 NPC 战斗只维护 `hp/maxHp`、按境界读取的比例减伤 `baseDef`，以及用于 AI 的综合战力估值。修士、妖兽、功法、法宝和 GAS 之间没有共同的基础属性语言，后续技能、装备、神魂、追逃和数值护甲机制难以统一接入。

妖兽侧已通过 ADR-052 清理境界语义和模板面板。修士侧需要一套与妖兽危险层级可对照、但又能体现“修士依靠功法和法宝放大战力”的基础属性体系。

## 决策

1. 新增三张运行时数据表：`combat-base-table.json`、`cultivator-combat.json`、`monster-combat.json`。基表只作同层级参考强度；修士裸表和妖兽参考表各自独立，不互相强绑定。
2. 修士统一六项战斗属性：`maxHp/hp`、`maxYuan/yuan`、`attack`、`defense`、`speed`、`soul`。其中 `qi` 继续表示修炼与突破真气，`yuan/maxYuan` 表示战斗真元，二者不得混用。
3. `rankStage` 表示小层：`early`、`middle`、`late`、`perfection`，凡人为 `null`。小层倍率来自 `combat-base-table.json.stageMultipliers`。
4. `combat.cultivatorAttributes.enabled=false` 时保留旧 `npcHp/baseDef` 路径；开启后 `NPCEntity` 通过 `calculateCultivatorCombatAttributes()` 初始化和突破刷新修士战斗属性。
5. 第一阶段为兼容旧消费点，新开关开启时 `state.maxHp/hp` 写入体质血量倍率后的运行时值。`attack/defense/speed/soul/yuan` 仍按修士裸表和小层倍率写入基础面板；功法、法宝和后续 buff 通过 AttributeSet 修正层读取有效值。
6. 功法与法宝新增 `combatModifiers`。旧 `combatBonus` 保留给旧战力估值路径，不自动转成 AttributeSet 修正，避免新旧路径双计。
7. `combat.cultivatorAttributes.numericArmorDamage=true` 时，统一战斗入口使用数值护甲公式；关闭时仍使用旧比例减伤。

## 后果

- 新机制可以按开关灰度启用，默认不改变旧 HP 与比例减伤路径。
- AI 战力估值、修士 PvP、妖兽反击、斩妖风险和后续技能都可以读取同一批有效战斗属性。
- 法宝装备、抢夺和 Job/Toil 装备路径必须刷新 `artifact_combat` 修正层；技法修正需要 `techniqueRegistry`。
- 妖兽运行时仍以 `monster-attribute-templates.json` 为直接面板来源；`monster-combat.json` 只作危险层级和调参参考。

## 验证要求

不得用单一摘要值、哈希或指纹自证。需要运行 focused tests，并用真实多种子模拟观察战斗、斩妖、追逃、突破和装备加成是否合理。

默认开关验证要确认旧路径仍可用；迁移开关开启验证要确认低阶危险、同阶妖兽压制、功法/法宝加成、小层倍率、境界压制，以及 `qi/yuan` 分拆不会污染突破节奏。
