# ADR-034：人口可持续性平衡机制（出生率 + 接单战力自检 + 势力覆灭动态阈值）

最后更新：2026-06-01

状态：部分已实现（v3 出生率、v4 接单战力自检已落地并验证；v4 势力覆灭动态阈值已实现但未触发，根因与 v5 修复方案见 §未解问题）

## 背景

5000 天全激活态基线模拟（按 ADR-033 流程产出）暴露：**世界没有"活起来"，而是在缓慢"空城化"**。

- 人口曲线单调衰减且无回升：151 → 90（D500）→ 74（D1000）→ 57（D2000）→ 38（D5000）。
- 出生 35 << 死亡 279；性别失衡（男 29 / 女 9，女性枯竭形成正反馈）。
- 死因主因为「妖兽 + 任务」（约 86%）——NPC 接取超出自身战力的任务，自杀式接单。
- 18 个势力 100% 存活、0 覆灭，缺乏权力流动与淘汰。

按 ADR-033 归因决策树，逐项定位：人口枯竭是最上游瓶颈（死掉的 NPC 不会复仇/夺权），必须先解决。

## 决策

分三个机制、按"先上游、一次一类杠杆"的纪律推进，全部**数据驱动 + 可回退（enabled 开关）**：

### 一、v3 — 出生率参数杠杆（参数问题）

诊断：活跃 NPC 个体补充只能靠道侣生育，但生育频率低、成功率低、且受限于女性数量。属可线性撬动的参数问题。

改 `data/balance/social.json`（仅一个文件，最小可逆）：

| 参数 | 改前 | 改后 |
|------|------|------|
| `daoCompanion.matchIntervalDays` | 60 | 45 |
| `daoCompanion.matchSuccessRate` | 0.15 | 0.25 |
| `birth.processIntervalDays` | 90 | 60 |
| `birth.successRate` | 0.20 | 0.35 |
| `birth.maxChildren` | 3 | 4 |

### 二、v4 — NPC 接单战力自检（数据驱动选择层机制）

诊断：接单已有 `rankMaxDifficulty` 境界上限，但 NPC 在候选难度区间内**均匀随机**选取，倾向顶格冒险；高难度任务 `dangerDeath` 陡增（六阶 5% / 八阶 12%），`quest` 成为人口流失主因。这不是接单"上限"问题，而是"选择倾向"问题。

机制：给【非猎妖】任务的候选权重按"难度高出该境界可接最低难度的步数"做指数衰减，让 NPC 倾向留出安全边际、优先选低难度任务，而非顶格。

- 配置 `data/quests/quest-templates.json` 新增 `safetyPreference { enabled: true, falloffPerStep: 0.55 }`。
- 实现 `apps/game/js/engine/npc/actions/npc-action-utils.js` → `pickQuestCandidate`：
  `stepsAboveSafe = max(0, candidate.difficulty − minAvailDiff)`；
  `weight *= falloffPerStep ^ stepsAboveSafe`（仅对非猎妖任务；猎妖任务沿用 gradeFit 偏好不变）。
- `enabled=false` 时退化为原均匀选取（默认关闭不改变既有行为可回退）。

### 三、v4 — 势力覆灭动态阈值（结构机制，已实现待生效）

诊断：势力覆灭条件 `faction-entity.js` 为 `disciples<=0 || stability<=0`，但攻战胜利结算把防守方弟子托底在固定 `winDefenderMinDisciples=5`，使 `disciples` 永远 ≥5 → `isDestroyed` 永不触发。

机制：当防守方**真实衰弱**（稳定度低 + 实际活 NPC 寥寥）时，把托底降为 0，允许攻战将其打灭门。

- 配置 `data/balance/combat.json` → `attack` 新增 `annihilation { enabled: true, stabilityThreshold: 20, aliveNpcThreshold: 3 }`。
- 实现 `apps/game/js/engine/world/services/faction-ai-service.js` 攻战胜利结算：
  若 `annihilationEnabled` 且 `defenderStability ≤ stabilityThreshold` 且该势力实际活 NPC 数 ≤ `aliveNpcThreshold`，则将本次结算的 `effDefMin` 降为 0；否则维持原 `winDefMin`。
- `enabled=false` 可回退。

## 设计模式映射

- **数据驱动 + 开闭原则**：三个机制全部由 JSON 配置控制阈值/系数与开关，新增/调整不改核心代码、可灰度回退。
- **策略（选择层）**：接单战力自检作用于 `pickQuestCandidate` 的候选加权，与 GOAP 路径代价解耦（延续 ADR-021 的"差异化在选目标层"原则）。

## 数据与接口

- 改 `data/balance/social.json`（v3 出生/道侣参数）。
- 改 `data/quests/quest-templates.json`（新增 `safetyPreference`）。
- 改 `apps/game/js/engine/npc/actions/npc-action-utils.js`（`pickQuestCandidate` 安全偏好加权）。
- 改 `data/balance/combat.json`（`attack.annihilation`）。
- 改 `apps/game/js/engine/world/services/faction-ai-service.js`（构造读取 annihilation + 攻战结算动态 `effDefMin`）。
- 备份 `历史备份（已清理）：pre-tuning-v3-social.json`、`pre-tuning-v4-quest-templates.json`、`pre-tuning-v4-npc-action-utils.js`、`pre-tuning-v4-combat.json`、`pre-tuning-v4-faction-ai-service.js`。
- 不改任何对外 API 签名；GOAP 用例不受影响。

## 后果

- 末态存活 NPC 逐轮抬升：v2 基线 38 → v3 44 → v4 54，逼近健康线（60）。
- v4 用"少死"（接单自检降死亡）替代 v3 的"多生"，后期衰减更缓、人口更可持续。
- 三机制均可一键回退，风险可控；GOAP 旧摘要回归保持 `5740e12a` 默认关闭不改变既有行为。

## 验证

KPI 三轮对比（5000 天全激活态，详见 `ADR-034` / `ADR-034`）：

| 指标 | v2 基线 | v3 | v4 |
|------|---------|----|----|
| 末态存活 NPC | 38 | 44 | **54** |
| 出生数 | 35 | 93 | 64 |
| 死亡总数 | 279 | 385 | **310** |
| quest 死因（末300） | 60 | 130 | **90** |
| quest_hunt_failed（末300） | 20 | 56 | **32** |
| 势力覆灭 | 0 | 0 | 0（见 §未解问题） |

- GOAP 旧摘要回归 `5740e12a` 在 v3/v4 均默认关闭不改变既有行为。
- 回归测试通过：`test-goal-equivalence` / `test-quest-reward-economy` / `test-monster-resource-loop` / `test-relationship-goals` / `test-revenge`。

## 未解问题（v5）

势力覆灭动态阈值（机制三）已实现但**从未触发**，根因是更深的结构裂缝：

- 势力强度挂在**抽象 `disciples` 数值**上，由 `faction_recruit` 与 `resourceRegen.disciplesPerDay` 持续输血；稳定度也有 `naturalRecoveryRate` 自然恢复。
- 攻战即使杀掉真实 NPC，抽象 `disciples` 仍被维持在高位，触发条件"稳定度≤20 且活 NPC≤3"无法同时满足。
- 这与 v3 埋下的同一类裂缝同源：**抽象资源（disciples 数值）与真实个体（NPC 实体）是两套不同步的人口**。

v5 方案（结构修复，优先级最高）：让势力 `disciples` 与真实活 NPC 数挂钩（每 tick 校准，或在真实 NPC 枯竭时禁止继续招募输血）。只有打通这一点，权力流动（覆灭/补位/挑战）与复仇执念行动才能真正涌现。

## 相关

- 迭代流程方法论 ADR-033 + `docs/balance/simulation-iteration-process.md`。
- v3/v4 验证报告 `ADR-034`、`ADR-034`。
- ADR-015（宗门资源真相源统一 + 晋升体系）——`disciples` 抽象资源的来源背景。
- ADR-026（妖兽资源化闭环）——猎妖任务死亡的链路来源。
- 体检报告 `历史体检结论（已并入当前文档）`（P2：高层流动/淘汰偏弱）。

