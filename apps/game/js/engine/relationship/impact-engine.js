import { ExpressionEvaluator } from './expression-evaluator.js';
import { SelectorResolver } from './selector-resolver.js';
import { EffectOperatorRegistry } from './effect-operators.js';

function flattenRules(ruleFiles = []) {
  const out = [];
  for (const file of ruleFiles || []) {
    if (Array.isArray(file?.rules)) out.push(...file.rules);
  }
  return out;
}

function visibilityMatches(rule, event) {
  const vis = rule.match?.visibility;
  if (!vis) return true;
  return Array.isArray(vis) ? vis.includes(event.visibility) : vis === event.visibility;
}

export class RelationImpactEngine {
  constructor({ repository, rules = [], evaluator = null, selectorResolver = null } = {}) {
    this.repository = repository;
    this.rules = flattenRules(rules);
    this.evaluator = evaluator || new ExpressionEvaluator();
    this.selectorResolver = selectorResolver || new SelectorResolver();
    this.operators = new EffectOperatorRegistry({
      repository,
      evaluator: this.evaluator,
      selectorResolver: this.selectorResolver,
    });
  }

  _context(event) {
    return {
      event,
      actor: event.actor || {},
      target: event.target || {},
      subject: event.subject || {},
      object: event.object || {},
      source: event.source || {},
      witness: event.witness || {},
      group: event.group || {},
      faction: event.faction || {},
      world: event.world || {},
    };
  }

  _matches(rule, event) {
    if (rule.match?.eventType !== event.type) return false;
    if (!visibilityMatches(rule, event)) return false;
    const context = this._context(event);
    for (const condition of rule.match?.conditions || []) {
      if (!this.evaluator.test(condition, context)) return false;
    }
    return true;
  }

  _resolveExclusiveGroups(rules) {
    const selected = [];
    const byExclusive = new Map();
    for (const rule of rules) {
      if (!rule.exclusiveGroup) {
        selected.push(rule);
        continue;
      }
      const prev = byExclusive.get(rule.exclusiveGroup);
      if (!prev || (rule.priority || 0) > (prev.priority || 0)) {
        byExclusive.set(rule.exclusiveGroup, rule);
      }
    }
    selected.push(...byExclusive.values());
    selected.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return selected;
  }

  apply(event) {
    if (!event?.type) return [];
    const matched = this._resolveExclusiveGroups(this.rules.filter(rule => this._matches(rule, event)));
    const traces = [];
    for (const rule of matched) {
      const baseContext = { ...this._context(event), ruleId: rule.id };
      const ledgers = [];
      for (const effect of rule.effects || []) {
        const applied = this.operators.apply(effect, baseContext);
        const appliedLedgers = Array.isArray(applied) ? applied : [applied].filter(Boolean);
        for (const ledger of appliedLedgers) {
          ledgers.push({
            layer: ledger.layer,
            subjectId: ledger.subjectId,
            objectId: ledger.objectId || null,
            groupId: ledger.groupId || null,
            factionId: ledger.factionId || null,
          });
        }
      }
      traces.push({ ruleId: rule.id, ledgers });
    }
    return traces;
  }
}
