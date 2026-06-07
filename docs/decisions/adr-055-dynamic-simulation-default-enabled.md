# ADR-055：动态模拟底座默认启用

最后更新：2026-06-07

状态：已采纳并实施（2026-06-07）。

## 背景

Utility 选目标、期望收益、Reaction 即时反应、信息传播、机会点与怀璧其罪此前均以 `enabled=false` 作为默认值。原因是这些系统落地时属于高影响行为层：开启后会改变 NPC 目标选择、突发事件响应、江湖消息扩散、机会热点与抢夺链路，因此先用默认关闭保护旧模拟行为，并方便做回退对照。

随着 Job/Toil 与动态世界底座逐步落地，首版默认体验需要直接呈现“消息会传播、机缘会吸引人、被攻击会反应、宝物会招祸、不同性格会因收益风险做不同选择”的动态修仙世界，而不是只保留静态/低涌现路径。

## 决策

以下配置从默认关闭改为默认启用：

- `apps/game/data/balance/utility.json`：`enabled=true`，启用 Utility 选目标考量因素。
- `apps/game/data/balance/reward.json`：`enabled=true`，启用期望收益建模。
- `apps/game/data/balance/reaction.json`：`enabled=true`，并启用 `eventReplan.enabled=true`。
- `apps/game/data/world/news.json`：`enabled=true`，启用新闻传播。
- `apps/game/data/world/opportunities.json`：`enabled=true`，启用世界机会点。
- `apps/game/data/balance/covet.json`：`enabled=true`，启用怀璧其罪/觊觎抢夺。

这些开关仍保留为数据配置，可在需要回退对照、定位问题或做平衡实验时手动改回 `false`。

## 影响

- NPC 默认会在目标评分中使用考量因素、期望收益与风险压制，而不是只按裸 `priority` 选择目标。
- 被攻击和大事件默认会触发 Reaction 与立即重决策，长期行为链可能被突发事件打断。
- 世界事件默认会产生新闻和机会点，NPC 可因知晓机缘而前往热点。
- 高价值资产默认可能暴露并引发觊觎、放过或抢夺链路。

## 验证要求

这是有意改变默认模拟体验的配置决策，验证应关注真实长程模拟中的行为是否合理：新闻/机会/反应/抢夺是否发生，NPC 是否能恢复正常行为，人口与资源节奏是否稳定。不得用指纹或摘要一致性来证明本次默认启用“未改变行为”。

## 关联

- ADR-020：Consideration 乘法式 Utility 选目标层。
- ADR-022：期望收益 Utility 模型。
- ADR-024：信息传播与机会点系统。
- ADR-025：实物系统与怀璧其罪。
- ADR-048：四层反应式 AI 架构。
