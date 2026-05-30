# 数据模型：全局世界状态（WorldModifiers）

> 最后更新：2026-05-23

## 结构

```javascript
WorldModifiers {
  activeModifiers: Modifier[]
}

Modifier {
  type: ModifierType,         // 类型标识
  intensity: number,          // 强度 0-1
  duration: number,           // 剩余天数
  effects: {                  // 对各种行为的加成/减成
    [effectKey]: number
  }
}
```

## 预设世界状态类型

| 类型标识 | 名称 | 效果 |
|---------|------|------|
| `demon_qi_rising` | 魔气上涨 | 邪派激进，正派加强防御，凡人王朝稳定度下降 |
| `beast_surge` | 妖兽活跃 | 边境宗门压力增大，猎妖资源增加 |
| `dynasty_decline` | 王朝衰败 | 凡人势力收缩，匪患增加 |
| `spirit_recovery` | 灵气复苏 | 所有势力更激进扩张，修炼加速 |
| `drought` | 大旱 | 粮食下降，流民增加，匪患增加 |
| `plague` | 瘟疫 | 弟子减少，稳定度全面下降 |
| `secret_realm` | 秘境开启 | 势力争夺秘境资源，冲突增加 |

## 世界状态的产生与消退

- 按概率随机产生（由世界 Tick 驱动）
- 有最小/最大持续时间
- 到期后自然消退
- 多个世界状态可以叠加，产生复合效果
- 世界状态类型定义在 `data/world/modifiers.json` 中

## 与"时代感"的关系

世界状态是产生"时代"的核心机制：
- 魔气上涨 → 所有人更激进 → "乱世"
- 灵气复苏 → 扩张加速 → "大争之世"
- 大旱 + 瘟疫 → 粮食危机 + 弟子锐减 → "末法时代"

世界不是静态棋盘，而是有节奏的时代演变。
