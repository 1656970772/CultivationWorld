/**
 * NPCNeeds - NPC 专用需求评估器
 */
import { NeedEvaluator } from '../abstract/need.js';
import { NeedPool } from '../pools/need-pool.js';

export class NPCSurvivalEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    const lifeRatio = entityState.get('lifeRatio') || 0;
    const alive = entityState.get('alive');
    if (!alive) return { priority: 0, urgency: 0, goalState: {}, satisfied: true };

    let priority = 10;
    let urgency = 0;

    if (lifeRatio >= 0.9) { priority += 80; urgency += 90; }
    else if (lifeRatio >= 0.8) { priority += 50; urgency += 60; }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: { lifeRatio: { op: 'lt', value: 0.8 } },
      satisfied: lifeRatio < 0.7,
    };
  }
}

export class NPCCultivationEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    // 总进度 = 闭关进度 + 游历感悟。闭关受境界 cultivationCap 上限约束，撞顶后须游历补足。
    const cultivationProgress = entityState.get('cultivationProgress') || 0;
    const insight = entityState.get('insight') || 0;
    const totalProgress = cultivationProgress + insight;
    const factionAtPeace = entityState.get('factionAtPeace');
    let priority = 15;
    let urgency = 0;

    if (totalProgress < 0.3) { priority += 40; urgency += 20; }
    if (factionAtPeace) { priority += 15; urgency += 5; }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: { totalProgress: { op: 'gte', value: 1.0 } },
      satisfied: totalProgress >= 1.0,
    };
  }
}

export class NPCDutyEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    const isLeader = entityState.get('isLeader');
    const isElder = entityState.get('isElder');
    const factionInDanger = entityState.get('factionInDanger');
    let priority = 5;
    let urgency = 0;

    if (isLeader) { priority += 30; urgency += 20; }
    if (isElder) { priority += 15; urgency += 10; }
    if (factionInDanger) { priority += 25; urgency += 30; }

    const personality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('factionId'))
      : null;

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: { dutyFulfilled: { op: 'eq', value: true } },
      satisfied: false,
    };
  }
}

export class NPCAmbitionEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    const roleRank = entityState.get('roleRank') || 1;
    const factionAtPeace = entityState.get('factionAtPeace');
    let priority = 1;
    let urgency = 0;

    if (roleRank < 3) { priority += 15; urgency += 5; }
    if (factionAtPeace) { priority += 10; urgency += 5; }

    return {
      priority: Math.max(0, Math.min(100, priority)),
      urgency: Math.min(100, urgency),
      goalState: { roleRank: { op: 'gte', value: 5 } },
      satisfied: roleRank >= 5,
    };
  }
}

export class NPCBreakthroughEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    const cultivationProgress = entityState.get('cultivationProgress') || 0;
    const insight = entityState.get('insight') || 0;
    const totalProgress = cultivationProgress + insight;
    let priority = 8;
    let urgency = 0;

    if (totalProgress >= 0.95) {
      priority += 80;
      urgency += 80;
    } else if (totalProgress >= 0.9) {
      priority += 60;
      urgency += 50;
    }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: { totalProgress: { op: 'lt', value: 0.5 } },
      satisfied: totalProgress < 0.5,
    };
  }
}

export function registerNPCEvaluators() {
  NeedPool.registerEvaluatorFactory('npc_survival', () => new NPCSurvivalEvaluator());
  NeedPool.registerEvaluatorFactory('npc_cultivation', () => new NPCCultivationEvaluator());
  NeedPool.registerEvaluatorFactory('npc_duty', () => new NPCDutyEvaluator());
  NeedPool.registerEvaluatorFactory('npc_ambition', () => new NPCAmbitionEvaluator());
  NeedPool.registerEvaluatorFactory('npc_breakthrough', () => new NPCBreakthroughEvaluator());
}
