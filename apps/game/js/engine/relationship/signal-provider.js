import { ExpressionEvaluator } from './expression-evaluator.js';
import { SelectorResolver } from './selector-resolver.js';

function flattenRules(ruleFiles = []) {
  const out = [];
  for (const file of ruleFiles || []) {
    if (Array.isArray(file?.rules)) out.push(...file.rules);
  }
  return out;
}

export class RelationshipSignalProvider {
  constructor({ repository, rules = [], evaluator = null, selectorResolver = null } = {}) {
    this.repository = repository;
    this.rules = flattenRules(rules);
    this.evaluator = evaluator || new ExpressionEvaluator();
    this.selectorResolver = selectorResolver || new SelectorResolver();
  }

  _empty() {
    return {
      facts: {},
      gates: {},
      modifiers: {},
      targetPreferences: {},
      traces: [],
    };
  }

  _applies(rule, input) {
    const appliesTo = rule.appliesTo || {};
    if (appliesTo.contextType && appliesTo.contextType !== input.contextType) return false;
    if (appliesTo.actionId && appliesTo.actionId !== input.actionId) return false;
    return true;
  }

  _context(input, ledger = null) {
    return {
      event: input,
      actor: input.actor || {},
      target: input.target || {},
      source: input.source || {},
      witness: input.witness || {},
      group: input.group || {},
      faction: input.faction || {},
      world: input.world || {},
      ledger,
    };
  }

  _resolveLedger(spec, input) {
    const context = this._context(input);
    const ref = this.selectorResolver.resolveLedgerRef(spec, context);
    return this.repository.getLedger(ref, { create: false });
  }

  _conditionsPass(rule, input, ledger) {
    const context = this._context(input, ledger);
    for (const condition of rule.match?.conditions || []) {
      if (!this.evaluator.test(condition, context)) return false;
    }
    return true;
  }

  _mergeOutputs(result, outputs, context) {
    for (const [key, value] of Object.entries(outputs.facts || {})) {
      result.facts[key] = this.evaluator.evaluate(value, context);
    }
    for (const [key, value] of Object.entries(outputs.gates || {})) {
      result.gates[key] = result.gates[key] === true || this.evaluator.evaluate(value, context);
    }
    for (const [key, value] of Object.entries(outputs.modifiers || {})) {
      const current = result.modifiers[key] == null ? 1 : result.modifiers[key];
      result.modifiers[key] = current * (Number(this.evaluator.evaluate(value, context)) || 0);
    }
    for (const [key, value] of Object.entries(outputs.targetPreferences || {})) {
      const current = Number(result.targetPreferences[key]) || 0;
      result.targetPreferences[key] = current + (Number(this.evaluator.evaluate(value, context)) || 0);
    }
  }

  getFacts(input = {}) {
    return this.getSignals({ ...input, contextType: input.contextType || 'facts' }).facts;
  }

  getSignals(input = {}) {
    const result = this._empty();
    for (const rule of this.rules) {
      if (!this._applies(rule, input)) continue;
      const ledgers = rule.match?.ledgers || [];
      if (ledgers.length === 0) {
        const context = this._context(input);
        this._mergeOutputs(result, rule.outputs || {}, context);
        result.traces.push({ ruleId: rule.id, ledger: null });
        continue;
      }
      for (const spec of ledgers) {
        const ledger = this._resolveLedger(spec, input);
        if (!ledger) continue;
        if (!this._conditionsPass(rule, input, ledger)) continue;
        const context = this._context(input, ledger);
        this._mergeOutputs(result, rule.outputs || {}, context);
        result.traces.push({
          ruleId: rule.id,
          ledger: {
            layer: ledger.layer,
            subjectId: ledger.subjectId,
            objectId: ledger.objectId || null,
            factionId: ledger.factionId || null,
            groupId: ledger.groupId || null,
          },
        });
      }
    }
    return result;
  }
}
