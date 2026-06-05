# ADR-019: 长期心智系统（记忆 / 执念 / 情绪 / 个人恩怨）

> 日期：2026-05-30
> 状态：已采纳

## 背景

ADR-018 落地了 GOBT 三层架构，但 NPC 仍只由「即时需求」驱动，没有「故事感」——
不会因被灭门而复仇、不会因道侣陨落而执着、不会因屡屡受辱而心生愤怒。
用户参考矮人要塞 / 仙逆等作品，要求补齐由**记忆、执念、情绪、个人恩怨**驱动的长期心智，
使 NPC 行为更可信、世界演化更有叙事张力。

## 决策

在 GOBT 的 Goal 选择管线（ADR-018）之上叠加四个相互关联的子系统：

```
重大事件 → 记忆系统 MemorySystem
              ├→ 执念系统 ObsessionSystem（后天触发）
              └→ 情绪系统 EmotionSystem（事件激发）
出生(人格+灵根) → 执念系统（先天 roll）
执念 → 高优先 Goal ┐
需求 → Goal       ┼→ Utility 选目标（情绪作为调制乘子）→ PlannerNode → GOAP
```

### 1. 记忆系统 MemorySystem（`abstract/memory-system.js`）

- 定长**环形队列**存 `MemoryRecord { type枚举, actorId, factionId, tick, location, intensity, decay }`，
  超容丢弃最旧（性能护栏）。
- 记忆类型枚举：被背叛 / 门派被灭 / 道侣陨落 / 获得传承 / 被贬谪 / 遭攻击 / 受辱 / 被救 / 晋升。
- 每日衰减，强度归零的记忆被清理。
- 事件源接入 `tick-manager`：门派覆灭（NPC 转散修时）、道侣陨落（`_collectDeaths`）、被贬谪（`_demoteToOuter`）。
- 数据驱动：`data/balance/memory.json`（事件 → intensity / decay / 恩怨增量）。

### 2. 个人恩怨图 RelationshipGraph（`npc/relationship.js`）

- 与势力间 `relations` 分层，记录「个人对个人」的 `grudge`（仇恨）/ `gratitude`（恩义）。
- 由记忆事件聚合（memory.json 的 grudgeGain / gratitudeGain），是复仇/报恩执念的依据。

### 3. 执念系统 ObsessionSystem（`abstract/obsession-system.js`）

- `Obsession { type枚举(长生/最强/复仇/护道/复活道侣), targetId, targetFactionId, intensity, goalState }`。
- **先天**：出生时按人格(ambition/justice)+灵根 roll 一个初始执念。
- **后天**：高强度记忆触发（门派被灭→复仇、道侣陨落→复活），锁定记忆中的仇人/势力作为 targetRef。
- 接 Goal：`toGoal()` 产出 priority=intensity 的高优先 Goal，经 `NPCEntity.collectExtraGoals` 注入 PlannerNode。
- `goalState` 复用现有可达子目标（修为 totalProgress）作为**阶段性手段**——修仙逻辑下「变强」是
  复仇/长生/证道的共同前置；targetRef 供未来「追踪/击杀」行为接入。
- 数据驱动：`data/balance/obsession.json`。

### 4. 情绪系统 EmotionSystem（`abstract/emotion-system.js`）

- 区别于 morale（长期士气），维度为 `anger`（愤怒）/ `fear`（恐惧）/ `inner_demon`（心魔），
  由记忆事件激发、每日回归基线。
- **调制接入**：作为 Utility 乘子，通过 `Goal.addModulator` 调制 Goal 的 priority/urgency
  （愤怒↑放大复仇执念、恐惧↑放大生存紧迫度），不改变需求/执念本身的评估口径（可解释、可回归）。
- 数据驱动：`data/balance/emotion.json`（dimensions / eventTriggers / goalModulation）。

### 5. 优先级与世界平衡

- Goal 合并排序顺序为 `[需求, 执念]`：稳定排序下**同分时需求优先于执念**，保证执念虽强
  （intensity 高时真正压过普通需求），但在与紧急生存/疗伤等同分需求并列时让位——生存是底线，
  避免执念导致 NPC 无视寿元/重伤而大量陨落。

## 后果

### 正面

- NPC 行为获得长期记忆与人生级目标，世界演化出现「复仇」「证道」等叙事线。
- 全部数据驱动，调参不改代码；与 GOBT 的 Goal 管线统一接入。
- 300 天端到端模拟中观测到执念真实涌现（约 20 个存活 NPC 持有执念，以「证道巅峰」为主）。

### 代价 / 风险

- 每 NPC 多持有记忆环形队列 + 三个情绪标量 + 执念列表，内存与遍历成本可控（定长 / 小集合）。
- 执念优先级若调高过猛可能扰动世界平衡，已用「同分需求优先 + 默认保守阈值」约束。

## 回归保证

- `tools/test-memory.mjs`：环形队列、衰减清理、恩怨聚合、快照往返。
- `tools/test-obsession.mjs`：执念去重、toGoals、与需求的优先级关系。
- Goal 等价性 / GOAP 旧摘要回归 / BT 单元测试均保持通过。
- 端到端 300 天正常，并输出 GOBT 心智统计。

## 相关

- ADR-018（GOBT 三层架构）。
- ADR-017（价值-风险决策、性格维度）、ADR-012（灵根体质）。
- `docs/systems/behavior-tree.md`。
- 世界观参考：仙逆（逆天改命/复仇）、凡人修仙传（求长生）、矮人要塞（记忆驱动）。

