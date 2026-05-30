# 系统设计：势力 AI 决策

> 最后更新：2026-05-23

## 概述

每个势力每天由 NPC 领袖性格驱动做出一个行为选择。使用策略模式，不同阵营有不同决策逻辑。

## 决策流程

```
输入：势力状态 + NPC 性格 + 世界状态 + 周边信息
    │
    ▼
根据阵营类型选择策略（Strategy）
    │
    ▼
计算各行为的权重
    │
    ▼
加权随机选择一个行为
    │
    ▼
输出：行为意图（action + target）
```

## 权重计算公式

```
行为权重 = 基础权重 × 性格修正 × 世界状态修正 × 当前局势修正
```

## 可选行为

| 行为 | 说明 |
|------|------|
| `expand` | 向无主之地扩张领地 |
| `defend` | 加强边境防御 |
| `attack` | 攻伐相邻敌对势力 |
| `ally` | 与其他势力结盟 |
| `develop` | 发展内部（增加资源、弟子） |
| `idle` | 无动作 |

## 性格修正示例

| 性格维度 | 对行为的修正 |
|---------|-------------|
| ambition 高 | `expand` +、`attack` + |
| ambition 低 | `develop` +、`idle` + |
| caution 高 | `defend` +、`attack` - |
| caution 低 | `attack` +、`expand` + |
| diplomacy 高 | `ally` + |
| diplomacy 低 | `ally` - |

## 策略模式实现

```
FactionAI
├── selectStrategy(factionType) → Strategy
├── strategies/
│   ├── RighteousStrategy   # 偏防御、结盟、除魔
│   ├── EvilStrategy        # 偏扩张、掠夺
│   ├── NeutralStrategy     # 偏发展、观望
│   ├── DemonStrategy       # 偏占据灵脉、排斥人族
│   └── MortalStrategy      # 偏稳定、资源积累
```

每种策略在基础权重上有不同偏置，然后再叠加性格修正。

## 信息对决策的影响

势力只能基于自己"已知"的信息做决策（通过信息传播系统获知）：
- 如果不知道邻居被灭，就不会去抢地盘
- 如果听到传闻（低可信度），可能做出误判
