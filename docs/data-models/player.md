# 数据模型：玩家（Player）

> 最后更新：2026-05-23

## 结构

```javascript
Player {
  x: number,                  // 地图横坐标
  y: number,                  // 地图纵坐标
  actionPoints: number,       // 当前剩余行动点
  actionsPerDay: number,      // 每天行动点上限（5）
  senseRange: number,         // 神识覆盖半径（格数）
  knownInfo: InfoRecord[],    // 已知信息列表
  currentDay: number          // 当前天数
}

InfoRecord {
  eventId: string,            // 对应的信息事件 ID
  receivedDay: number,        // 收到信息的天数
  reliability: number,        // 收到时的可信度
  content: string             // 信息内容
}
```

## 第一版定位

玩家是**观察者 + 干预者**，没有成长系统：
- 没有修为等级
- 没有攻防属性
- 没有技能/装备
- 通过行动和选择影响世界，而非通过个人战斗力

## 行动消耗

| 行为 | 消耗行动点 |
|------|-----------|
| 移动 1 格（普通地形） | 1 |
| 移动 1 格（沼泽） | 2 |
| 参与事件 | 1-N（取决于事件规模） |
| 打坐（快进） | 玩家自选 N 点 |

每消耗满 5 行动点（actionsPerDay），触发一次世界 Tick。
