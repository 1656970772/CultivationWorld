# 世界模拟迭代流程

> 最后更新：2026-06-05

## 目标

平衡和行为调整必须让真实世界模拟变得更合理，而不是只让某个摘要值保持一致。本文定义当前项目的模拟迭代流程。

## 适用范围

- NPC 行为分布调整。
- 势力攻伐、覆灭、晋升、人口、生育调参。
- 妖兽生态、猎妖资源链、关系驱动行为调参。
- 新机制开关从关闭到启用前后的行为观察。

## 标准流程

1. **明确问题**：写清现象，例如“散修长期无产出行为”“复仇追不上目标”“势力永不覆灭”。
2. **选观察指标**：选择能直接说明现象的数据，而不是摘要值。
3. **跑基线模拟**：记录天数、种子、配置开关和关键输出。
4. **定位根因**：区分数据权重问题、执行器问题、状态键问题、目标选择问题、规划问题。
5. **最小改动**：一次只改能解释根因的最小范围。
6. **重跑模拟**：使用多个种子和足够长天数观察真实变化。
7. **记录结论**：把已确认的机制决策写入 ADR 或系统文档。

## 观察指标

| 领域 | 指标示例 |
|------|----------|
| 人口 | 存活 NPC、出生、自然死亡、战斗死亡、势力覆灭 |
| 势力 | 攻伐、结盟、贸易、稳定度、弟子、资源库存 |
| NPC | 行为分布、修炼进度、突破、疗伤、任务、复仇、关系行为 |
| 妖兽 | 生成、死亡、觅食、巡逻、协防、掉落资源 |
| 信息 | 消息扩散、机会点生成、参与、过期、抢夺/放过 |
| 动态事件 | 感知、准备、参与、打断、事件结果 |

## 常用命令

在 `apps/game/` 下执行：

```powershell
$env:PYTHONIOENCODING = "utf-8"; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; chcp 65001 > $null
npm run analyze:100
npm run analyze:1000
node tools/simulate-analysis.mjs 3000
```

按改动范围补充专项脚本，例如：

```powershell
node tools/test-bt.mjs
node tools/test-relationship.mjs
node tools/test-master-disciple.mjs
node tools/test-monster-resource-loop.mjs
node tools/test-dynamic-event-system.mjs
node tools/test-dynamic-goals.mjs
node tools/test-interrupt-policy.mjs
node tools/test-dynamic-event-actions.mjs
node tools/verify-gas-combat.mjs
node tools/verify-revenge-pursuit.mjs
```

## 记录格式

每次重要调参或机制修复至少记录：

- 日期。
- 目标问题。
- 改动文件。
- 模拟天数与种子。
- 关键统计。
- 观察到的异常。
- 结论：达成、未达成、需要继续拆分。

如果结论改变机制边界，写入 `docs/decisions/adr-*.md`；如果只是系统说明变更，更新 `docs/systems/`；如果是世界观规则，更新 `docs/worldbuilding/wiki/`。

## 禁止事项

- 不给特定 NPC 或妖兽开特权来自证能跑通。
- 不临时关闭正常干扰因素来证明机制成立。
- 不用摘要值替代真实行为观察。
- 不把一次性探针脚本当成功能达成证据。
