# 流派执念规则（夺宝 / 养老 / 传承 / 夺权）

> 最后更新：2026-05-30
> 状态：已敲定
> 类型：规则
> 关联文档：`docs/decisions/adr-023-archetype-goal-system.md`、`docs/decisions/adr-022-expected-value-utility.md`、`docs/systems/behavior-tree.md`、`docs/worldbuilding/wiki/rules/personality.md`、`docs/worldbuilding/wiki/rules/leader-succession.md`、`docs/worldbuilding/wiki/rules/natural-death.md`

## 一句话定义

流派执念是在原有五种执念（supremacy/longevity/revenge/protect_dao/resurrection）之外新增的四种"人生取向"执念，每种指向**不同的世界状态终点**（而非都收敛到"闭关变强"），使同境界、同局面的 NPC 能做出差异化选择，从而生成修仙世界故事。

## 已敲定内容

| 流派 | 执念类型 | 目标终点（goalState） | 终点行为 | 触发方式 | 触发条件 |
|------|---------|----------------------|---------|---------|---------|
| 夺宝流 | `plunder` | `treasureObtained=true` | `act_npc_raid_treasure` | 先天 roll | 勇敢 ≥ 75，概率 0.45 |
| 夺权流 | `power` | `isFactionLeader=true` | `act_npc_seize_power` | 先天 roll | 野心 ≥ 80，概率 0.4 |
| 养老流 | `retire` | `atPeace=true` | `act_npc_seclude` | 条件触发 | 寿元过七成 + 野心 ≤ 40，每日概率 0.015 |
| 传承流 | `legacy` | `discipleRaised=true` | `act_npc_take_disciple` | 条件触发 | 寿元过七成五 + 职位阶 ≥ 3，每日概率 0.02 |

- **夺宝流**：高勇敢、低谨慎者天生爱冒险博机缘，铤而走险闯秘境/夺天材地宝。配合期望收益模型（ADR-022），秘境收益按概率分布（仙器/极品法宝/材料/空手）算期望，赌狗流（低风险厌恶）才会被高期望收益吸引。
- **夺权流**：高野心者天生觊觎掌门之位，复用 `act_npc_challenge` 阶梯晋升链，最终经 `act_npc_seize_power` 接掌一方。须先达到职位阶 ≥ 4 方可发起夺权（见 GOAP 可达性）。
- **养老流**：寿元过半、野心低、突破无望者，倾向回宗门/洞府安养余生而非冒险冲关。属"随年龄演化自然萌生"的取向，故用条件触发而非先天 roll。
- **传承流**：高境界且寿元将尽者，优先收徒、传授功法，把衣钵传下去。

## 执念触发机制（三类）

除原有的两类触发外，本次新增第三类"条件触发"：

| 触发类 | 实现入口 | 时机 | 适用流派 |
|--------|---------|------|---------|
| 先天 innate | `_rollInnateObsession` | 出生时按人格/灵根 roll | 夺宝、夺权 |
| 后天 acquired | `_checkAcquiredObsession` | 高强度记忆事件触发 | 复仇、复活 |
| 条件 conditional | `_checkConditionalObsession` | onPreTick 每日按 `requireState`（寿元/境界）+ `requireTrait` + `chance` 检查 | 养老、传承 |

养老/传承是"人到暮年自然萌生"的人生取向，先天 roll（出生定）与记忆触发（事件驱动）都不贴合，故新增条件触发。

## 数据与实现提示

- 触发规则：`apps/game/data/balance/obsession.json`
  - `innate.rules`：夺宝（`requireTrait.courage>=75`）、夺权（`requireTrait.ambition>=80`）。
  - `conditional.rules`：养老（`lifeRatio>=0.7` + `ambition<=40`）、传承（`lifeRatio>=0.75` + `roleRank>=3`）。
  - `goalMult`：四种执念对同方向需求的放大乘子。
- 执念枚举：`apps/game/js/engine/abstract/obsession-system.js` 的 `ObsessionType` 增 `PLUNDER/RETIRE/LEGACY/POWER`。
- 状态键：`apps/game/js/engine/npc/npc-state.js` 增 `treasureObtained/atPeace/discipleRaised/isFactionLeader`。
- 终点行为：`apps/game/data/actions/npc-actions.json` 定义 4 个行为；`apps/game/js/engine/npc/npc-actions.js` 实现并注册对应 Executor。
- 期望收益：`apps/game/data/balance/reward.json` 配置 `obsession_plunder` 等目标的概率收益分项（ADR-022）。
- 条件触发实现：`apps/game/js/engine/npc/npc-entity.js` 的 `_checkConditionalObsession` / `_matchStateCondition`，由 onPreTick 每日调用。

## GOAP 可达性保证

每个新 goalState 键都有唯一终点行为可推进，行为前置可在日常状态下满足：

- 夺宝/养老：无特殊前置，可直接规划。
- 传承：需 `roleRank>=3`（职位达到一定层级才有资格收徒）。
- 夺权：需 `roleRank>=4`，须先经 `act_npc_challenge` 阶梯晋升，避免直接夺权造成规划失败。

## 世界观来源（遵循 AGENTS.md 世界观规则）

- **夺宝流**：参考《凡人修仙传》杀人夺宝 / 闯秘境（见 `docs/世界观参考/凡人修仙传/冲突事件分析.md`、`散修生存方式.md`）。✅ 有原著依据
- **传承流**：参考《大道争锋》传承道统、《遮天》大帝晚年收徒（见 `docs/世界观参考/大道争锋/`、`docs/世界观参考/遮天/`）。✅ 有原著依据
- **夺权流**：参考《凡人修仙传》/《大道争锋》掌门继任之争（见 `docs/worldbuilding/wiki/rules/leader-succession.md`）。✅ 有原著依据
- **养老流**：⚠ 在 `docs/世界观参考/` 中**未找到**"高龄修士主动放弃突破、安享余生"的直接原型，仅有"太上长老闭关、五灵根炼气终老"等间接片段。故养老流标注为**项目推演设定**，不声称有原著依据，已在数据 `_comment`、`obsession-system.js` 注释与 ADR-023 中明示。

## 待扩展

- 传承流产生的新弟子是否在世界中生成为新 NPC（当前为提升既有弟子）。
- 夺宝流秘境收益与物品系统（`docs/TODO-quest-reward.md`）的衔接。
- 各流派的人口占比目标与平衡调参（见 ADR-023 风险与平衡验证）。
- 养老流后续若在世界观参考中找到原著原型，应回填来源并去掉"项目推演设定"标注。
