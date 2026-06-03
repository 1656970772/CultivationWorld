# ADR-040：修炼节奏校准 + 聚气丹境界递减 + 秘境改为给游历感悟

最后更新：2026-06-02

状态：已实现

## 背景

ADR-039 修复"天才进度满但真气不足卡境界"后，模拟暴露新问题（用户反馈 2026-06-02）：

> 修炼要真气和进度都满了才算；聚气丹不应该有限制，真气可以无限增加和累计，只是低阶弹药对低境界
> 效果好、对高境界越来越差；你这个修改让天才修炼太快了不合理，而且没有游历。

排查发现三个失衡：

1. **修炼飞快的真凶 = 势力"开放秘境"行为**：`FactionOpenSecretRealmExecutor` 每次给全门派每个弟子
   `cultivationProgress += 0.05`，且该行为**无冷却**，势力几乎每天开秘境 → 所有弟子（含天才）进度暴涨，
   与 `cultivationSpeed` 配置完全脱节（配置本意是凡人修满需十几年）。这才是"227天破元婴"的真凶，
   而非天赋系统。
2. **真气线与进度线脱节**：真气主要来自 `qiBaseGain × days`（一次闭关30天固定给30真气），
   与进度增量（一次≈0.7%）无关。凡人修两次真气就满50、进度才1.5%，**真气过早满足 → 修炼目标
   真气项达成 → AI 摆烂不再持续闭关，更不游历**。
3. **聚气丹被错误限制**：ADR-039 加的 `qiBelowNextRank` 前置锁死了"真气无限累积"，且固定 +120
   不符合"低阶丹对高境界递减"。

并明确节奏方向（用户确认）：**修为提升本就该靠机缘、丹药、秘境、天材地宝**，纯闭关到不了元婴是
有意设计（解析显示天才纯闭关单冲炼气需约百年，超凡人寿命）——不改 `cultivationSpeed` 整体提速，
而靠外部资源加速突破（详见 ADR-041 战斗/生存与机缘系统）。

## 决策

### 一、开放秘境改为"给游历感悟 insight、低频盛事"

`act_open_secret_realm`（faction-actions.json）：

- 加 `duration: 365`（占据约一年，频率骤降）；门槛提高（稳定≥60、弟子≥120、灵石≥2000）、`weight` 降到 1。
- 执行器 `FactionOpenSecretRealmExecutor` 不再直接加 `cultivationProgress`，改为给每个弟子
  `insight += 0.03`（夹 `insightCap = 1 - minCultivationRatio`）。
- 语义：秘境是"游历历练"补 insight，受 insightCap 封顶且突破仍要求闭关进度 ≥ minCultivationRatio，
  故是"游历补充"而非"修炼替代"，不破坏个人闭关节奏。

### 二、真气线与进度线同步（双约束）

`cultivation.json`：

- `qiBaseGain` 大幅下调为涓流（凡人 1→0.02/天），不再主导真气。
- `qiPerProgress` 重标定 = `下一境界 qiRequired / cultivationCap × 1.15 富余`（凡人58、炼气822…），
  使真气主要随**闭关进度增量**产出：闭关把进度修到 cap 时真气≈下一境界门槛，恰好够突破。
- `passiveQiGain.base` 下调（凡人 0.15→0.03/天）：被动吸纳真正成为"涓流不为零"，
  不再让真气过早满足。

效果：真气与进度同步增长，二者共同成为突破的硬约束，AI 不再因真气早满而摆烂。

### 三、聚气丹：去限制 + 按境界递减

- 去掉 `act_npc_use_qi_pill` / `act_npc_redeem_qi_pill` 的 `qiBelowNextRank` 前置
  （真气可无限累积、服用无门槛），仅保留 `qiPillCount < 3` 防无意义囤丹。
- `economy.json` 的 `qiPill` 加 `baseRankId/rankDecay/minQiGain`；`npc-economy.computeQiPillGain()`：
  `effectiveQiGain = qiGain × rankDecay^max(0, 当前order - baseOrder)`，夹 minQiGain。
  凡人/炼气吃满120、筑基≈42、金丹≈15、元婴≈5——低阶丹对高境界越来越鸡肋。

### 四、修炼目标：真气 + 进度双满

`need_npc_cultivation` goalState 已要求 `totalProgress >= 1.0` **且** `qiBelowNextRank == false`
（ADR-039 已落，本 ADR 确认保留）。

## 验证

- 用真实模拟（trace 观测真实 NPC，不开特权）确认：秘境修复后进度回归 `cultivationSpeed` 配置节奏；
  真气随进度同步增长、不再过早满足。
- 解析确认：纯闭关到不了元婴是有意设计，外部资源（机缘/丹药/秘境/天材地宝）是主路径 → 引出 ADR-041。

## 关系

- 承接 ADR-039（真气-进度解耦）。
- 引出 ADR-041（战斗/生存 + 机缘/天材地宝加速突破系统）。
- 遵守 AGENTS.md 新增"验证规则"：禁止黄金指纹验证，以真实模拟统计为准。
