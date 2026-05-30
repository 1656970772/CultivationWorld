# 系统设计：决策时间线（Debug Timeline）

> 最后更新：2026-05-30
> 定位：开发看板，展示世界每个决策的完整数据链路

## GOBT 心智可视化（ADR-018 / ADR-019）

GOBT 重构后，每个 NPC 的 tick 日志（`_tickLog`）新增以下字段，供看板展示其决策与心智：

- `btTrace.selectedGoal`：PlannerNode 选中的目标（来源 need/obsession、优先级、规划出的行为链）。
- `btTrace.reactedPath`：本 tick 命中的即时反应（情绪类型、值、抢占的行为），无则 null。
- `mind`：NPC 心智摘要——`obsessions`（执念列表）、`emotions`（愤怒/恐惧/心魔值）、`memoryCount`、`topGrudge`（最深仇恨对象）。

借此可在时间线中观察「某 NPC 因门派被灭→记忆→复仇执念→优先变强」的完整叙事链路。详见 `behavior-tree.md`。

## 概述

决策时间线是一个**面向开发者的调试系统**，记录世界中每一天发生的所有事情，包括：
- 每个决策的输入数据、权重计算过程、随机结果
- 每个事件的触发条件、匹配结果、执行效果
- 信息传播的覆盖过程
- 稳定度、好感度的变化明细

相当于整个世界的"黑盒记录仪"，开发时用来验证规则系统是否合理。

## 日志格式

每天一个 section，每条日志包含：时间、类别、摘要、详细数据。

### 日志示例

```
═══════════════════════════════════════════════
 [大陆元年 第1天]
═══════════════════════════════════════════════

[1天][玩家] 玩家进入世界，坐标 (50, 50)

[1天][世界状态] 新增修饰符：魔气上涨
  ├─ 触发概率：5%，随机值：0.032 → 触发
  ├─ 强度：0.6
  ├─ 持续：20天
  └─ 效果：evil_faction_aggression +20, righteous_faction_defense +10, mortal_stability -15

[1天][势力决策] 青云宗 → 发展
  ├─ 掌门：清玄真人 (ambition:30 caution:70 loyalty:90 diplomacy:80)
  ├─ 稳定度：80 | 弟子：500 | 灵石：500
  ├─ 权重计算：
  │   expand:  10 + amb×0.3(9) = 19.0
  │   defend:  10 + cau×0.4(28) + [魔气上涨:正派防御+10] = 48.0
  │   attack:  10 + amb×0.5(15) - cau×0.3(21) = 4.0
  │   ally:    10 + dip×0.4(32) = 42.0
  │   develop: 10 + [基础] = 40.0  ← 此处修正为示例
  │   idle:    10
  ├─ 归一化概率：expand 11.7% | defend 29.4% | attack 2.5% | ally 25.8% | develop 24.5% | idle 6.1%
  ├─ 随机值：0.672 → 命中区间 [0.447, 0.706]
  └─ 最终决策：develop（发展）

[1天][势力决策] 血煞门 → 发展
  ├─ 掌门：血魔老祖 (ambition:95 caution:30 loyalty:40 diplomacy:10)
  ├─ 稳定度：65 | 弟子：350 | 灵石：300
  ├─ 权重计算：
  │   expand:  10 + amb×0.3(28.5) = 38.5
  │   defend:  10 + cau×0.4(12) = 22.0
  │   attack:  10 + amb×0.5(47.5) - cau×0.3(9) + [魔气上涨:邪派攻击+20] = 68.5
  │   ally:    10 + dip×0.4(4) = 14.0
  │   develop: 10
  │   idle:    10
  ├─ 相邻敌对势力检查：
  │   与青云宗：好感度 -80（< -50 ✓），相邻 ✓，青云宗稳定度 80（> 50，非虚弱）
  │   攻伐规则冷却：无冷却 ✓
  │   但攻伐事件概率：30%，随机值：0.51 → 未触发
  ├─ 归一化概率：expand 23.6% | defend 13.5% | attack 42.0% | ally 8.6% | develop 6.1% | idle 6.1%
  ├─ 随机值：0.312 → 命中区间 [0.236, 0.371]
  └─ 最终决策：defend（防御）—— 虽然 attack 概率最高但随机命中了 defend

[1天][势力决策] 万妖山 → 发展
  ├─ ... （同上格式）

... （其余 9 个势力的决策）

[1天][事件触发] 无事件触发
  └─ 规则检查：共 8 条规则，0 条满足

[1天][稳定度更新]
  ├─ 青云宗：80 → 82 (+2 基础恢复, 领地80格 超出基础30格 → -5, 资源补益 +5)
  ├─ 血煞门：65 → 67 (+2 基础恢复)
  ├─ 大晋王朝：70 → 57 (+2 基础恢复, [魔气上涨:凡人稳定度-15])
  └─ ...

[1天][关系变化] 无变化

[1天][信息传播] 无活跃传播事件

═══════════════════════════════════════════════
 [大陆元年 第3天]
═══════════════════════════════════════════════

[3天][势力决策] 血煞门 → 攻伐青云宗
  ├─ 掌门：血魔老祖 (ambition:95 caution:30 loyalty:40 diplomacy:10)
  ├─ 稳定度：67 | 弟子：350 | 灵石：300
  ├─ 权重计算：
  │   attack: 68.5（同上）
  │   局势修正：青云宗外围稳定度 80（非虚弱，无额外加成）
  ├─ 归一化概率：attack 42.0% ...
  ├─ 随机值：0.156 → 命中区间 [0, 0.236]
  └─ 最终决策：attack → 目标：青云宗
       └─ 目标选择：好感度 -80（最低），稳定度 82，综合评分 -162

[3天][事件触发] 攻伐事件：血煞门 → 青云宗
  ├─ 规则匹配：rule_siege
  │   条件1：好感度 < -50 → -80 ✓
  │   条件2：领地相邻 → ✓ (交界坐标约 35,45)
  │   条件3：攻方稳定度 > 50% → 67 ✓
  │   条件4：掌门 ambition > 60 → 95 ✓
  │   冷却检查：无冷却 ✓
  │   触发概率：30%，随机值：0.18 → 触发 ✓
  └─ 创建事件：SiegeEvent { attacker: 血煞门, defender: 青云宗 }

[3天][事件执行] 血煞门攻伐青云宗
  ├─ 攻方战力计算：
  │   基础：弟子 350
  │   地形修正：平原 ×1.0
  │   资源修正：灵石 300 → ×1.3
  │   最终攻击力：455
  ├─ 守方战力计算：
  │   基础：外围弟子 100（总 500 的 20% 驻守边境）
  │   地形修正：山脉 ×1.5
  │   资源修正：灵石 500 → ×1.5
  │   最终防御力：225
  ├─ 胜率：攻方 455/(455+225) = 66.9%
  ├─ 随机值：0.42 → 攻方胜 ✓
  ├─ 结果：
  │   领地变更：青云宗失去 3 格 → [(34,45),(35,45),(35,44)]
  │   攻方弟子损耗：350 × 8% = -28 → 322
  │   守方弟子损耗：100 × 10% = -10 → 外围 90（总 490）
  │   关键NPC检查：无NPC在战场
  └─ 生成传播信息：「血煞门攻破青云宗外围防线，夺取数处要地」
       ├─ 发生地：(35, 45)
       ├─ 传播速度：3格/天
       ├─ 最大半径：80
       └─ 初始可信度：1.0

[3天][稳定度更新]
  ├─ 青云宗：82 → 72 (+2 基础, -5 领地负担, -5 战争消耗, -2 失地)
  ├─ 血煞门：67 → 60 (+2 基础, -4 领地负担, -5 远征消耗)
  └─ ...

[3天][关系变化]
  ├─ 青云宗 ↔ 血煞门：-80 → -95 (战争 -15)
  └─ ...

[3天][信息传播]
  └─ evt_001「血煞门攻破青云宗」：半径 0 → 3，覆盖势力：无新增

═══════════════════════════════════════════════
 [大陆元年 第6天]
═══════════════════════════════════════════════

[6天][信息传播]
  └─ evt_001「血煞门攻破青云宗」：半径 9 → 12
       ├─ 新覆盖：玄真观（距离约 10 格）
       │   └─ 玄真观获知信息，可信度 = 1.0 × (1 - 10/80) = 0.875（确认级别）
       └─ 玄真观 AI 下次 tick 决策时将考虑此信息

[6天][势力决策] 玄真观 → 防御
  ├─ 掌门：无尘道人 (ambition:15 caution:85 loyalty:95 diplomacy:60)
  ├─ 新信息影响：获知血煞门攻打青云宗 → defend 权重 +15
  ├─ 权重计算：
  │   defend: 10 + cau×0.4(34) + [新信息:+15] = 59.0  ← 最高
  │   ...
  └─ 最终决策：defend（防御）

═══════════════════════════════════════════════
 [大陆元年 第30天]
═══════════════════════════════════════════════

[30天][信息传播]
  └─ evt_001「血煞门攻破青云宗」：半径 87 → 90
       └─ 新覆盖：天剑宗（距离约 28 格，第 10 天已获知）
           此前第10天决策记录：
           [10天][势力决策] 天剑宗 → 攻伐血煞门
             ├─ 掌门：剑痴 (ambition:60 caution:20 loyalty:85 diplomacy:25)
             ├─ 新信息影响：获知盟友青云宗被攻 → attack 权重 +40（好友被攻，义愤）
             ├─ 与血煞门好感度：-90 → attack 权重再 +20
             └─ 最终决策：attack → 目标：血煞门
```

## 数据结构

### 单条日志记录

```javascript
TimelineEntry {
  day: number,                    // 第几天
  timestamp: number,              // 执行时间戳（用于排序同一天内的顺序）
  category: TimelineCategory,     // 日志类别
  summary: string,                // 一行摘要
  detail: object                  // 完整数据（结构因类别而异）
}
```

### 日志类别（TimelineCategory 枚举）

```javascript
const TimelineCategory = {
  PLAYER:           'player',           // 玩家行为
  WORLD_MODIFIER:   'world_modifier',   // 世界状态变化
  FACTION_DECISION: 'faction_decision', // 势力决策
  EVENT_TRIGGER:    'event_trigger',    // 事件触发
  EVENT_EXECUTE:    'event_execute',    // 事件执行
  STABILITY:        'stability',        // 稳定度更新
  RELATION:         'relation',         // 关系变化
  INFO_SPREAD:      'info_spread',      // 信息传播
  NPC_STATUS:       'npc_status',       // NPC 状态变化
}
```

### 势力决策详细数据

```javascript
FactionDecisionDetail {
  factionId: string,
  factionName: string,
  leader: {
    name: string,
    personality: { ambition, caution, loyalty, diplomacy }
  },
  factionState: {
    stability: number,
    disciples: number,
    spiritStone: number,
    territoryCount: number
  },
  weights: {
    expand:  { base, personalityMod, modifierMod, situationMod, final },
    defend:  { base, personalityMod, modifierMod, situationMod, final },
    attack:  { base, personalityMod, modifierMod, situationMod, final },
    ally:    { base, personalityMod, modifierMod, situationMod, final },
    develop: { base, personalityMod, modifierMod, situationMod, final },
    idle:    { base, personalityMod, modifierMod, situationMod, final },
  },
  probabilities: {               // 归一化后的概率
    expand: number, defend: number, attack: number,
    ally: number, develop: number, idle: number
  },
  randomValue: number,           // 随机值
  hitRange: [number, number],    // 命中区间
  finalAction: string,           // 最终决策
  target: string | null,         // 攻击目标
  targetSelectionReason: string  // 目标选择理由
}
```

### 事件执行详细数据

```javascript
EventExecuteDetail {
  eventType: string,
  attacker: {
    name: string, disciples: number,
    terrainMod: number, resourceMod: number, finalPower: number
  },
  defender: {
    name: string, disciples: number,
    terrainMod: number, resourceMod: number, finalPower: number
  },
  winProbability: number,        // 攻方胜率
  randomValue: number,           // 随机值
  result: string,                // 'attacker_wins' | 'defender_wins'
  consequences: {
    tilesTransferred: string[],  // 转移的格子
    attackerLoss: number,        // 攻方弟子损失
    defenderLoss: number,        // 守方弟子损失
    npcCasualties: string[],     // NPC 伤亡
  },
  infoEventGenerated: {
    content: string,
    origin: { x, y },
    spreadSpeed: number,
    maxRadius: number
  }
}
```

### NPC 状态详细数据

```javascript
NPCStatusDetail {
  npcId: string,
  factionId: string,
  cause: 'natural' | string,      // 死亡来源。自然死亡固定为 natural
  ageYears: number,               // 死亡时年龄
  maxAgeYears: number,            // 寿元上限
  lifespanProgress: number,       // ageDays / maxAgeDays，0-1
  deathChance: number,            // 当日最终死亡概率
  roll: number                    // 当日随机值
}
```

## 模块设计

### DebugTimeline 类

```javascript
class DebugTimeline {
  constructor() {
    this.entries = []             // 所有日志条目
    this.enabled = true           // 是否启用（生产环境可关闭）
  }

  log(day, category, summary, detail)  // 记录一条日志
  getDay(day) → TimelineEntry[]        // 获取某天的所有日志
  getByCategory(category) → TimelineEntry[]  // 按类别筛选
  getRange(fromDay, toDay) → TimelineEntry[] // 获取时间段
  exportText() → string                // 导出为可读文本
  exportJSON() → object                // 导出为 JSON
  clear()                              // 清空
}
```

### 嵌入位置

DebugTimeline 实例挂在 WorldEngine 上，每个子系统在执行时调用 `timeline.log()` 记录数据：

```javascript
// 例：FactionAI 中
const detail = { factionId, weights, probabilities, randomValue, finalAction, ... }
this.timeline.log(worldState.currentDay, 'faction_decision',
  `${faction.name} → ${finalAction}`, detail)
```

## UI 展示

### 开发者面板（可收起的侧边栏或独立页面）

- 按天折叠/展开
- 按类别筛选（只看势力决策 / 只看事件）
- 搜索功能（搜索势力名、NPC 名）
- 颜色编码：
  - 蓝色：玩家行为
  - 黄色：势力决策
  - 红色：事件触发/执行
  - 绿色：稳定度/关系
  - 紫色：信息传播
  - 灰色：世界状态
- 可导出为文本或 JSON

### 生产模式

- `timeline.enabled = false`，不记录不渲染，零性能开销

## 自动模拟报告

无人主角模拟模式会复用 `DebugTimeline` 作为结构化数据来源，并由命令行工具生成 Markdown/JSON 报告。

报告至少包含：

- seed、模拟天数、错误数量和警告数量。
- 势力行动分布：扩张、防御、攻伐、结盟、发展、贸易、空闲。
- 事件执行统计：战争、结盟、叛变、内乱、掠夺、妖族入侵、贸易、掌门陨落、秘境争夺、正邪大战。
- 每个势力的领地、资源、稳定度变化。
- NPC 存活、死亡、自然死亡、掌门继任和继承链断绝导致的势力覆灭次数。
- 规则/数据异常：未支持条件字段、无效掌门、负资源、稳定度越界、领地与地图 owner 不一致。

命令行入口：

```bash
cd apps/game
npm.cmd run simulate:100
npm.cmd run simulate:1000
```

同一 seed 的模拟应可复现，用于对比调参前后的变化。
