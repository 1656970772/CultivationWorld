# 系统设计：存档系统

> 最后更新：2026-06-09

## 概述

使用 IndexedDB 进行本地存储，支持多存档、回档、导出导入。

## 存储方案

**数据库名：** `WorldDynamicDB`
**Object Store：** `saves`

### 存档结构

```javascript
SaveData {
  id: string,                  // 存档唯一 ID
  name: string,                // 存档名称（玩家自定义或自动生成）
  timestamp: number,           // 保存时间戳
  currentDay: number,          // 存档时的游戏天数
  worldSnapshot: {             // 完整世界快照
    map: WorldMap,
    factions: Faction[],
    npcs: NPC[],
    modifiers: WorldModifiers,
    infoEvents: InfoEvent[],
    player: Player,
    eventCooldowns: object     // 事件冷却状态
  },
  logHistory: InfoRecord[]     // 日志历史
}
```

ADR-058 后，完整引擎存档还需要覆盖分层模拟状态：

```javascript
worldSnapshot: {
  ...,
  simulationDomains: {
    hotEntityIds: string[],
    warmEntityIds: string[],
    coldCohorts: object
  },
  monthlyCompression: {
    monthIndex: number,
    pendingStates: MonthlyCompressionState[],
    monthLogs: MonthLog[],
    stateDeltaLedger: StateDelta[]
  },
  dramaPackages: DramaPackageState[],
  playerEncounterHistory: EncounterRecord[]
}
```

当前 UI 层自建快照不能作为完整引擎恢复的长期方案。后续接入分层模拟时，存档边界必须以 `WorldEngine.getWorldSnapshot()` 或等价完整引擎快照为准。

## 功能

| 功能 | 说明 |
|------|------|
| 多存档 | 至少 10 个存档位 |
| 手动保存 | 玩家随时可保存到新槽位或覆盖已有存档 |
| 自动保存 | 每 N 天自动保存到"自动存档"槽位（可配置） |
| 回档 | 读取任意存档，世界回到该时间点的状态 |
| 导出 | 将存档序列化为 JSON 文件并下载 |
| 导入 | 读取 JSON 文件并写入存档槽位 |
| 删除 | 删除指定存档 |

## SaveManager 接口

```javascript
class SaveManager {
  async init()                              // 初始化 IndexedDB
  async save(name, worldSnapshot, log)      // 保存
  async load(saveId) → SaveData             // 读取
  async list() → SaveData[]                 // 列出所有存档
  async delete(saveId)                      // 删除
  async exportToFile(saveId)                // 导出 JSON
  async importFromFile(file)                // 导入 JSON
}
```

## 数据一致性

- 保存时对世界状态做深拷贝快照，避免引用问题
- 读档后完全替换当前世界状态
- 导出的 JSON 包含版本号，用于未来兼容性处理
- Cold 月压缩中的 NPC 必须保存当前 Job 快照、月内 episode、去过地点和已提交 delta，读档后能恢复到 Warm/Hot。
- 剧情包 step、绑定 NPC、冷却、失败次数和等待玩家接触状态必须进入存档，不能只存在 UI。
