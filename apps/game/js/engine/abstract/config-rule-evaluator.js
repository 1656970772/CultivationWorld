import { NeedEvaluator } from './need.js';

function clamp(value, bounds = [0, 100]) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  const lo = Number(bounds[0] ?? 0);
  const hi = Number(bounds[1] ?? 100);
  return Math.max(lo, Math.min(hi, safe));
}

function readState(entityState, key) {
  if (!key) return undefined;
  if (typeof entityState?.get === 'function') return entityState.get(key);
  return entityState?.[key];
}

function readPath(source, path) {
  if (!path) return source;
  return String(path).split('.').reduce((value, key) => value?.[key], source);
}

function comparable(value) {
  const stageOrder = { early: 0, middle: 1, late: 2, perfection: 3 };
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(stageOrder, value)) {
    return stageOrder[value];
  }
  return value;
}

export class ConfigRuleEvaluator extends NeedEvaluator {
  constructor(config = {}) {
    super();
    this.config = config || {};
    this.rules = Array.isArray(config.rules) ? config.rules : [];
    this.basePriority = Number(config.basePriority ?? 0);
    this.baseUrgency = Number(config.baseUrgency ?? 0);
    this.satisfiedCondition = config.satisfiedCondition || null;
    this.priorityClamp = config.priorityClamp || config.clamp?.priority || [0, 100];
    this.urgencyClamp = config.urgencyClamp || config.clamp?.urgency || [0, 100];
  }

  calculate(entityState, worldContext, need) {
    const terminal = this.config.terminalCondition || this.config.blockerCondition;
    if (terminal && this.evaluateCondition(terminal.condition || terminal, entityState, worldContext)) {
      return {
        priority: Number(terminal.priority ?? 0),
        urgency: Number(terminal.urgency ?? 0),
        goalState: terminal.goalState || {},
        satisfied: terminal.satisfied ?? true,
      };
    }

    let priority = this.resolveNumber(this.basePriority, entityState, worldContext);
    let urgency = this.resolveNumber(this.baseUrgency, entityState, worldContext);
    let goalState = { ...(need?.goalStateTemplate || {}), ...(this.config.goalState || {}) };

    for (const rule of this.rules) {
      if (!this.evaluateCondition(rule.condition, entityState, worldContext)) continue;
      priority += this.resolveNumber(rule.priorityBoost ?? rule.priority ?? 0, entityState, worldContext);
      urgency += this.resolveNumber(rule.urgencyBoost ?? rule.urgency ?? 0, entityState, worldContext);
      if (rule.goalStateOverride) goalState = { ...goalState, ...rule.goalStateOverride };
    }

    const satisfied = this.satisfiedCondition
      ? this.evaluateCondition(this.satisfiedCondition, entityState, worldContext)
      : this.evaluateGoalState(goalState, entityState, worldContext);

    return {
      priority: clamp(priority, this.priorityClamp),
      urgency: clamp(urgency, this.urgencyClamp),
      goalState,
      satisfied,
    };
  }

  resolveSource(spec = {}, entityState, worldContext) {
    const source = spec.source || 'state';
    if (source === 'world') return worldContext || {};
    if (source === 'leaderPersonality') {
      const leaderNpcId = readState(entityState, 'leaderNpcId');
      return typeof worldContext?.getLeaderPersonality === 'function'
        ? (worldContext.getLeaderPersonality(leaderNpcId) || {})
        : {};
    }
    if (source === 'context') return worldContext || {};
    return entityState;
  }

  resolveValue(spec, entityState, worldContext) {
    if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return spec;
    const source = this.resolveSource(spec, entityState, worldContext);
    if (spec.key || spec.source) {
      if (spec.source === 'state' || !spec.source) return readState(source, spec.key);
      return readPath(source, spec.key);
    }
    if (Object.prototype.hasOwnProperty.call(spec, 'value')) return spec.value;
    return undefined;
  }

  resolveNumber(spec, entityState, worldContext) {
    if (typeof spec === 'number') return spec;
    if (spec == null) return 0;
    if (typeof spec !== 'object') return Number(spec) || 0;
    const base = Number(this.resolveValue(spec, entityState, worldContext) ?? 0);
    const scaled = base * Number(spec.scale ?? 1) + Number(spec.offset ?? 0);
    return Number.isFinite(scaled) ? scaled : 0;
  }

  evaluateCondition(condition, entityState, worldContext) {
    if (!condition) return true;
    if (Array.isArray(condition.all)) {
      return condition.all.every(c => this.evaluateCondition(c, entityState, worldContext));
    }
    if (Array.isArray(condition.any)) {
      return condition.any.some(c => this.evaluateCondition(c, entityState, worldContext));
    }
    if (condition.not) {
      return !this.evaluateCondition(condition.not, entityState, worldContext);
    }

    const actual = this.resolveValue(condition, entityState, worldContext);
    const expected = Object.prototype.hasOwnProperty.call(condition, 'value') ? condition.value : true;
    const a = comparable(actual);
    const b = comparable(expected);

    switch (condition.op) {
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'eq': return actual === expected;
      case 'neq': return actual !== expected;
      case 'exists': return actual != null;
      case 'true': return actual === true;
      case 'false': return actual === false;
      default: return false;
    }
  }

  evaluateGoalState(goalState, entityState, worldContext) {
    const entries = Object.entries(goalState || {});
    if (entries.length === 0) return false;
    return entries.every(([key, condition]) => {
      if (!condition || typeof condition !== 'object') return readState(entityState, key) === condition;
      return this.evaluateCondition({ key, ...condition }, entityState, worldContext);
    });
  }
}
