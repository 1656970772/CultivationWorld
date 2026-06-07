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

/**
 * 修炼需求评估器（硬编码版）。
 * 注意：当前 need_npc_cultivation 使用 evaluatorType="configurable"（走 data/needs/npc-needs.json
 * 配置），本类未被启用，仅作为编程式 fallback 保留。突破有两条硬门槛（数值修为 + 真气达标），
 * 故 goalState 与 satisfied 同时考量 totalCultivation 与 qiBelowNextRank，避免切回本评估器时丢失真气约束。
 */
export class NPCCultivationEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    // 突破判断当前境界还差什么：①数值修为；②真气(qiBelowNextRank)。缺哪条补哪条。
    const totalCultivation = Number(entityState.get('totalCultivation') || 0);
    const nextCultivationRequired = Number(entityState.get('nextCultivationRequired') || 0);
    const cultivationShortfall = Number(entityState.get('cultivationShortfall') ?? Math.max(0, nextCultivationRequired - totalCultivation));
    const qiBelowNextRank = !!entityState.get('qiBelowNextRank');
    const factionAtPeace = entityState.get('factionAtPeace');
    const completion = nextCultivationRequired > 0 ? totalCultivation / nextCultivationRequired : 1;
    let priority = 15;
    let urgency = 0;

    if (completion < 0.85) { priority += 20; urgency += 10; }
    if (completion < 0.3) { priority += 10; urgency += 8; }
    if (qiBelowNextRank) { priority += 15; urgency += 10; }
    if (factionAtPeace) { priority += 15; urgency += 5; }

    // 增量式目标（ADR-047）：每次只规划推进一小步(step=0.05，夹 1.0)，做完重评估，
    // 与 data/needs/npc-needs.json 的 configurable 版语义一致（破解一次性折叠到 1.0 卡死）。
    const step = nextCultivationRequired > 0 ? nextCultivationRequired * 0.01 : 1;
    const nextTarget = Math.min(totalCultivation + step, nextCultivationRequired || totalCultivation + step);
    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: {
        totalCultivation: { op: 'gte', value: nextTarget },
        qiBelowNextRank: { op: 'eq', value: false },
      },
      satisfied: cultivationShortfall <= 0 && !qiBelowNextRank,
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
    const totalCultivation = Number(entityState.get('totalCultivation') || 0);
    const nextCultivationRequired = Number(entityState.get('nextCultivationRequired') || 0);
    const completion = nextCultivationRequired > 0 ? totalCultivation / nextCultivationRequired : 1;
    let priority = 8;
    let urgency = 0;

    if (completion >= 0.95) {
      priority += 80;
      urgency += 80;
    } else if (completion >= 0.9) {
      priority += 60;
      urgency += 50;
    }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: { totalCultivation: { op: 'lt', value: nextCultivationRequired * 0.5 } },
      satisfied: completion < 0.5,
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
