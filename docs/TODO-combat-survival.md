# 接下来要做：战斗与生存系统

最后更新：2026-06-02

> 配套设计见 `docs/decisions/adr-041-combat-survival-system.md`。
> 本清单按阶段推进，逐步完成，每阶段跑真实长程模拟验证（禁止黄金指纹验证，见 AGENTS.md 验证规则）。

## 阶段1：NPC HP + 真实扣血 + 锁血（最小可用）—— ✅ 已完成 2026-06-02

- [x] `data/balance/combat.json` 新增 `npcHp`（各境界 baseHp、dailyRegenRatio）、`npcCombat`（各境界 baseDef）、`lockHp`（lockRatio=0.05、crushOrderGap=40、crushHpMultiple=4.0）。
- [x] `cultivation.json` physique 加 `hpBonusMultiplier`（道体1.6、战体2.5 等）。
- [x] `npc-state.js` 加 `hp`/`maxHp` 字段；`npc-entity._initHp()` 按 baseHp[境界]×体质 hpBonus 初始化并回满。
- [x] `npc-entity.js`：突破成功后 `refreshMaxHpOnBreakthrough()` 重算回满；`_dailyHpRegen()` 每日按 dailyRegenRatio 自然回血（挂 onPreTick）。
- [x] `world-engine` 注入 `combatConfig` 到 entityConfig。
- [x] `monster-entity._attack`：移除对 NPC 的 killChanceFactor 概率秒杀，改为真实伤害扣 hp + 锁血/碾压判定；保留 NPC 反击妖兽（双向伤害交换）。
- [x] `settleRisk`/`applyRiskEffect` 新增 `hp_damage` 类型；risk.json 的 explore/pvp_death 从 `death` 改为 `hp_damage`（plunder/power_struggle 等抽象/秘境类保留概率 death）。
- [x] 真实多种子模拟验证：天才存活从 9~89 天提升到 128~170 天，锁血对非碾压伤害生效。

### 阶段1 遗留结论（重要，指导阶段2）

- 凡人 maxHp 低（道体天才 48），grade2 妖兽（紫焰虎/幽灵狐，order≈35）单击伤害 ~130~205，
  对凡人构成"碾压"（orderGap 或 HP 倍数触发），仍会秒杀。**这符合世界观**（炼气期妖兽碾压凡人）。
- 根治不靠继续堆 HP/调阈值，而靠 **阶段2 门派庇护 +遁地符**：低境界弟子在门派领地内不该被高阶妖兽巡猎，
  万一遇险靠锁血+遁地符脱身。
- 关键根因：妖兽 `_findPrey` 在感知范围内猎任何低阶 NPC，**不区分该 NPC 是否在某势力领地内**。

### 阶段1 后续诊断（1200 天真实模拟，2026-06-02）

天才已能活满 3 年（不再被秒杀，阶段1 生效），但出现新症状：进度从第 8 天的 0.263 起
**整整 3 年几乎不动（末态 0.356），始终未发生任何突破尝试**。一生行为分布：

| 行为 | 占比 |
|------|------|
| 疗伤 | 32.5% |
| 空闲 | 31.3% |
| 修炼 | 20.0% |
| 赴修炼场修炼 | 15.7% |

排查结论（**非 AI 决策 bug**）：

- AI 决策逻辑正确：疗伤需求(优先级 45~85)正确压过修炼(~50)，空闲是决策冷却期(3~12 天)正常静候。
- 真正根因：天才在凡人期被妖兽**反复打伤**，**63.8% 时间耗在疗伤+恢复静候**，
  有效闭关时间被严重碎片化 → 进度推进极慢、长期卡在凡人。
- 这直接印证阶段 2A 的必要性：**只有让低境界弟子在门派领地内不被妖兽猎杀，才能腾出闭关时间正常修炼**。
  在此之前，无论怎么调修炼速度都会被战斗循环吞掉。

> **2026-06-03 更新（ADR-042 GAS 化重构）**：阶段 2B 遁地符与 PvP 致死前置已由 [ADR-042](decisions/adr-042-gameplay-ability-system.md) 的统一伤害管线落地。
> 锁血拆为独立 `effect_lock_hp` 保命 Effect（`ability_lock_hp` 授予），遁地符额外提供 `ability_escape_talisman` 瞬移；
> `monster-entity._attack`/`applyRiskEffect.hp_damage`/`killNPCByPvP` 三处统一改调 `combat-pipeline.applyDamage`，
> 锁血/遁地**不区分攻击者**。功能文档见 `systems/gameplay-ability-system.md`。下方原阶段 2B 清单标注为已被 ADR-042 承载。

## 阶段2：门派庇护 + 遁地符箓

### 2A 门派庇护（先做，根治低境界弟子被秒杀）
- [ ] 妖兽 `_findPrey`/巡猎：跳过处于"势力领地（受护山大阵/门派驻地保护）"内的低境界 NPC，
      或妖兽不主动进入势力总部/领地格。具体规则与世界观对齐（妖兽畏惧高阶坐镇的宗门）。
- [ ] 数值/开关走 `combat.json` 或 `monster-spawn.json`，数据驱动可回退。

### 2B 遁地符箓

> **前置缺口（真实模拟发现，2026-06-02）**：天才曾第125天"死于仇杀(slain)"。排查发现
> **PvP 致死走 `killNPCByPvP()` 是直接秒杀（alive=false），绕过 HP/锁血系统**，
> 阶段1 只把【妖兽攻击】和【野外/猎妖风险】改成了真实扣血，**仇杀/劫掠/夺权等 PvP 仍是概率直接死**。
> 既然 PvP 不锁血，就永远没有"hp<5% 濒死"时机 → 即便遁地符做好了，在仇杀场景也不会触发。
> 故遁地符要真正在 PvP 生效，必须先把 PvP 致死纳入真实扣血/锁血。

- [ ] **PvP 致死改造（遁地符前置）**：`killNPCByPvP()`（仇杀 `NPCKillEnemyExecutor`、劫掠 `info-actions`、
      夺权等调用方）由"直接 alive=false"改为"真实伤害扣 hp + 锁血/碾压判定"，复用妖兽攻击的锁血逻辑
      （非碾压锁血到 5%maxHp，碾压才直接死）。秘境等抽象场景仍可保留概率死亡。
- [ ] `data/items/items.json` 新增 `item_escape_talisman`（遁地符，可分品阶）。
- [ ] `data/entities/npcs.json`：天才 npc_999 初始携带 2 个遁地符。
- [ ] 兑换行为 `act_npc_redeem_escape_talisman`（贡献+灵石兑换）+ 执行器。
- [ ] 触发逻辑：`hp < 5% maxHp`（锁血濒死，含妖兽/PvP）自动消耗 1 符 → 瞬移随机安全位置 + 清妖兽/仇人锁定。

## 阶段3：回血弹药 + AI 疗伤

- [ ] `item_heal_pill`（回血丹），服用回 hp，低阶丹对高境界回血递减（复用 ADR-040 rankDecay）。
- [ ] 兑换 + 服用行为及执行器。
- [ ] 新增 need/action：hp 低于阈值时主动服回血丹/疗伤。

## 阶段3.5：突破回满血特效（功法/秘法/体质）

> 背景：突破默认只抬高 maxHp 上限、**不回满当前 hp**（见 `npc-entity.refreshMaxHpOnBreakthrough`）。
> 突破就是突破，回满血应是少数功法/秘法/体质的特殊效果，而非普遍机制。

- [ ] 在功法/秘法定义中支持 `breakthroughFullHeal`（或类似）特效标记。
- [ ] 体质（physique）支持「突破回满/超额回血」特效（如某些淬体类体质）。
- [ ] `refreshMaxHpOnBreakthrough` 读取实体的功法/秘法/体质特效：命中则突破时回满（或超额）hp，否则保持当前 hp 夹新上限。
- [ ] 数据驱动、可回退；与世界观对齐（标注参考来源）。

## 阶段4：天材地宝 + 机缘加速突破

- [ ] 天材地宝道具（回血/淬体/助突破，分品阶与境界挂钩）。
- [ ] 游历/秘境/任务概率产出机缘（大量 insight/qi/progress）与天材地宝。
- [ ] 高境界突破主要依赖外部资源，校验天才几十年到元婴的节奏。

## 阶段5：验证与归档

- [ ] 跨种子真实长程模拟统计（存活率、境界分布、死因分布、天才轨迹）。
- [ ] 完善 ADR-041 状态为"已实现"，补最终数值。
- [ ] 同步 `docs/worldbuilding/wiki/` 战斗/生存相关条目，标注世界观来源。
- [ ] 更新 `docs/README.md` 导航。
