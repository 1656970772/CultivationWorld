# 性格系统（Personality）

> 最后更新：2026-05-30
> 状态：已敲定（第一阶段：野心落地，其余维度预留扩展）
> 类型：规则
> 关联文档：`docs/data/data-config-rules.md`、`docs/worldbuilding/wiki/rules/sect-operation.md`、`docs/worldbuilding/wiki/rules/travel-and-risk.md`、`docs/decisions/adr-015-faction-resource-and-promotion.md`、`docs/decisions/adr-017-value-risk-decision-and-cultivation-curve.md`

## 一句话定义

NPC 拥有性格维度（野心 / 谨慎 / 忠诚 / 外交 / 勇敢 / 正义感，0-100），性格通过**数据驱动的配置表**换算为对各类需求优先级的加成，从而让不同性格的人物表现出不同的行为倾向——解决"所有 NPC 行为同质化、没有个性"的问题。

## 已敲定内容

- 性格维度：`ambition`（野心）、`caution`（谨慎）、`loyalty`（忠诚）、`diplomacy`（外交）、`courage`（勇敢）、`justice`（正义感），取值 0-100，定义于 `npcs.json` 的 `personality`，存于 `staticData.personality`（不可变）；未显式配置的维度按 `personality.json` 的 `default`（50）兜底。
- **正义感（justice）**：对公道与是非的坚持。本期仅落地「字段 + 出生赋值 + 遗传变异」，`needBoosts.justice` 留空，**暂不接决策逻辑**；后续接入行侠仗义、惩恶扬善、护道等行为（见 ADR-017）。
- **出生遗传（courage / justice）**：走通用「双亲均值 + 变异」遗传——`child = clamp(0~100, 父母均值 ± personalityMutationRange)`，父母缺该维度回退 50。配置见 `social.json → birth.personalityMutationRange`（默认 20）。
- **勇敢（courage）→ 游历风险**：勇敢不走 `needBoosts`，而是通过 `risk.json` 的 `personalityModifiers` 影响游历风险——勇敢越高，受伤概率越高（≥50 生效），极度勇敢（≥70）陨落概率也略升。体现"艺高人胆大但风险自担"。详见 `rules/travel-and-risk.md`。
- 性格 → 行为的加成关系全部写在配置表 `apps/game/data/balance/personality.json` 的 `needBoosts` 中，**新增维度或新增加成无需改代码**（开闭原则）。
- 加成公式：当性格值 > `minThreshold` 时，对目标需求加成 = `round((trait - minThreshold) / (100 - minThreshold) × maxBoost)`，即阈值处为 0、满值(100)时为 maxBoost，线性插值。可选 `requireState` 门控。
- **第一阶段落地：野心 → 晋升**。野心越高，`need_npc_ambition`（晋升需求）优先级越高；当弟子**本境修为达标（cultivationProgress ≥ 0.6）**时晋升需求进一步抬升，从而压过修炼需求，驱动其发起"挑战上位"（`act_npc_challenge`）。体现"先修为、后争位"的修仙逻辑。
- 受伤时（injuryLevel ≥ 1）晋升需求被抑制（优先疗伤）。

## 叙事表现

- 野心勃勃的弟子在修为到顶后会主动挑战上位，争夺长老/继承人之位（满员则击败现任，现任降级）；野心平平者安于修炼。
- 性格由父辈遗传并带随机变异（见出生逻辑），形成代际差异。

## 规则边界

- 性格只影响**需求优先级**，不直接决定行为结果（结果仍由 GOAP 规划 + 行为执行器结算）。
- 性格不进入 GOAP 状态键（存于 state 的专用字段，不污染规划），故不影响行为的确定性回归（golden test 指纹不变）。
- 与晋升名额规则冲突时，名额规则优先（野心再高，稀缺顶层满员且打不过现任也上不去）。

## 数据与实现提示

- 配置表：`data/balance/personality.json`（traits 定义 + needBoosts 加成表）。
- 评估接入点：`ConfigurableEvaluator._personalityBoost`（读 `entityState.personality` 与 `worldContext.balanceConfig.personality`）。
- 晋升需求：`data/needs/npc-needs.json → need_npc_ambition`，已加入 NPC 默认需求列表。

## 待扩展

- caution（谨慎）：影响回避高风险任务、倾向疗伤/闭关。
- loyalty（忠诚）：影响职责需求、危难挺身、降低叛离倾向（继任排序已使用）。
- diplomacy（外交）：影响势力结盟、议和倾向。
- courage（勇敢）：已落地游历风险加成；后续可扩展为影响主动游历倾向、接高难任务、参与厮杀。
- justice（正义感）：已落地字段+赋值+遗传；后续接入行侠仗义/除魔/护道等决策。
- 性格对势力层行为（扩张/外交）的加成。
- 性格对价值-风险决策的加成（如谨慎↑则放大风险代价、勇敢↑则降低风险代价；见 ADR-017）。

## 来源

- 用户确认：「那就先做一下性格系统，人物有了性格才会对各种需求增加，增加配置表，野心目前就是对宗门有加成，后面会扩展其他的性格和加成的配置」。
- 项目文档：`docs/世界观参考/宗门运行流程与制度平衡分析.md`（多通道、弹性空间原则）。
- 我的判断：野心加成与"修为饱和"门控的组合，用于实现"先修为后争位"的合理节奏。
