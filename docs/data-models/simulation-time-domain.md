# 数据模型：分层模拟时间域

> 最后更新：2026-06-09

## 配置模型

```javascript
SimulationTimeDomainConfig {
  hot: {
    radiusTiles: number,
    dialogueTriggerRadius: number,
    combatTriggerRadius: number
  },
  warm: {
    radiusTiles: number,
    includeMarkedNpc: boolean,
    includeImportantNpc: boolean
  },
  cold: {
    monthLengthDays: number,
    maxEpisodesPerNpc: number,
    defaultFidelityTier: string
  },
  zone: {
    hysteresisTiles: number,
    promoteOnPlayerMark: boolean,
    promoteOnDramaPackage: boolean
  }
}
```

实际新增运行时 JSON 时，建议放在 `apps/game/data/simulation/` 并同步 `data-manifest.json` 与 strict 校验。

## NPC 保真度模型

```javascript
NpcFidelityProfile {
  npcId: string,
  tier: "S" | "A" | "B" | "C",
  reasons: string[],
  minEpisodesPerMonth: number,
  maxEpisodesPerMonth: number,
  preserveItinerary: boolean,
  preserveDialogueMemory: boolean,
  promoteToWarmWhenEventActive: boolean
}
```

保真等级只影响模拟精度、日志保留和恢复实时域时的细节，不提供免死、锁血、无限资源或固定成功率。

## 月压缩运行态

```javascript
MonthlyCompressionState {
  npcId: string,
  monthIndex: number,
  startDay: number,
  endDay: number,
  agenda: MonthlyAgenda,
  episodes: MonthlyEpisode[],
  visitedPlaces: VisitedPlace[],
  currentJobSnapshot?: JobSnapshot,
  stateDeltas: StateDeltaRef[],
  monthLogIds: string[]
}
```

## 状态提交模型

```javascript
StateDelta {
  id: string,
  source: string,
  domain: "hot" | "warm" | "cold",
  actorId?: string,
  targetId?: string,
  dayRange: { start: number, end: number },
  operations: StateOperation[]
}
```

所有 Hot/Warm/Cold 结果都通过同一 delta 模型提交，防止出现多套世界真相源。

