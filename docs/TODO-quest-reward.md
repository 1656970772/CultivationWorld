# V1 已落地：任务奖励与 NPC 消费闭环

> 创建日期：2026-05-28
> 最后更新：2026-05-30
> 状态：V1 已完成；炼丹/炼器、完整商店 UI 与 NPC 交易仍待后续扩展

## 当前实现

NPC 完成宗门任务后获得：

- **灵石**：存入 NPC 个人 `inventory.low_spirit_stone`。
- **贡献点**：宗门成员存入 NPC `state.contribution`；散修无宗门贡献。
- **任务类型额外产出**：按 `quest-templates.json → rewardProfiles` 获得材料、丹药、法宝线索或功法书。

宗门获得：

- **灵石**：存入势力 `inventory.low_spirit_stone`。
- **材料库存/稳定度**：宗门成员任务交付与材料捐献会反哺宗门库存和稳定度。

## 2026-05-30 V1 完成项

- [x] `quest-templates.json` 新增 `rewardProfiles`：采药产 `spirit_herb`，采矿产 `ore`，斩妖/除害/猎灵兽产 `monster_core`、`beast_material`，秘境小概率产 `item_breakthrough_pill`、`item_artifact_low/mid`、`technique_book_mid`，巡山/值守/调查提升稳定度。
- [x] `economy.json` 新增 `npcMaterialDonation`：宗门 NPC 可捐材料，获得贡献与月贡献，材料进入宗门库存。
- [x] `economy.json` 新增 `npcExchange`：宗门 NPC 可用贡献和低级灵石兑换聚气丹、破境丹和低阶法器。
- [x] NPC 行为新增材料捐献、兑换/服用聚气丹、兑换/服用破境丹、兑换并装备法器。
- [x] GOAP 状态新增背包派生键：`lowSpiritStone`、`qiPillCount`、`breakthroughPillCount`、`donatableMaterialCount`、`hasEquippedArtifact`。
- [x] 法宝获得入口会自动装备更高 `combatBonus` 的法宝；破境丹加成写入 `breakthroughAidBonus`，一次突破判定后清零。
- [x] 新增验证脚本：`apps/game/tools/test-quest-reward-economy.mjs`、`apps/game/tools/test-npc-consumption-chain.mjs`。

## 后续待完善内容

### 1. 前置系统状态

- [x] **道具/物品系统**：已有 `data/items/items.json` 与 `data/definitions/resources.json`。
- [x] **妖兽系统**：已有 `data/definitions/monsters.json`，V1 先用任务类型产出妖兽材料。
- [x] **宗门商店/兑换系统 V1**：已有数据驱动兑换项，后续可扩为完整商店/UI。
- [ ] **炼丹/炼器系统**：NPC 消费灵石和材料制作物品。

### 2. NPC 灵石消费场景

- [x] 购买丹药辅助修炼（V1：聚气丹）。
- [x] 购买低阶法器并装备（V1：低阶法器）。
- [ ] 购买功法提升修炼速度。
- [ ] 购买续命丹药延长寿命。
- [ ] 交易/赠与其他 NPC。

### 3. 贡献点消费场景

- [x] 兑换门派丹药（V1：聚气丹、破境丹）。
- [x] 兑换低阶法器（V1：自动装备更优法宝）。
- [ ] 兑换门派功法。
- [ ] 申请使用修炼秘境。
- [ ] 提升门派地位/职位。

## 参考

- 任务模板数据：`apps/game/data/quests/quest-templates.json`
- 经济配置：`apps/game/data/balance/economy.json`
- NPC 行为数据：`apps/game/data/actions/npc-actions.json`
- 任务奖励模块：`apps/game/js/engine/npc/quest-rewards.js`
- NPC 经济模块：`apps/game/js/engine/npc/npc-economy.js`
- 数据规范：`docs/data/data-config-rules.md`
