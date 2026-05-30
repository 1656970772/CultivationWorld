# 自动世界模拟稳定性第一批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 先把无人主角世界模拟做成可复现、可校验、可报告、可继任的稳定性调试闭环。  
**Architecture:** 保持 `WorldEngine` 为唯一世界核心；新增 RNG、校验器、报告器和核心 NPC 池，不复制世界规则。  
**Tech Stack:** 原生 JavaScript ES Module、Node CLI、JSON 数据、现有 Web Worker 架构。

---

## Summary

第一批只做 4 件事：可复现随机种子、规则/状态一致性检查、100/1000 天模拟报告、核心 NPC 池与掌门继任。暂不做 Web 自动观测 UI，也不做全 NPC 独立 AI。

## Key Changes

- 新增 `SeededRandom`，让 `WorldEngine({ seed })`、Worker `INIT.payload.seed`、CLI 模拟共用同一随机源。
- 新增 `apps/game/data/definitions/ranks.json` 作为境界/职位静态表，保存寿元上限与继任分数；`npc-lifecycle.json` 只保存初始年龄比例、自然死亡参数和公式说明。
- 新增模拟校验器，检查配置、规则字段消费、世界状态、领地归属、掌门引用、NPC 数量、资源/稳定度合法性和日志完整性。
- 新增模拟报告 CLI：`node tools/simulate-world.mjs --days=100 --seed=wd-smoke` 与 `--days=1000 --seed=wd-pressure`。
- 扩展 `npcs.json` 为核心 NPC 池：大势力 16 人，中势力 10 人，小势力 7 人。
- 掌门死亡优先从本势力存活 NPC 继任；无候选才生成随机掌门。
- 修正 `attacker_power_ratio` 未参与判断、`mortal_kingdom` 世界状态效果未生效、贸易可能产生负资源的问题。

## Interfaces

- `new WorldEngine({ seed?: string | number, timelineEnabled?: boolean })`
- `SeededRandom.next()` / `int(min, max)` / `choice(array)` / `id(prefix, day)`
- `SimulationValidator.validateConfigs(configs)` / `validateWorldState(worldState)` / `validateTimeline(entries)`
- `SimulationReporter.createReport(input)` / `toMarkdown(report)`
- Worker `INIT` payload 增加可选字段：`{ configs, seed }`

## Tasks

1. 实现 RNG 底座并注入世界模拟链路。
2. 实现规则与状态校验器。
3. 实现报告器、CLI 和 npm 脚本。
4. 扩展核心 NPC 池并修正掌门继任。
5. 建立 `data/definitions/ranks.json` 与 `data/behaviors/` 分层：境界/职位静态数据放 `ranks.json`，NPC 生命周期行为参数放 `npc-lifecycle.json`。
6. 更新 NPC 模型、DebugTimeline/报告说明、行为配置模型和文档导航。
7. 运行随机源、校验器、继任、报告器、100 天和 1000 天验证。

## Data Layout

```text
apps/game/data/
├── npcs.json                 # NPC 开局数据
├── factions.json             # 势力开局数据
├── ranks.json                # 境界、职位、寿元与继任分数静态表
├── terrains.json             # 地形开局数据
├── events.json               # 事件模板数据
├── rules.json                # 事件触发数据
└── behaviors/
    ├── npc-lifecycle.json    # NPC 年龄初始化与自然死亡行为
    ├── succession.json       # 继任行为（计划）
    ├── faction-ai.json       # 势力决策行为（计划）
    ├── stability.json        # 稳定度行为（计划）
    ├── territory.json        # 扩张/占领行为（计划）
    ├── combat.json           # 战斗结算行为（计划）
    └── economy.json          # 发展/贸易/资源行为（计划）
```

## Test Plan

- `node tools/test-random.mjs`
- `node tools/test-simulation-validator.mjs`
- `node tools/test-leader-succession.mjs`
- `node tools/test-simulation-reporter.mjs`
- `npm.cmd test`
- `npm.cmd run simulate:100`
- `npm.cmd run simulate:1000`
- 重复运行同一 seed 的 100 天 JSON 报告，核心统计保持一致。
