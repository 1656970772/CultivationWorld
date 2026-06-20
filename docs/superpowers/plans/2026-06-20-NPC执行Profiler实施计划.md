# NPC执行Profiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可复用的 NPC 执行剖析工具，把每天每个 NPC 的状态、需求评估、目标决策、计划、Job/Toil 执行和事件写成可被后续编辑器/Unity 可视化读取的稳定 JSONL 数据。

**Architecture:** Profiler 作为工具层消费者读取 `WorldEngine.tick()` 的返回日志和实体快照，不改游戏主循环。核心 schema 输出纯 JSON，不暴露 JS class、Map、函数或循环引用；Unity 迁移时只需按同一 schema 写入或读取 `meta.json`、`records.jsonl`、`index.json`。

**Tech Stack:** Node.js ESM、现有 `WorldEngine`、JSONL、项目内 `tools/test-*.mjs` 测试风格。

---

### Task 1: 核心序列化模块

**Files:**
- Create: `apps/game/tools/profiler/npc-execution-profiler-core.mjs`
- Test: `apps/game/tools/test-npc-execution-profiler-core.mjs`

- [ ] **Step 1: Write the failing test**

测试 `buildNpcExecutionRecord()` 输出 `schemaVersion`、`day`、`npc`、`state`、`needs`、`decision`、`execution`、`events`，并且 JSON 序列化后不含函数。

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-npc-execution-profiler-core.mjs`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal core**

实现 `buildNpcExecutionRecord()`、`buildProfilerMeta()`、`buildProfilerIndexEntry()`、`sanitizeForJson()`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-npc-execution-profiler-core.mjs`
Expected: PASS.

### Task 2: 生成 CLI

**Files:**
- Create: `apps/game/tools/profile-npc-execution.mjs`
- Test: `apps/game/tools/test-npc-execution-profiler-cli.mjs`

- [ ] **Step 1: Write the failing test**

测试 `runNpcExecutionProfile()` 在 2 天小模拟中生成 `meta.json`、`records.jsonl`、`index.json`，并能按 `--id` 只记录目标 NPC。

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-npc-execution-profiler-cli.mjs`
Expected: FAIL because CLI/module does not exist.

- [ ] **Step 3: Implement CLI**

加载 data manifest，初始化 `WorldEngine`，逐日 tick，按目标过滤记录 NPC，流式写 JSONL，最后写 meta/index。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-npc-execution-profiler-cli.mjs`
Expected: PASS.

### Task 3: 查询 CLI

**Files:**
- Create: `apps/game/tools/query-npc-profile.mjs`
- Test: `apps/game/tools/test-npc-profile-query.mjs`

- [ ] **Step 1: Write the failing test**

测试从 profile 目录读取指定 `npcId`、`day`，输出对应记录，并支持 `--summary` 返回决策摘要。

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/test-npc-profile-query.mjs`
Expected: FAIL because query module does not exist.

- [ ] **Step 3: Implement query module/CLI**

读取 `records.jsonl`，按 `npcId/day` 过滤；优先用 `index.json` 缩小候选行。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/test-npc-profile-query.mjs`
Expected: PASS.

### Task 4: 文档与真实验证

**Files:**
- Create: `docs/systems/npc-execution-profiler.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Document schema**

说明文件布局、字段含义、Unity 迁移边界和编辑器读取方式。

- [ ] **Step 2: Run focused tests**

Run:
`node tools/test-npc-execution-profiler-core.mjs`
`node tools/test-npc-execution-profiler-cli.mjs`
`node tools/test-npc-profile-query.mjs`

- [ ] **Step 3: Run real short profile**

Run:
`node tools/profile-npc-execution.mjs --days=5 --seed=20260619 --id=npc_born_1038 --out=tools/profiles/smoke-npc_born_1038`

Expected: command exits 0 and writes profile files. If the NPC has not appeared yet, `records.jsonl` may be empty but metadata and index still exist.
