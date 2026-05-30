# 数据模型：势力（Faction）

> 最后更新：2026-05-23

## 结构

```javascript
Faction {
  id: string,                     // 唯一标识
  name: string,                   // 名称（如"青云宗"）
  type: FactionType,              // 阵营类型
  territory: string[],            // 占据的格子坐标列表（"x_y" 格式）
  stability: number,              // 稳定度 0-100
  resources: {
    spirit_stone: number,         // 灵石
    disciples: number,            // 弟子数
    food: number                  // 粮食
  },
  relations: {                    // 与其他势力的好感度
    [factionId]: number           // -100（死敌）到 100（至交）
  },
  leader: string,                 // 掌门 NPC ID
  traits: FactionTrait[]          // 势力特性列表
}
```

## 阵营类型（FactionType）

| 枚举值 | 名称 | 行为倾向 |
|--------|------|---------|
| `righteous` | 正派 | 倾向防御、结盟、除魔 |
| `evil` | 邪派 | 倾向扩张、掠夺、独行 |
| `neutral` | 中立 | 倾向发展、贸易、观望 |
| `demon` | 妖族 | 倾向占据灵脉、排斥人族 |
| `mortal_kingdom` | 凡人王朝 | 倾向稳定、资源积累 |

## 势力特性（FactionTrait）

| 枚举值 | 效果 |
|--------|------|
| `expansionist` | 扩张行为权重 + |
| `defensive` | 防御行为权重 + |
| `scholarly` | 发展行为权重 +，攻击权重 - |
| `aggressive` | 攻伐行为权重 + |
| `diplomatic` | 结盟行为权重 + |

## 势力实力

第一版不设综合实力值。实力由以下维度综合体现：
- 领地数量（格子数）
- 弟子数量
- 灵石储量
- 掌门 NPC 能力
- 地形优势（山脉防守加成等）

攻伐结果由这些维度综合对比计算。
