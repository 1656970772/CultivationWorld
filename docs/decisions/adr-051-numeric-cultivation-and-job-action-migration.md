# ADR-051：数值修为与 NPC Action Job 化迁移

> 最后更新：2026-06-07
> 状态：已采纳
> 关联：ADR-039、ADR-042、ADR-048、ADR-049、ADR-050
> 来源：用户 2026-06-05 对“旧 Action 迁移到 Job/Toil、斩妖任务类型化并真实杀怪、主动妖兽伤害仅调 `monster_ambush` 单击倍率、修炼进度改为明确数值修为、非闭关事件追加历练修为”的要求。

## 背景

ADR-050 已经把复杂 NPC 行为引入 Job/Toil，但首批只覆盖动态事件、补给和部分经济准备。旧 NPC 直接执行型 Action 仍与 Job/Toil 并存，导致新增任务、战斗、游历和修炼收益可能继续绕过新执行层。

修炼系统此前以 `cultivationProgress` 与 `insight` 的 0..1 比例表达突破进度。这个口径不适合和真气并列展示，也不利于任务、游历、动态事件、战斗等外出行为按价值和风险产出明确收益。

妖兽伤害方面，本次只需要降低地图妖兽主动袭击 NPC 的单击伤害倍率，不能误伤 NPC 反击、斩妖任务、PvP 或普通任务风险。

## 决策

1. NPC 旧直接执行型 Action 迁移为 JobAction + Job + Toil。GOAP 仍规划 Action，但 NPC 新行为必须使用 `executionKind:"job"` 的 JobAction；真实执行由 Job/Toil 推进。
2. `apps/game/data/actions/npc-actions.json` 不再承载已迁移 NPC 主路径行为；`apps/game/data/actions/npc-action-sets.json` 的默认 NPC 行为集不得引用已迁移旧 Action id。
3. 新增 NPC 行为必须同时补齐 `npc-job-actions.json`、`apps/game/data/jobs/*.json`、`apps/game/data/toils/*.json` 与对应 Toil executor 注册。
4. 修炼进度数值化为 `cultivation`、`experienceCultivation`、`totalCultivation`。其中 `cultivation` 表示闭关/修炼场/丹药等直接修炼所得，`experienceCultivation` 表示任务、游历、动态事件、机会点、PvP、外出社交所得，`totalCultivation` 用于突破修为门槛。
5. 旧比例进度字段在后续重构中已从运行时、快照、UI、报告和应用工具移除。当前运行时只保留 `cultivation`、`experienceCultivation`、`totalCultivation`、`rankStage` 与真气 `qi` 等数值字段；突破同时检查修为、最低闭关修为占比与真气。
6. 非闭关、非原地待命事件通过统一入口追加历练修为，收益按事件价值、风险、耗时和结果倍率计算。闭关修炼、原地等待、纯状态刷新和已死亡 NPC 的失败结果不追加历练修为。
7. 斩妖、除害、猎灵兽等杀怪任务类型化为 `monster_hunt` 任务实例，必须记录坐标、价值、风险、妖兽名、妖兽 id、妖兽阶位、要求数量和击杀进度。
8. 斩妖任务完成必须对应地图活体妖兽真实死亡。目标妖兽死亡原因使用 `quest_hunt`，并进入妖兽死亡日志；目标失联时可重定向同阶附近妖兽，找不到替代目标则任务失败。
9. 地图妖兽主动袭击 NPC 的伤害倍率只属于统一战斗服务的 `monster_ambush` 场景，配置为 `monster-spawn.json` 的 `combat.damageMultiplier`。NPC 反击、斩妖任务、PvP、普通任务风险使用各自场景系数，不读取该倍率。

## 后果

- NPC 行为扩展集中到 Job/Toil，任务、战斗、修炼、社交外出等复杂行为都能被拆成可观察步骤。
- 任务实例从扁平 state 字段收敛为结构化对象，斩妖任务不再能抽象完成，必须绑定真实目标并更新真实击杀进度。
- 数值修为可以和真气并列展示，例如 `总修为 642 / 1000` 与 `真气 530 / 500`，突破判定更清晰。
- 历练修为让任务、游历、动态事件、机会点、战斗和外出社交成为修为成长来源，高价值高风险事件能给更多收益。
- 旧字段和旧 executor 已完成主路径清理；后续若新增修炼相关功能，应直接使用数值修为接口，不能重新引入比例进度口径。
- 战斗调参更容易定位：调低 `monster_ambush` 不会改变斩妖任务、PvP 或普通任务风险。

## 验证要求

验证应使用真实配置和完整模拟观察行为结果：

- 默认 NPC 行为集中已迁移旧 Action id 不再出现，对应 JobAction、Job、Toil 均能加载。
- JobAction、Job、Toil 在真实模拟中有执行记录，旧直接执行型 NPC Action 默认执行次数为 0。
- 斩妖任务日志包含任务类型、坐标、价值、风险、妖兽名、妖兽 id、阶位和击杀进度。
- `quest_hunt` 妖兽死亡进入 `monsterDeaths`，任务完成数量来自真实击杀。
- 任务、游历、动态事件、机会点、PvP、外出社交能增加 `experienceCultivation`，闭关和原地等待不增加。
- UI、分析工具和报告文案使用“修为”数值口径，真气单独显示；应用目录旧字段精确搜索应无命中。
- 妖兽主动袭击分析输出包含 `scene=monster_ambush damageMultiplier=...`，并能观察该倍率只作用于主动袭击场景。

不用摘要值代替行为正确性判断；平衡结论以多种子、长程、完整系统模拟中的实际现象为准。
