# ADR-042：战斗系统 GAS 化重构（Attribute / Effect / Ability / Tag / Cue 机制层）

最后更新：2026-06-03

状态：**阶段0（设计文档）+ 阶段1（机制内核 + 锁血/遁地符拆分）+ 阶段2（现有功能机制化迁移）+ 阶段3（验证归档）均已落地 2026-06-03**。后续新机制按本 ADR 范式增量扩展。

## 背景

ADR-041 阶段1 落地了"NPC HP + 真实扣血 + 锁血"，但实现方式是把"伤害→扣血→锁血→死亡"逻辑**散写在三处**，各自为政、规则不一致：

1. `monster-entity._attack`（[apps/game/js/engine/monster/monster-entity.js](../../apps/game/js/engine/monster/monster-entity.js)）：真实扣血 + 锁血 + 碾压判定（orderGap + crushHpMultiple）。
2. `applyRiskEffect` 的 `hp_damage` 分支（[apps/game/js/engine/npc/actions/npc-action-utils.js](../../apps/game/js/engine/npc/actions/npc-action-utils.js)）：另一套锁血实现（仅判 crushHpMultiple，无 orderGap）。
3. `killNPCByPvP`（同上文件）：**直接 `alive=false`，完全绕过 HP/锁血**。被仇杀/劫掠/夺权执行器调用。

由此带来两个根本问题：

- **锁血被"固定绑死"在妖兽攻击路径上**：PvP/夺权场景永远不会锁血，遁地符即便实现也不会触发（见 [ADR-041/ADR-042](adr-041-combat-survival-system.md) 阶段 2B 前置缺口）。
- **NPC 级缺少统一的"状态效果叠加层"**：丹药/灵根/体质/境界压制等修正散落在各处 `state.set`，加减不对称、难追溯、难组合（参见 [docs/architecture/reference-acs-rimworld.md](../architecture/reference-acs-rimworld.md) §5.1：tuning-v6 已踩过"声明式 op:add 无上限溢出"的坑）。

用户要求（2026-06-02 / 06-03）：

> 现在固定妖兽攻击会锁血，没有固定锁血机制，然后锁血这个要做成单独的机制，给遁地符箓挂上，这样遁地符箓就有锁血的功能了，而且不区分攻击者是谁。整个战斗系统也要参考虚幻引擎的 GAS 实现，然后把之前游戏里的功能，能重构为机制的都重构一下，然后用好虚幻引擎的 GameplayTag（https://github.com/tranek/GASDocumentation）。这样功能可以组合。

用户确认的关键决策：

- 全面机制化（GAS Effect/Modifier），但**分阶段**，不必一次做完。
- 锁血与遁地符**拆成两个独立可组合能力**：锁血是"保命 Effect"可由多来源授予，遁地符额外提供"瞬移逃脱"；先用遁地符把两者都挂上。
- GameplayTag 采用**层级字符串**（如 `State.Dying`、`Ability.Escape`、`Effect.LockHP`、`Immune.Crush`）+ TagContainer 父标签匹配，数据驱动组合。
- 确定性必须保持（走 `worldContext.rng`/实体 `_rng`，不引入新 `Math.random`，ADR-038）。旧摘要回归仅作重构期默认关闭不改变既有行为校验，**不作日常关卡**；新功能由数据开关控制可回退；以真实多种子长程模拟统计验证为准，禁止旧摘要回归式作弊（AGENTS.md 验证规则）。

## 决策

参考 UE5 GameplayAbilitySystem（GAS）的核心抽象，**取其精髓、舍其多人网络复制**，在本项目落地一套可组合的机制层。

### GAS → 本项目映射

| UE GAS | 本项目落地 | 文件 |
|--------|-----------|------|
| AbilitySystemComponent (ASC) | `AbilityComponent`（挂在 `BaseEntity`，持 Tag 容器 + 已授予 Ability + 活跃 Effect） | `engine/abstract/ability-component.js` |
| Attribute / AttributeSet | `AttributeSet`（基值 + Σ修正层，`getEffective(key)`） | `engine/abstract/attribute-set.js` |
| GameplayEffect (GE) | `GameplayEffect` 数据驱动 + `EffectEngine`（Instant/Duration/Infinite，对称 enter/leave） | `engine/abstract/gameplay-effect.js` + `data/effects/*.json` |
| GameplayAbility (GA) | `GameplayAbility` 数据驱动 + `AbilityExecutor`（Tag 触发 + 消耗 + 授予 Effect） | `engine/abstract/gameplay-ability.js` + `data/abilities/*.json` |
| GameplayTag | 层级字符串 + `TagContainer`（父标签匹配） | `engine/abstract/gameplay-tag.js` + `data/tags/tags.json` |
| GameplayCue | 映射到 `worldContext.infoEvents` / tickLog 叙事（无独立特效层） | 复用现有事件总线 |

### 核心设计原则

1. **属性读取改为「基值 + Σ修正层」**：`AttributeSet.getEffective(key)`，杜绝直接覆写基值（对齐 ACS `ModifierBase` Enter/Leave 对称、RimWorld stat 聚合）。机制层未接管的属性仍直接读 `state`（向后兼容）。
2. **Effect 三类生命周期**：
   - **Instant**：一次性，立即结算（伤害、回血、扣真气）。
   - **Duration**：限时 buff/debuff，倒计时到期对称撤销（护体、丹毒、加速）。
   - **Infinite**：常驻直到移除条件命中（先天特质、灵根/体质加成、境界压制）。
3. **Ability 由 Tag 驱动触发与阻挡**：能力声明 `triggerTags`（满足则可激活）、`blockedByTags`（持有则禁用）、`requiredItems`（消耗道具）、`grantsEffects`（激活时授予的 Effect）。
4. **统一伤害管线**：`combat-pipeline.applyDamage(source, target, damageSpec, worldContext)` 是**唯一**的"造成伤害并可能致死"入口，内部固定流程：
   ```
   结算伤害量 → 扣 hp → 若 hp<=0：
     ① 标记 Trigger.LethalDamage Tag → 给被动 Ability 机会（ability_lock_hp 锁血保命）
     ② 锁血成功 → 授予 State.Dying Tag → 给 ability_escape_talisman 机会（瞬移逃脱）
     ③ 仍致死（碾压 / 无保命能力）→ 真实死亡，写 _deathInfo
   ```
   旧调用方全部改调此入口，锁血/遁地从此**不区分攻击者**。
   > **2026-06-03 验证补记**：阶段3 真实模拟发现死亡入口实为**四处**而非三处——除妖兽攻击、风险 hp_damage、PvP 仇杀/劫掠（`killNPCByPvP`）外，**势力攻战群体击杀**（`faction-ai-service.attackEnemy` 内的 `cause:'slain'` 直写）此前同样绕过锁血。已一并改调 `applyDamage`（经 `worldContext` 透传），四处统一。

### 锁血与遁地符拆分（用户核心诉求）

- **`effect_lock_hp`（保命 Effect）**：Instant Effect，把 hp 锁到 `lockRatio × maxHp` 并授予 `State.Dying` Tag。**与来源无关**。
- **`ability_lock_hp`（锁血能力）**：被动能力，`triggerTags: [Trigger.LethalDamage]`、`blockedByTags: [Immune.Crush]`，激活时授予 `effect_lock_hp`。可由遁地符、护身符、特殊体质等多来源授予。
- **`ability_escape_talisman`（遁地能力）**：被动能力，`triggerTags: [State.Dying]`、`requiredItems: [item_escape_talisman]`，激活时消耗 1 符 → 瞬移到地图随机安全位 + 清妖兽/仇人锁定。
- **遁地符道具 `item_escape_talisman`** 同时授予 `ability_lock_hp` 与 `ability_escape_talisman` 两个能力 → 持符者既能锁血又能瞬移逃脱；只有锁血来源（如某体质）则只锁血不瞬移。这就是"可组合"。

### 碾压（无法锁血）的 Tag 化

碾压判定（来袭者 order 高出 ≥ `crushOrderGap`，或单击伤害 ≥ `maxHp × crushHpMultiple`）在 `applyDamage` 中转化为给目标临时授予 `Immune.Crush` Tag（语义："本次致死无法被锁血保命"），从而 `ability_lock_hp` 被 `blockedByTags` 阻挡。高阶碾压低阶仍直接死，符合世界观。

## 实施阶段

1. **阶段0（已完成 2026-06-03）**：本 ADR + 功能文档 `docs/systems/gameplay-ability-system.md` + 数据目录约定。
2. **阶段1（已完成 2026-06-03）**：机制内核（Tag/AttributeSet/Effect/Ability/AbilityComponent）+ 统一伤害管线 + 锁血/遁地符拆分 + 三处调用方改造 + 遁地符道具/天才初始携带。
3. **阶段2（已完成 2026-06-03）**：现有功能逐项机制化迁移，每项数据开关可回退、迁移后默认关闭不改变既有行为校验。五项落地如下，**全程摘要 `1169158b` 不变（开/关开关均一致）**：
   - **先天特质 Tag 层（基础）**：灵根/体质表达为 `Trait.SpiritRoot.<id>` / `Trait.Physique.<id>` 查询标签（`NPCEntity._initAbilityComponent` 授予），建立可组合查询层。
   - **灵根/体质加成迁为 AttributeSet 修正层**（`apps/game/js/engine/npc/npc-traits.js`）：`speedMultiplier`/`breakthroughBonus`/`lifespanBonus`/`hpBonusMultiplier` 注入派生属性键 `traitSpeedMult`(×)/`traitBreakthroughBonus`(+)/`traitLifespanBonus`(+)/`traitHpMult`(×)，各读取点（`_computeMaxHp`/`_passiveQiAbsorb`/`npc-lifecycle` 突破与寿元/`cultivation-actions` 修炼速度）改为经 `readTrait*` 查 AttributeSet。`AttributeSet` 新增 `setDefaultBase`（乘法类基值 1、加法类基值 0）。数值仍以 `cultivation.json spiritRoot/physique` 为单一真相源。开关：`cultivation.json traitEffects.enabled`（默认 true）。
   - **丹药迁为 Effect**：聚气丹/破境丹效果由 `EffectEngine.applyEffect` 结算，执行器不再直接 `state.set`。`EffectEngine` 扩展 `magnitudeType: rankDecay`（复用 ADR-040 境界递减）与 `clamp`（上限夹取）。开关：`economy.json npcExchange.useItems.pillEffects.enabled`（默认 true）。
   - **【阶段2 增强】Effect 通用原语化 + 数值来源参数化**：废弃"一物一专用 Effect"（删 `ge_qi_pill`/`ge_breakthrough_pill`/`ge_breakthrough_full_heal`），改为通用原语 `apps/game/data/effects/core-effects.json`（`ge_add_qi`/`ge_add_qi_over_time`/`ge_add_hp`/`ge_add_progress`/`ge_add_breakthrough_bonus`/`ge_full_heal`）。GE 只声明机制（attribute/op/默认量纲），**具体数值由挂载来源提供**——丹药/灵果(`item_spirit_fruit`)/强者精血(`item_strong_blood`)等在 `items.json` 的 `effects` 字段声明数值，经 `applyEffect(target,def,{spec})` 用 spec 覆盖。`EffectEngine.applyEffect` 返回各 modifier `{attribute,delta,newValue}`（供叙事事件取实际增量），`clamp` 端点支持动态键 `"maxHp"`。统一入口 `npc-economy.applyItemEffects(entity,itemId)`。**决策依据**：同一 `ge_add_qi` 被聚气丹(120)/灵果(40)/强者精血(500) 复用、数值各取自各自物品，符合 GAS"Effect 是可组合机制原语"本意；多来源复用经 `tools/verify-effect-reuse.mjs` 真实校验，确定性摘要 `1169158b` 默认关闭不改变既有行为。
   - **境界压制/碾压由 `Immune.Crush` Tag 统一驱动**：阶段1 已在 `combat-pipeline` 中以 `isCrush`（`orderGap≥crushOrderGap` 或 `dmg≥maxHp×crushHpMultiple`）授予 `Immune.Crush`，经 `ability_lock_hp.blockedByTags` 阻断锁血。阶段2 确认并固化该机制为唯一碾压驱动路径。
   - **突破回满血特效**（`apps/game/data/effects/cultivation-effects.json` `effect_breakthrough_full_heal`）：持 `Trait.BreakthroughFullHeal` Tag（特殊功法/体质授予）的实体突破成功时回满血（`hp override → maxHp`），由 `NPCEntity.tryBreakthroughFullHeal` 在 `npc-lifecycle` 突破成功后调用。默认无 NPC 持该 Tag，故默认不触发（默认关闭不改变既有行为）。
   - **world-rules 世界级 modifier 收编为统一 AttributeSet 模型**：`_aggregateModifierEffects` 改用一个世界级 `AttributeSet`（无 state、默认基值 0）把每条 modifier 的每个效果键作为 `add(value×intensity)` 叠加，聚合 = `getEffective(key)`，与旧累加同顺序数学等价。世界级与 NPC 级加成共用同一 add 叠加语义。
4. **阶段3（已完成 2026-06-03）**：见下"验证方式"。多种子长程模拟（3 种子 × 800 天）统计正常，开/关开关摘要一致证明默认关闭不改变既有行为，文档/数据规则已同步。

## 验证方式（遵守 AGENTS.md 验证规则）

- **禁止旧摘要回归验证**：不给天才/特定对象开免疫、不隔离妖兽、不造一次性作弊脚本自证。
- 重构期旧摘要回归仅作**默认关闭不改变既有行为校验工具**：阶段1 默认开关下行为应与 ADR-041 阶段1 基线一致（锁血逻辑等价迁移）。
- 真实长程模拟（多种子、全量 NPC、足够天数）统计：锁血在妖兽/PvP/风险/攻战四场景均生效、遁地符触发率、低境界弟子存活、天才能否在寿命内推进境界、死因分布。

### 验证结果（2026-06-03，`tools/verify-gas-combat.mjs`，3 种子 × 800 天，全量 NPC，无任何特权/隔离）

- **确定性**：`tools/verify-determinism.mjs`（GAS 激活）同种子双跑摘要一致（`1169158b`），不同种子相异 —— 锁血/遁地全程走 `worldContext.rng`/实体 `_rng`，无确定性漂移。
- **阶段2 迁移默认关闭不改变既有行为（真实等价证明，非旧摘要回归）**：把 `traitEffects.enabled` 与 `pillEffects.enabled` 两开关**关闭**（回退旧的直接读 config / 直接 state.set 路径）后再跑确定性校验，摘要**仍为 `1169158b`** —— 与开关开启（走 AttributeSet/EffectEngine）完全一致，证明灵根/体质加成、丹药结算、world-rules 聚合三项迁移在新旧两条路径上数值严格等价，开关可双向回退。
- **统一管线打通**：3 种子合计 `slain`(PvP+攻战) 死亡 34 例**全部**经 `applyDamage` 真实致死（`经管线真实致死: {monster:182, slain:34}`），此前 PvP/攻战绕过锁血的缺口已闭合。
- **锁血/遁地生效**：天才 npc_999 在妖兽致死场景被锁血保命并祭出遁地符瞬移脱险（3 种子中 2 次用掉遁地符）；锁血机制在不区分攻击者前提下真实生效。
- **非作弊性自证**：天才用完 2 张遁地符后仍会真实死亡（锁血≠不死），符合"延寿而非免死"的世界观，数据为真实模拟统计。
- **待后续平衡**：天才以凡人之身早夭、未在 800 天内推进境界，属既有平衡议题（非本次 GAS 重构回归），后续按 ADR-040/041 节奏调参时复核。

### 2026-06-03 补充修正：遁地落点改为"遁向本势力安全区" + trace-genius 工具补齐 GAS 资产

天才模拟复盘（`tools/trace-genius.mjs`）暴露两个独立问题，均已修复：

1. **遁地符落点缺陷（机制修正）**：原 `escape_teleport` 执行器是**全图随机**落点（且误用默认地图尺寸 100），会把残血遁走的低阶修士随机扔到危险区——天才第 5 天锁血+遁地成功脱险后被甩到陌生坐标，残血状态下第 6 天即撞上 grade3 妖兽**碾压**（orderGap≥40 跳过锁血）二次致死，使"保命符反而害命"。与 line 68"瞬移到安全位"的设计意图相悖。
   - **修正**：`escape_teleport` 改为优先遁向**本势力总部（`staticData.headquarters`）周围 `safeRadius`（妖兽生成低阶安全带）内的可通行格**；取不到所属势力总部时兜底全图随机（用正确地图尺寸）。`worldContext` 经 `WorldContextBuilder` 新暴露 `monsterSpawner`（读 `safeRadius`/`mapWidth`/`mapHeight`）。随机仍走实体 `_rng`/`worldContext.rng`，确定性保持。
   - **验证**：`verify-determinism` 同种子双跑摘要一致（`183b5fe3`，因落点逻辑变更轨迹故较旧 `1169158b` 改变，属预期行为变更而非回归）；`verify-gas-combat` 3 种子×800 天全 OK，锁血合计 42 次、遁地 4 次于真实模拟生效，PvP/攻战四场景统一管线无回归。
2. **trace-genius 工具缺陷（验证工具修正）**：`trace-genius.mjs` 的 `configs` 未加载 GAS 三资产（`tags`/`effects`/`abilities`），导致其模拟世界里锁血/遁地能力根本未被授予——天才"遁地符没生效、第 5 天即死、全程纯 idle"实为工具未加载 GAS 所致，非游戏逻辑问题。补齐后天才正常修炼、遁地符反复生效、存活至第 416 天。

### 遗留（独立平衡议题，非 GAS 范畴）

天才补齐 GAS 后仍止步凡人：416 天近乎全程"赴修炼场闭关"，`cultivationProgress` 顶到凡人 cap（≈0.31）后封顶，`insight`（游历感悟）始终为 0，`totalProgress=0.31+0<1.0` 永不触发突破（`npc-lifecycle.tryBreakthrough` 第一道门槛）。即"天才只闭关不游历→根基达 cap 但悟性零→突破链路卡死"，属修炼/行为决策的平衡议题，待后续单独处理。

## 与既有 ADR 的关系

- **承接 ADR-041**：阶段1 的散落锁血逻辑收编为本 ADR 的统一伤害管线；ADR-041 阶段2B 的"PvP 致死纳入锁血"由本 ADR 的 `combat-pipeline` 一并解决。
- 依赖 **ADR-038**（确定性种子/重放）做可复现模拟验证。
- 落地 [docs/architecture/reference-acs-rimworld.md](../architecture/reference-acs-rimworld.md) §5.1（统一 Modifier 生命周期）的草案：本项目的 `GameplayEffect` 即该文所述"叠加层 + 对称撤销"。
- 与 **ADR-040**（聚气丹境界递减）协同：阶段2 的丹药迁移为 Effect 时复用 rankDecay。

