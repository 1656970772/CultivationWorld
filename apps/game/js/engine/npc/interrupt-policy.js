/**
 * InterruptPolicy - 动态 Goal 对当前行为链的打断决策。
 *
 * 只判断"何时重决策"，不直接修改计划或事件感知缓存。
 */
import { GoalSource } from '../abstract/goal.js';

export const InterruptDecision = Object.freeze({
  INTERRUPT_NOW: 'interrupt_now',
  AFTER_STEP: 'after_step',
  KEEP_CURRENT_QUEUE: 'keep_current_queue',
  IGNORE: 'ignore',
});

const DECISION_RANK = Object.freeze({
  [InterruptDecision.IGNORE]: 0,
  [InterruptDecision.KEEP_CURRENT_QUEUE]: 1,
  [InterruptDecision.AFTER_STEP]: 2,
  [InterruptDecision.INTERRUPT_NOW]: 3,
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function readState(entity, key, fallback = null) {
  if (!entity?.state) return fallback;
  if (typeof entity.state.get === 'function') {
    const value = entity.state.get(key);
    return value == null ? fallback : value;
  }
  return entity.state[key] == null ? fallback : entity.state[key];
}

function personality(entity) {
  const direct = entity?.staticData?.personality;
  if (direct) return direct;
  if (typeof entity?.staticData?.get === 'function') {
    const fromGetter = entity.staticData.get('personality');
    if (fromGetter) return fromGetter;
  }
  return entity?.state?.personality || {};
}

function behaviorBusy(entity) {
  return entity?.behaviorSystem?.isBusy?.() === true;
}

function currentPlanResult(entity) {
  return entity?.behaviorSystem?.getLastPlanResult?.() || null;
}

function isCultivationPlan(plan) {
  if (!plan) return false;
  if (plan.needId === 'need_npc_cultivation') return true;
  return Array.isArray(plan.actions) && plan.actions.some(id =>
    typeof id === 'string' && id.includes('cultivate')
  );
}

function behaviorLoss(entity, plan) {
  if (!behaviorBusy(entity)) return 0;
  let loss = -10;
  if (isCultivationPlan(plan)) loss -= 8;
  const progress = Number(readState(entity, 'totalProgress', 0)) || 0;
  if (progress >= 0.95 && isCultivationPlan(plan)) loss -= 20;
  const injury = Number(readState(entity, 'injuryLevel', 0)) || 0;
  if (injury > 0) loss -= clamp(injury, 0, 100) * 0.08;
  return loss;
}

function personalityDelta(entity, kind) {
  const p = personality(entity);
  const caution = clamp(p.caution ?? 50, 0, 100);
  const courage = clamp(p.courage ?? 50, 0, 100);
  const loyalty = clamp(p.loyalty ?? 50, 0, 100);
  if (kind === 'preparation') return (caution - 50) * 0.2;
  if (kind === 'immediate') return (courage - 50) * 0.3 + (loyalty - 50) * 0.1;
  if (kind === 'window') return (courage - 50) * 0.2 - (caution - 50) * 0.1;
  return 0;
}

function scoreGoal(goal, entity) {
  const dynamic = goal?.dynamic || {};
  const kind = dynamic.kind || goal?.tag || null;
  const baseScore = typeof goal?.score === 'function' ? goal.score() : Number(goal?.priority ?? 0) || 0;
  const urgency = typeof goal?.urgencyScore === 'function' ? goal.urgencyScore() : Number(goal?.urgency ?? 0) || 0;
  const eventValue = Number(dynamic.eventValue ?? 0) || 0;
  const interrupt = dynamic.interrupt || {};
  const plan = currentPlanResult(entity);
  return {
    score: baseScore
      + urgency * 0.25
      + Math.min(25, Math.max(0, eventValue) / 40)
      + (Number(interrupt.urgencyBias ?? 0) || 0)
      + personalityDelta(entity, kind)
      + behaviorLoss(entity, plan),
    kind,
    plan,
  };
}

function requestedDecision(goal) {
  const value = goal?.dynamic?.interrupt?.minDecision;
  if (Object.prototype.hasOwnProperty.call(DECISION_RANK, value)) return value;
  return null;
}

function minDecisionAtLeast(candidate, minimum) {
  if (!minimum) return candidate;
  return DECISION_RANK[candidate] >= DECISION_RANK[minimum] ? candidate : minimum;
}

function isProtectedPreparation(entity, goal, plan) {
  const kind = goal?.dynamic?.kind || goal?.tag || null;
  if (kind !== 'preparation') return false;
  const progress = Number(readState(entity, 'totalProgress', 0)) || 0;
  return progress >= 0.95 && behaviorBusy(entity) && isCultivationPlan(plan);
}

function sameDynamicTarget(entity, goal) {
  const plan = currentPlanResult(entity);
  if (plan?.goalSource !== GoalSource.DYNAMIC) return false;
  if (plan.dynamicEventId && plan.dynamicEventId === goal?.dynamic?.eventId) return true;
  return plan.needId && plan.needId === goal?.sourceId;
}

export class InterruptPolicy {
  /**
   * @param {Object} entity
   * @param {import('../abstract/goal.js').Goal} goal
   * @param {Object} [worldContext]
   */
  static decide(entity, goal, worldContext = {}) {
    const day = worldContext.currentDay ?? worldContext.day ?? 0;
    const eventId = goal?.dynamic?.eventId ?? null;
    const goalId = goal?.id ?? null;

    if (!goal || goal.source !== GoalSource.DYNAMIC) {
      return {
        decision: InterruptDecision.KEEP_CURRENT_QUEUE,
        score: 0,
        eventId,
        goalId,
        reason: 'not_dynamic',
        day,
      };
    }

    if (sameDynamicTarget(entity, goal)) {
      const { score } = scoreGoal(goal, entity);
      return {
        decision: InterruptDecision.KEEP_CURRENT_QUEUE,
        score: Math.round(score),
        eventId,
        goalId,
        reason: 'already_targeting_dynamic_event',
        day,
      };
    }

    const { score, kind, plan } = scoreGoal(goal, entity);
    const roundedScore = Math.round(score);
    const minimum = requestedDecision(goal);

    let decision;
    let reason;
    if (isProtectedPreparation(entity, goal, plan)) {
      decision = InterruptDecision.AFTER_STEP;
      reason = 'near_breakthrough_prepare_after_step';
    } else if (kind === 'immediate' || score >= 85) {
      decision = InterruptDecision.INTERRUPT_NOW;
      reason = 'high_value_dynamic_goal';
    } else if (score >= 55) {
      decision = InterruptDecision.AFTER_STEP;
      reason = 'worth_after_step';
    } else if (score >= 45) {
      decision = InterruptDecision.KEEP_CURRENT_QUEUE;
      reason = 'keep_current_queue';
    } else {
      decision = InterruptDecision.IGNORE;
      reason = 'low_interrupt_score';
    }

    if (decision !== InterruptDecision.IGNORE) {
      const raised = minDecisionAtLeast(decision, minimum);
      if (raised !== decision) {
        decision = raised;
        reason = `min_decision_${minimum}`;
      }
    }

    return {
      decision,
      score: roundedScore,
      eventId,
      goalId,
      reason,
      day,
    };
  }
}
