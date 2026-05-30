# 系统设计：事件系统

> 最后更新：2026-05-23

## 概述

混合事件系统：规则生成常规事件 + 预设特殊事件。

## 1. 规则引擎（常规事件）

每条规则定义在 `data/rules.json` 中，结构：

```javascript
Rule {
  id: string,
  name: string,
  conditions: Condition[],     // 触发条件列表（AND 关系）
  eventType: string,           // 产生的事件类型
  probability: number,         // 触发概率 0-1
  cooldown: number             // 冷却天数
}

Condition {
  type: string,                // 条件类型
  params: object               // 条件参数
}
```

### 规则示例

**宗门攻伐：**
- 条件：两势力敌对（好感度 < -50）且领地相邻 且 攻方稳定度 > 50% 且 攻方掌门 ambition > 60
- 概率：0.3（每天 30% 概率）
- 冷却：10 天

**结盟：**
- 条件：两势力好感度 > 60 且有共同敌人 且 掌门 diplomacy > 50
- 概率：0.2
- 冷却：20 天

**叛乱：**
- 条件：势力稳定度 < 30% 且弟子数 > 100
- 概率：0.1
- 冷却：30 天

## 2. 预设特殊事件

定义在 `data/events.json` 中，有固定触发条件和冷却时间：

```javascript
PresetEvent {
  id: string,
  name: string,
  description: string,
  triggerCondition: object,    // 触发条件
  cooldown: number,            // 冷却天数
  duration: number,            // 持续天数
  effects: object,             // 世界效果
  playerChoices: Choice[]      // 玩家可介入时的选项
}
```

### 预设事件示例

- **秘境开启** —— 每隔 50 天 + 灵气复苏期间概率翻倍
- **天劫降临** —— 某区域遭受天雷，建筑损毁
- **妖潮** —— 妖兽活跃期间，边境大规模妖兽攻击
- **上古遗迹发现** —— 随机位置出现遗迹，势力争夺

## 3. 玩家可介入事件

当事件发生在玩家所在格子或神识范围内时，弹出选项：

```javascript
Choice {
  text: string,               // 选项文本
  actionPointCost: number,     // 行动点消耗（天数 × 5）
  effects: object              // 选择产生的效果
}
```

### 示例

```
事件：青云宗正在被血煞门围攻

  A. 出手相助青云宗（消耗 3 天）→ 青云宗胜率 +40%，好感 +30
  B. 暗中帮助血煞门（消耗 2 天）→ 血煞门胜率 +30%，好感 +20
  C. 趁乱探索战场（消耗 1 天）→ 可能获得情报
  D. 静观其变 → 不消耗行动点，无影响
  E. 离开此地 → 不消耗行动点，移出事件范围
```

## 4. 事件工厂（EventFactory）

使用工厂模式创建事件实例，新增事件类型只需在工厂中注册：

```javascript
EventFactory.register("siege", SiegeEvent)
EventFactory.register("alliance", AllianceEvent)
EventFactory.register("rebellion", RebellionEvent)
EventFactory.register("secret_realm", SecretRealmEvent)
```
