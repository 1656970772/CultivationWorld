/**
 * FactionNeeds - 势力专用需求评估器
 *
 * 提供势力特有的评估逻辑工厂，注册到 NeedPool。
 * 不同阵营类型通过性格修正影响优先级。
 */
import { NeedEvaluator } from '../abstract/need.js';
import { NeedPool } from '../pools/need-pool.js';

/**
 * 势力生存需求评估器
 */
export class FactionSurvivalEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    let priority = 10;
    let urgency = 0;
    const stability = entityState.get('stability') || 50;
    const disciples = entityState.get('disciples') || 0;
    const food = entityState.get('food') || 0;
    const isDestroyed = entityState.get('isDestroyed');

    if (isDestroyed) return { priority: 0, urgency: 0, goalState: {}, satisfied: true };

    if (stability < 20) { priority += 80; urgency += 90; }
    else if (stability < 40) { priority += 50; urgency += 60; }

    if (disciples < 50) { priority += 70; urgency += 80; }
    if (food < 100) { priority += 40; urgency += 50; }

    const leaderPersonality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('leaderNpcId'))
      : null;

    if (leaderPersonality) {
      priority += (100 - leaderPersonality.ambition) * 0.1;
      priority += leaderPersonality.caution * 0.15;
    }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: {
        stability: { op: 'gte', value: 60 },
        disciples: { op: 'gte', value: 100 },
        food: { op: 'gte', value: 300 },
      },
      satisfied: stability >= 60 && disciples >= 100 && food >= 300,
    };
  }
}

/**
 * 势力扩张需求评估器
 */
export class FactionExpansionEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    let priority = 3;
    let urgency = 0;
    const stability = entityState.get('stability') || 50;
    const territoryCount = entityState.get('territoryCount') || 0;
    const hasAdjacentUnowned = entityState.get('hasAdjacentUnowned');

    if (stability < 40) return { priority: 0, urgency: 0, goalState: {}, satisfied: false };

    if (territoryCount < 10) { priority += 30; urgency += 20; }
    if (stability >= 60) { priority += 15; urgency += 5; }
    if (hasAdjacentUnowned) { priority += 10; urgency += 5; }

    const leaderPersonality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('leaderNpcId'))
      : null;

    if (leaderPersonality) {
      priority += leaderPersonality.ambition * 0.3;
      priority -= leaderPersonality.caution * 0.2;
    }

    const targetCount = Math.max(territoryCount + 5, 15);

    return {
      priority: Math.max(0, Math.min(100, priority)),
      urgency: Math.min(100, urgency),
      goalState: {
        territoryCount: { op: 'gte', value: targetCount },
        hasAdjacentUnowned: { op: 'true' },
      },
      satisfied: false,
    };
  }
}

/**
 * 势力防御需求评估器
 */
export class FactionDefenseEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    let priority = 5;
    let urgency = 0;
    const borderThreat = entityState.get('borderThreat') || 0;
    const underAttack = entityState.get('underAttack');
    const stability = entityState.get('stability') || 50;

    if (borderThreat > 0) { priority += 40; urgency += 50; }
    if (underAttack) { priority += 70; urgency += 90; }
    if (stability < 50) { priority += 20; urgency += 30; }

    const leaderPersonality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('leaderNpcId'))
      : null;

    if (leaderPersonality) {
      priority += leaderPersonality.caution * 0.25;
    }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: {
        borderThreat: { op: 'lte', value: 0 },
        stability: { op: 'gte', value: 50 },
      },
      satisfied: borderThreat <= 0 && !underAttack,
    };
  }
}

/**
 * 势力发展需求评估器
 */
export class FactionDevelopmentEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    let priority = 8;
    let urgency = 0;
    const spiritStone = entityState.get('low_spirit_stone') || 0;
    const food = entityState.get('food') || 0;
    const disciples = entityState.get('disciples') || 0;

    if (spiritStone < 500) { priority += 30; urgency += 20; }
    if (food < 500) { priority += 35; urgency += 30; }
    if (disciples < 100) { priority += 25; urgency += 15; }

    const leaderPersonality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('leaderNpcId'))
      : null;

    if (leaderPersonality) {
      priority += (100 - leaderPersonality.ambition) * 0.15;
      priority += leaderPersonality.diplomacy * 0.1;
    }

    return {
      priority: Math.min(100, priority),
      urgency: Math.min(100, urgency),
      goalState: {
        low_spirit_stone: { op: 'gte', value: 2000 },
        food: { op: 'gte', value: 1500 },
      },
      satisfied: spiritStone >= 2000 && food >= 1500,
    };
  }
}

/**
 * 势力外交需求评估器
 */
export class FactionDiplomacyEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    let priority = 2;
    let urgency = 0;
    const allyCount = entityState.get('allyCount') || 0;
    const enemyCount = entityState.get('enemyCount') || 0;
    const stability = entityState.get('stability') || 50;

    if (allyCount < 1) { priority += 25; urgency += 15; }
    if (enemyCount >= 3) { priority += 30; urgency += 25; }
    if (stability < 50) { priority += 15; urgency += 10; }

    const leaderPersonality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('leaderNpcId'))
      : null;

    if (leaderPersonality) {
      priority += leaderPersonality.diplomacy * 0.35;
      priority -= leaderPersonality.ambition * 0.1;
    }

    return {
      priority: Math.max(0, Math.min(100, priority)),
      urgency: Math.min(100, urgency),
      goalState: {
        allyCount: { op: 'gte', value: 1 },
      },
      satisfied: allyCount >= 2,
    };
  }
}

/**
 * 势力军事需求评估器
 */
export class FactionMilitaryEvaluator extends NeedEvaluator {
  calculate(entityState, worldContext, need) {
    let priority = 1;
    let urgency = 0;
    const militaryAdvantage = entityState.get('militaryAdvantage') || 0;
    const stability = entityState.get('stability') || 50;
    const hasWeakEnemy = entityState.get('hasWeakEnemy');

    if (militaryAdvantage > 0.3) { priority += 25; urgency += 10; }
    if (stability >= 70) { priority += 10; urgency += 5; }
    if (hasWeakEnemy) { priority += 20; urgency += 15; }

    const leaderPersonality = worldContext.getLeaderPersonality
      ? worldContext.getLeaderPersonality(entityState.get('leaderNpcId'))
      : null;

    if (leaderPersonality) {
      priority += leaderPersonality.ambition * 0.3;
      priority -= leaderPersonality.caution * 0.25;
      priority -= leaderPersonality.diplomacy * 0.1;
    }

    return {
      priority: Math.max(0, Math.min(100, priority)),
      urgency: Math.min(100, urgency),
      goalState: {
        hasAdjacentEnemy: { op: 'true' },
        stability: { op: 'gte', value: 50 },
        disciples: { op: 'gte', value: 100 },
      },
      satisfied: false,
    };
  }
}

/**
 * 注册势力专用评估器到 NeedPool
 */
export function registerFactionEvaluators() {
  NeedPool.registerEvaluatorFactory('faction_survival', () => new FactionSurvivalEvaluator());
  NeedPool.registerEvaluatorFactory('faction_expansion', () => new FactionExpansionEvaluator());
  NeedPool.registerEvaluatorFactory('faction_defense', () => new FactionDefenseEvaluator());
  NeedPool.registerEvaluatorFactory('faction_development', () => new FactionDevelopmentEvaluator());
  NeedPool.registerEvaluatorFactory('faction_diplomacy', () => new FactionDiplomacyEvaluator());
  NeedPool.registerEvaluatorFactory('faction_military', () => new FactionMilitaryEvaluator());
}
