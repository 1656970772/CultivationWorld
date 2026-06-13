# 数据模型：压缩事件记录

> 最后更新：2026-06-09

## 定位

压缩事件记录用于保存 Cold 月压缩中发生的关键事实。它不是玩家日志文本，而是可被存档、信息传播、对话和调试面板复用的结构化记录。

## 结构

```javascript
CompressedEventRecord {
  id: string,
  monthIndex: number,
  dayRange: { start: number, end: number },
  type: string,
  actors: string[],
  location?: { x: number, y: number, locationId?: string, kind?: string },
  summaryKey: string,
  stateDeltaIds: string[],
  visibility: "private" | "faction" | "rumor" | "player_confirmed",
  reliability: number,
  tags: string[]
}
```

## 使用边界

- 存档恢复时用它还原月压缩摘要和重要 NPC 近期经历。
- 信息传播系统可把 `visibility:"rumor"` 的记录转成 `WorldNews`。
- 玩家相遇对话可读取与 NPC 相关的近期记录作为条件。
- UI 日志只消费记录生成展示，不直接把展示文本当作真相源。

