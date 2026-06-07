/**
 * DynamicGoalProvider - 从 NPC 已知动态事件中产出额外 Goal。
 *
 * 输入只读取 EventAwareness 内的事件快照，以及 worldContext.dynamicEventById 提供的新鲜快照；
 * 不直接接触 WorldEventSystem 或 WorldEvent live 实例。
 */
import { Goal, GoalSource } from '../abstract/goal.js';
import { getCultivationRequired } from './numeric-cultivation.js';

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function cloneJSONCompatible(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function getStateValue(entity, key, fallback = null) {
  if (!entity?.state) return fallback;
  if (typeof entity.state.get === 'function') {
    const value = entity.state.get(key);
    return value == null ? fallback : value;
  }
  return entity.state[key] == null ? fallback : entity.state[key];
}

function getPersonality(entity) {
  const direct = entity?.staticData?.personality;
  if (direct) return direct;
  if (typeof entity?.staticData?.get === 'function') {
    const fromGetter = entity.staticData.get('personality');
    if (fromGetter) return fromGetter;
  }
  return entity?.state?.personality || {};
}

function norm(value, fallback = 50) {
  const n = Number(value ?? fallback);
  return clamp(n, 0, 100) / 100;
}

function cultivationCompletion(entity) {
  const total = Number(getStateValue(entity, 'totalCultivation', 0)) || 0;
  const required = Number(getStateValue(entity, 'nextCultivationRequired', null) ?? getCultivationRequired(entity, entity?._ranksData || [])) || 0;
  return required > 0 ? clamp(total / required, 0, 1) : 0;
}

function ruleEventTypes(rule) {
  if (Array.isArray(rule.eventTypes)) return new Set(rule.eventTypes);
  if (rule.eventType) return new Set([rule.eventType]);
  return null;
}

function rulePhases(rule) {
  if (!Array.isArray(rule.phases) || rule.phases.length === 0) return null;
  return new Set(rule.phases);
}

function configuredRules(config) {
  if (Array.isArray(config.goals)) return config.goals;
  if (Array.isArray(config.rules)) return config.rules;
  return [];
}

function minConfidenceFor(rule, config) {
  return Number(
    rule.requiredAwarenessConfidence
      ?? rule.minConfidence
      ?? config.requiredAwarenessConfidence
      ?? config.minConfidence
      ?? 0,
  );
}

function timeWindowMatches(rule, daysUntilStart) {
  if (!rule.timeWindowDays) return true;
  if (Array.isArray(rule.timeWindowDays)) {
    const [min, max] = rule.timeWindowDays;
    if (min != null && daysUntilStart < Number(min)) return false;
    if (max != null && daysUntilStart > Number(max)) return false;
    return true;
  }
  const window = rule.timeWindowDays || {};
  if (window.min != null && daysUntilStart < Number(window.min)) return false;
  if (window.max != null && daysUntilStart > Number(window.max)) return false;
  return true;
}

export class DynamicGoalProvider {
  /**
   * @param {Object} entity
   * @param {Object} worldContext
   * @returns {Goal[]}
   */
  static collect(entity, worldContext = {}) {
    const config = worldContext?.dynamicGoalConfig ?? entity?._dynamicGoalConfig ?? {};
    if (config?.enabled !== true) {
      this._clearTarget(entity);
      return [];
    }
    if (!entity?.eventAwareness || typeof entity.eventAwareness.knownEvents !== 'function') {
      this._clearTarget(entity);
      return [];
    }

    const currentDay = worldContext.currentDay ?? worldContext.day ?? 0;
    const eventById = typeof worldContext.dynamicEventById === 'function'
      ? (id) => worldContext.dynamicEventById(id)
      : null;
    const entries = entity.eventAwareness.knownEvents({ currentDay, eventById });
    const rules = configuredRules(config);
    const goals = [];

    for (const entry of entries) {
      const event = entry.event;
      if (!event?.id) continue;
      for (const rule of rules) {
        const goal = this._goalForRule(entity, event, entry, rule, currentDay, config);
        if (goal) goals.push(goal);
      }
    }

    goals.sort((a, b) => {
      const byScore = b.score() - a.score();
      if (byScore !== 0) return byScore;
      return b.urgencyScore() - a.urgencyScore();
    });

    const maxGoals = Math.max(0, Number(config.maxGoalsPerNpc ?? goals.length) || 0);
    const capped = goals.slice(0, maxGoals);
    if (capped.length === 0) {
      this._clearTarget(entity);
    }
    return capped;
  }

  static _goalForRule(entity, event, entry, rule, currentDay, config) {
    if (!rule || rule.enabled === false) return null;
    const eventTypes = ruleEventTypes(rule);
    if (eventTypes && !eventTypes.has(event.type)) return null;
    const phases = rulePhases(rule);
    if (phases && !phases.has(event.phase)) return null;

    const confidence = Number(entry.confidence ?? 0);
    const minConfidence = minConfidenceFor(rule, config);
    if (confidence < minConfidence) return null;

    const daysUntilStart = Number(event.startDay ?? currentDay) - currentDay;
    if (!timeWindowMatches(rule, daysUntilStart)) return null;

    const priorityBounds = rule.priorityBounds || config.priorityBounds || [0, 100];
    const urgencyBounds = rule.urgencyBounds || config.urgencyBounds || [0, 100];
    const basePriority = Number(rule.basePriority ?? rule.priority ?? 0);
    const motiveMult = this._motiveMultiplier(entity, rule, config);
    const eventValue = Number(event.value ?? 0) || 0;
    const eventValueWeight = Number(rule.eventValueWeight ?? config.eventValueWeight ?? 0) || 0;
    const priority = clamp(
      basePriority * motiveMult + eventValue * eventValueWeight,
      priorityBounds[0] ?? 0,
      priorityBounds[1] ?? 100,
    );
    const urgency = clamp(
      Number(rule.urgency ?? 0),
      urgencyBounds[0] ?? 0,
      urgencyBounds[1] ?? 100,
    );

    const goal = new Goal({
      id: `goal_dynamic_${rule.id}_${event.id}`,
      name: rule.name ? `${rule.name}：${event.name || event.id}` : event.name || rule.id,
      source: GoalSource.DYNAMIC,
      sourceId: rule.id,
      goalState: cloneJSONCompatible(rule.goalState || {}),
      priority,
      urgency,
      tag: rule.kind || 'dynamic',
      selectStrategy: rule.selectStrategy || 'astar',
    });
    goal.dynamic = {
      eventId: event.id,
      eventType: event.type,
      kind: rule.kind || null,
      interrupt: rule.interrupt ?? null,
      confidence,
      daysUntilStart,
      eventValue,
      riskKey: cloneJSONCompatible(event.riskKey ?? null),
    };
    return goal;
  }

  static _motiveMultiplier(entity, rule, config) {
    const weights = rule.motiveWeights
      || rule.motiveMultipliers
      || rule.motives
      || config.motiveWeights
      || config.motiveMultipliers
      || {};
    const entries = Object.entries(weights);
    if (entries.length === 0) return 1;
    const affinities = this._motiveAffinities(entity);
    let mult = 1;
    for (const [key, target] of entries) {
      const targetMult = Number(target);
      if (!Number.isFinite(targetMult)) continue;
      const affinity = clamp(affinities[key] ?? 0, 0, 1);
      mult *= 1 + affinity * (targetMult - 1);
    }
    const bounds = rule.motiveBounds || config.motiveBounds || [0.25, 2.5];
    return clamp(mult, bounds[0] ?? 0.25, bounds[1] ?? 2.5);
  }

  static _motiveAffinities(entity) {
    const personality = getPersonality(entity);
    const ambition = norm(personality.ambition);
    const caution = norm(personality.caution);
    const loyalty = norm(personality.loyalty);
    const diplomacy = norm(personality.diplomacy);
    const injury = Number(getStateValue(entity, 'injuryLevel', 0)) || 0;
    const lifeRatio = clamp(Number(getStateValue(entity, 'lifeRatio', 0)) || 0, 0, 1);
    const cultivationCompletionRatio = cultivationCompletion(entity);
    const hasRevengeTarget = getStateValue(entity, 'hasRevengeTarget', false) === true;

    return {
      dao: Math.max(ambition, cultivationCompletionRatio),
      profit: Math.max(0, ambition * (1 - diplomacy * 0.25)),
      survival: Math.max(caution, lifeRatio, injury > 0 ? 0.8 : 0),
      revenge: hasRevengeTarget ? 1 : Math.max(0, 1 - loyalty),
    };
  }

  static _clearTarget(entity) {
    if (typeof entity?.state?.set === 'function'
        && entity.state.get?.('targetDynamicEventId') != null) {
      entity.state.set('targetDynamicEventId', null);
      entity.state.set('targetDynamicEventType', null);
    }
  }
}
