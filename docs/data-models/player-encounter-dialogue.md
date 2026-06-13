# 数据模型：玩家相遇与 NPC 对话

> 最后更新：2026-06-09

## EncounterContext

```javascript
EncounterContext {
  id: string,
  day: number,
  playerId: string,
  npcId: string,
  location: {
    x: number,
    y: number,
    kind: string,
    factionId?: string,
    dangerLevel?: number
  },
  relation: {
    attitude: number,
    tags: string[],
    recentEvents: string[]
  },
  realmGap: number,
  combatPowerGap: number,
  npcCurrentJob?: JobSnapshot,
  npcRecentEpisodes: MonthlyEpisode[],
  activeDramaPackages: string[],
  playerKnownInfoIds: string[]
}
```

## DialogueDefinition

```javascript
DialogueDefinition {
  id: string,
  packageId?: string,
  priority: number,
  weight: number,
  conditions: Condition[],
  nodes: DialogueNode[]
}

DialogueNode {
  id: string,
  textKey: string,
  commands?: DialogueCommand[],
  options: DialogueOption[]
}

DialogueOption {
  id: string,
  textKey: string,
  conditions?: Condition[],
  cost?: ItemCost[],
  commands?: DialogueCommand[],
  next?: string
}
```

## DialogueCommand

```javascript
DialogueCommand {
  type: string,
  target?: string,
  params?: object
}
```

命令只描述意图，由 `DialogueCommandEngine` 解释后写入统一状态 delta。对话 UI 不直接修改关系、背包、任务或剧情包。

## DramaPackageState

```javascript
DramaPackageState {
  packageId: string,
  status: "inactive" | "active" | "step_running" | "cooldown" | "closed",
  stepId?: string,
  boundNpcIds: string[],
  actionCount: number,
  failCount: number,
  nextActiveDay?: number,
  lastDialogueId?: string,
  waitingForPlayerContact?: boolean
}
```

剧情包可以由月压缩推进世界事实，但需要玩家选择的节点必须设置 `waitingForPlayerContact`，由玩家相遇系统恢复。

