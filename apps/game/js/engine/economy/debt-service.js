export class DebtService {
  constructor({ ledger, config = {} }) {
    this.ledger = ledger;
    this.config = config;
    this.records = new Map();
    this.nextId = 1;
  }

  create({
    day = 0,
    debtorId,
    creditorId,
    origin = null,
    dueDay = null,
    assetsDue = [],
    guarantorIds = [],
    collateralRefs = [],
    visibility = 'personal',
  } = {}) {
    const id = `debt_${this.nextId++}`;
    const record = {
      id,
      debtorId,
      creditorId,
      origin,
      day,
      dueDay: dueDay ?? (day + (this.config?.debt?.defaultDueDays ?? 30)),
      assetsDue: assetsDue.map(asset => ({ ...asset })),
      guarantorIds: [...guarantorIds],
      collateralRefs: [...collateralRefs],
      status: 'active',
      visibility,
    };
    this.records.set(id, record);
    this.ledger.append({
      type: 'debt_created',
      status: 'settled',
      day,
      parties: [
        { role: 'debtor', entityId: debtorId },
        { role: 'creditor', entityId: creditorId },
      ],
      assets: assetsDue,
      debtRefs: [id],
      visibility,
      source: origin,
    });
    return record;
  }

  byId(id) {
    return this.records.get(id) || null;
  }

  forEntity(entityId) {
    return [...this.records.values()].filter(record =>
      record.debtorId === entityId || record.creditorId === entityId,
    );
  }

  advanceDay(day) {
    for (const record of this.records.values()) {
      if (record.status === 'active' && day > record.dueDay) {
        record.status = 'overdue';
      }
    }
  }
}
