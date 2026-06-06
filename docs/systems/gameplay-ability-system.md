# 战斗机制层（GAS 化）功能文档

最后更新：2026-06-07

> 设计决策见 [ADR-042](../decisions/adr-042-gameplay-ability-system.md)。
> 本文是面向实现/配表的功能文档：定义各机制的字段 schema、GameplayTag 命名规范、Effect/Ability 数据格式与组合示例。

## 1. 概念总览

参考 UE5 GameplayAbilitySystem（GAS），本项目落地五个机制构件：

| 构件 | 职责 | 代码 |
|------|------|------|
| **GameplayTag** | 层级字符串标签，驱动能力触发/阻挡/免疫判定 | `engine/abstract/gameplay-tag.js` |
| **AttributeSet** | 属性的「基值 + Σ修正层」，`getEffective(key)` | `engine/abstract/attribute-set.js` |
| **GameplayEffect** | 对属性/标签的修改（Instant/Duration/Infinite） | `engine/abstract/gameplay-effect.js` |
| **GameplayAbility** | 由 Tag 触发、消耗道具、授予 Effect 的能力 | `engine/abstract/gameplay-ability.js` |
| **AbilityComponent** | 挂在实体上，持 Tag 容器 + 已授予能力 + 活跃 Effect，每 tick 推进 | `engine/abstract/ability-component.js` |
| **combat-pipeline** | `applyDamage` 统一伤害入口（唯一致死路径） | `engine/combat/combat-pipeline.js` |

## 2. GameplayTag 命名规范

层级用 `.` 分隔，PascalCase 段名。父标签匹配：持有 `State.Dying` 时查询 `State` 命中。

| Tag | 含义 | 由谁授予 |
|-----|------|---------|
| `State.Dying` | 濒死（已锁血保命，待逃脱/疗伤） | `effect_lock_hp` |
| `State.Injured` | 受伤 | 伤害结算 |
| `Trigger.LethalDamage` | 本 tick 受到致死伤害（瞬时触发标记） | `combat-pipeline` |
| `Immune.Crush` | 本次致死无法被锁血（碾压） | `combat-pipeline`（碾压判定） |
| `Immune.LockHP` | 永久免疫锁血（预留） | 配置 |
| `Ability.LockHP` | 实体拥有锁血能力 | `ability_lock_hp` 授予时 |
| `Ability.Escape` | 实体拥有遁地逃脱能力 | `ability_escape_talisman` 授予时 |
| `Effect.LockHP` | 锁血 Effect 资产标签 | `effect_lock_hp` |
| `Trait.SpiritRoot.*` | 灵根特质（阶段2） | 灵根 Infinite Effect |
| `Trait.Physique.*` | 体质特质（阶段2） | 体质 Infinite Effect |
| `Buff.*` / `Debuff.*` | 增益/减益（阶段2 丹药等） | Duration Effect |

新增 Tag 必须登记在 `data/tags/tags.json`，加载期校验未登记的 Tag 会报错（ConfigErrors，对齐 reference-acs-rimworld §5.5）。

## 3. AttributeSet

在 `RuntimeState` 之上提供「基值 + 修正层」：

- `getBase(key)`：基值（如 `_initHp` 写入的 maxHp）。
- `addModifier(key, source, op, value)` / `removeModifiersFrom(source)`：以来源为单位增删修正（对称撤销）。
- `getEffective(key)`：基值叠加全部修正后的有效值。op 支持 `add` / `multiply` / `override`。

向后兼容：机制层未接管的属性，调用方仍直接 `state.get/set`。当前已接入修士战斗属性的 `maxHp`、`attack`、`defense`、`speed`、`soul` 等有效值读取；功法、法宝、体质和后续 buff 通过来源分组叠加修正层。

## 4. GameplayEffect 数据格式

`data/effects/*.json`，每项：

```json
{
  "id": "effect_lock_hp",
  "name": "锁血保命",
  "assetTags": ["Effect.LockHP"],
  "durationType": "instant",
  "modifiers": [
    { "attribute": "hp", "op": "override", "magnitudeType": "ratioOfMaxHp", "magnitude": 0.05 }
  ],
  "grantsTags": ["State.Dying"],
  "stacking": "none"
}
```

字段说明：

- `durationType`：`instant` | `duration` | `infinite`。
- `durationDays`：duration 类的持续天数。
- `modifiers[]`：对 `attribute` 的修改。`op` = `add`/`multiply`/`override`。`magnitudeType`：
  - `flat`（默认，直接用 `magnitude`）
  - `ratioOfMaxHp`（`magnitude × 目标 maxHp`）
  - `rankDecay`（ADR-040 境界递减，阶段2）：`magnitude × decay^max(0, 当前境界order − baseRankId的order)`，夹 `minMagnitude` 下限；参数 `decay`/`baseRankId`/`minMagnitude` 由【挂载来源 spec】提供。用于低阶丹对高境界递减。
- `modifiers[].clamp`（阶段2）：`[min, max]`，对结算后的最终值夹取。端点可为：数字、`null`（该端不限）、或动态键 `"maxHp"`（从目标读 maxHp）。用于上限语义，如 `cultivationProgress` 夹 `[null,1]`、`hp` 夹 `[null,"maxHp"]`、`breakthroughAidBonus` 夹 `[null,maxBonus]`。
- `grantsTags[]`：施加期间授予目标的 Tag（duration/infinite 在 leave 时移除）。
- `removalTags[]`：目标持有这些 Tag 时移除本 Effect（预留）。
- `stacking`：`none` | `refresh` | `stack`。

### 4.1 通用 Effect 原语 + 数值来源参数化（阶段2 增强，重要）

**GE 是通用机制原语，数值来自挂载来源，禁止"一物一专用 Effect"。** GE 只声明机制（attribute/op/默认量纲），具体数值由来源在 `items.json` 的 `effects` 字段提供：

```json
// data/effects/core-effects.json —— 通用原语，无具体数值
{ "id": "ge_add_qi", "name": "增益·真气", "durationType": "instant",
  "modifiers": [ { "attribute": "qi", "op": "add" } ] }

// data/items/ —— 来源自描述数值（spec）
{ "id": "item_qi_pill", "name": "聚气丹", "category": "pill",
  "effects": [
    { "effect": "ge_add_qi", "magnitude": 120, "magnitudeType": "rankDecay", "baseRankId": "qi_refining", "decay": 0.35, "minMagnitude": 1 },
    { "effect": "ge_add_progress", "magnitude": 0.01 }
  ] }
{ "id": "item_spirit_fruit", "name": "灵果", "category": "material",
  "effects": [
    { "effect": "ge_add_qi", "magnitude": 40 },
    { "effect": "ge_add_hp", "magnitude": 0.3, "magnitudeType": "ratioOfMaxHp" }
  ] }
```

- 施加：`EffectEngine.applyEffect(target, def, { spec })`，`spec` 的同名字段（attribute/op/magnitude/magnitudeType/decay/baseRankId/minMagnitude/clamp）覆盖 GE modifier 的默认值。
- 返回：`{ applied, instant, results, mods: [{ attribute, op, delta, newValue }] }`，`delta` 供叙事事件取本次实际增量。
- 统一入口：`npc-economy.applyItemEffects(entity, itemId)` 读物品 `effects` 逐条施加，汇总各属性 delta 返回。丹药/灵草/灵果/强者精血等"服用即生效"来源都走此入口，**复用同一批通用 GE**。
- 同一 `ge_add_qi` 被聚气丹(120)/灵果(40)/强者精血(500) 复用，各自数值取自各自物品——多来源复用经 `tools/verify-effect-reuse.mjs` 真实校验。

### 4.2 战斗属性通用原语

修士战斗属性体系（ADR-053）新增两个通用 GE：

```json
{ "id": "ge_add_combat_attribute", "durationType": "instant",
  "modifiers": [ { "attribute": "attack", "op": "add", "magnitude": 0 } ] }

{ "id": "ge_combat_attribute_modifier", "durationType": "infinite",
  "modifiers": [ { "attribute": "attack", "op": "add", "magnitude": 0 } ] }
```

调用方必须通过 `spec.attribute`、`spec.op`、`spec.magnitude` 指定本次实际属性、操作和数值。功法与法宝的常驻加成当前直接写入 AttributeSet 来源分组（`technique_combat`、`artifact_combat`）；丹药、符箓、阵法和临时状态后续可复用上述 GE 原语。

## 5. GameplayAbility 数据格式

`data/abilities/*.json`，每项：

```json
{
  "id": "ability_escape_talisman",
  "name": "遁地符",
  "abilityTag": "Ability.Escape",
  "triggerTags": ["State.Dying"],
  "blockedByTags": [],
  "requiredItems": [{ "itemId": "item_escape_talisman", "amount": 1 }],
  "grantsEffects": [],
  "executor": "escape_teleport",
  "cooldownDays": 0
}
```

字段说明：

- `abilityTag`：拥有此能力时授予实体的 Tag（供其他逻辑查询）。
- `triggerTags[]`：实体持有任一即可激活（被动触发）。
- `blockedByTags[]`：实体持有任一则禁用（如 `ability_lock_hp` 被 `Immune.Crush` 阻挡）。
- `requiredItems[]`：激活消耗的道具。
- `grantsEffects[]`：激活时对自身/目标授予的 Effect id。
- `executor`：自定义执行器名（如瞬移），无则仅授予 Effect。
- `cooldownDays`：冷却（预留）。

## 6. 统一伤害管线 applyDamage

```
applyDamage(source, target, damageSpec, worldContext) →
  1. 计算伤害量（damageSpec.amount 或 atk×(1-def)×rand）
  2. newHp = hp - dmg；若 newHp > 0 → 扣血 + State.Injured，结束
  3. newHp <= 0（致死）：
     a. 碾压判定（orderGap≥crushOrderGap 或 dmg≥maxHp×crushHpMultiple）→ 授予 Immune.Crush
     b. 授予 Trigger.LethalDamage → AbilityComponent 尝试激活被动能力：
        - ability_lock_hp（未被 Immune.Crush 阻挡）→ 授予 effect_lock_hp → hp 锁到 5%，得 State.Dying
        - ability_escape_talisman（持 State.Dying 且有符）→ 消耗符 + 瞬移 + 清锁定
     c. 若锁血生效 → 不死，返回 { lethal:true, locked:true, escaped? }
     d. 否则真实死亡：hp=0, alive=false, 写 _deathInfo（含 killerId 等）
  4. 清除瞬时 Tag（Trigger.LethalDamage、Immune.Crush）
```

`damageSpec`：`{ amount?, atk?, defKey?, cause, killer?, allowLock?, crushOrderGap?, crushHpMultiple?, orderGap? }`。

三处调用方改造后统一走此入口：妖兽攻击、风险 `hp_damage`、PvP 致死 `killNPCByPvP`。

## 7. 组合示例

### 遁地符 = 锁血 + 瞬移

```
item_escape_talisman 持有 →
  授予 ability_lock_hp（Ability.LockHP）
  授予 ability_escape_talisman（Ability.Escape）
致死伤害到来 →
  applyDamage 检测 hp<=0、非碾压 →
  ability_lock_hp 激活 → effect_lock_hp → hp=5%maxHp + State.Dying →
  ability_escape_talisman 激活（持 State.Dying + 有符）→ 消耗 1 符 + 瞬移随机安全位 + 清妖兽/仇人锁定
```

### 只锁血不瞬移（阶段2 体质）

某护体体质只授予 `ability_lock_hp`：致死伤害时锁血保命，但不会瞬移逃脱，原地濒死等待疗伤/回血丹。

### 碾压无法锁血

grade2 妖兽击杀凡人，orderGap ≥ crushOrderGap → 授予 `Immune.Crush` → `ability_lock_hp` 被 `blockedByTags` 阻挡 → 直接死亡（符合世界观）。

## 8. 确定性与回退

- 一切随机走 `worldContext.rng` / 实体 `_rng`（ADR-038），不引入新 `Math.random`。
- 机制数值全部在 `data/`（effects/abilities/tags/combat.json），代码只读取执行。
- `combat.json` 新增 `gas.enabled` 开关（默认 true）；关闭时锁血/遁地退回不可用，便于默认关闭不改变既有行为对照。

