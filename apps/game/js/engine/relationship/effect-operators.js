export class EffectOperatorRegistry {
  constructor({ repository, evaluator, selectorResolver } = {}) {
    this.repository = repository;
    this.evaluator = evaluator;
    this.selectorResolver = selectorResolver;
  }

  _applyToRef(effect, ref, baseContext = {}) {
    const ledger = this.repository.getLedger(ref);
    if (!ledger) return null;
    const context = { ...baseContext, ledger };
    const changes = effect.changes || {};

    for (const [path, op] of Object.entries(changes)) {
      if (path === 'marks' || path === 'tags' || path === 'consumeMarks') continue;
      const delta = this.evaluator.evaluate(op?.delta ?? op, context);
      if (path.startsWith('core.')) this.repository.applyCoreDelta({ ...ref, day: baseContext.event?.day }, path, delta);
      if (path.startsWith('potential.')) this.repository.applyPotentialDelta({ ...ref, day: baseContext.event?.day }, path, delta);
    }

    for (const mark of changes.marks || []) {
      this.repository.addMark({
        ...ref,
        type: mark.type,
        weight: this.evaluator.evaluate(mark.weight ?? mark.defaultWeight, context),
        source: { eventId: baseContext.event?.id || null, ruleId: baseContext.ruleId || null },
        visibility: baseContext.event?.visibility || 'private',
        day: baseContext.event?.day || 0,
      });
    }

    for (const tag of changes.tags || []) {
      this.repository.addTag({
        ...ref,
        type: tag.type,
        source: { eventId: baseContext.event?.id || null, ruleId: baseContext.ruleId || null },
        visibility: baseContext.event?.visibility || 'private',
        day: baseContext.event?.day || 0,
      });
    }

    for (const mark of changes.consumeMarks || []) {
      this.repository.consumeMarks({ ...ref, type: mark.type, day: baseContext.event?.day || 0 });
    }

    return ledger;
  }

  apply(effect, baseContext = {}) {
    const refs = typeof this.selectorResolver.resolveLedgerRefs === 'function'
      ? this.selectorResolver.resolveLedgerRefs(effect, baseContext)
      : [this.selectorResolver.resolveLedgerRef(effect, baseContext)];
    const ledgers = [];
    for (const ref of refs) {
      const ledger = this._applyToRef(effect, ref, baseContext);
      if (ledger) ledgers.push(ledger);
    }
    return ledgers;
  }
}
