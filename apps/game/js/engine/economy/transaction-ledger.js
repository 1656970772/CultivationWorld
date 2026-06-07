export class TransactionLedger {
  constructor() {
    this.records = [];
    this.nextId = 1;
  }

  append(input = {}) {
    const record = {
      id: input.id || `tx_${this.nextId++}`,
      type: input.type || 'transaction',
      status: input.status || 'pending',
      day: input.day ?? 0,
      parties: input.parties || [],
      assets: input.assets || [],
      escrowRefs: input.escrowRefs || [],
      debtRefs: input.debtRefs || [],
      visibility: input.visibility || 'system',
      source: input.source || null,
      evidence: input.evidence || [],
      reason: input.reason || null,
    };
    this.records.push(record);
    return record;
  }

  all() {
    return [...this.records];
  }

  byId(id) {
    return this.records.find(record => record.id === id) || null;
  }

  visibleTo(viewerId, scope = 'system') {
    if (scope === 'system') return this.all();
    return this.records.filter(record => {
      if (record.visibility === 'public') return true;
      if (record.visibility === 'institution') {
        return record.parties.some(p => p.entityId === viewerId || p.role === 'institution');
      }
      if (record.visibility === 'personal') {
        return record.parties.some(p => p.entityId === viewerId);
      }
      return false;
    });
  }

  snapshot() {
    return { nextId: this.nextId, records: this.all() };
  }

  loadFrom(data = {}) {
    this.nextId = Number(data.nextId || 1);
    this.records = Array.isArray(data.records) ? data.records.map(record => ({ ...record })) : [];
  }
}
