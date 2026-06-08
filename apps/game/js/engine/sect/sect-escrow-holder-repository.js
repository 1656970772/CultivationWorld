import { Inventory } from '../abstract/inventory.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createState(initial = {}) {
  const values = { ...(initial || {}) };
  return {
    get(key) {
      return values[key];
    },
    set(key, value) {
      values[key] = value;
    },
    snapshot() {
      return { ...values };
    },
  };
}

function inventorySnapshot(inventory) {
  if (typeof inventory?.toJSON === 'function') return inventory.toJSON();
  if (typeof inventory?.snapshot === 'function') return inventory.snapshot();
  if (typeof inventory?.getAll === 'function') return inventory.getAll();
  return {};
}

export class SectEscrowHolderRepository {
  constructor({ snapshot = [], holderType = 'sect_bounty_vault' } = {}) {
    if (!holderType) throw new Error('SectEscrowHolderRepository requires holderType');
    this.holderType = holderType;
    this.holders = new Map();
    for (const entry of Array.isArray(snapshot) ? snapshot : []) this.restore(entry);
  }

  holderIdFor({ factionId = 'global', holderType = this.holderType } = {}) {
    return `${holderType}_${factionId || 'global'}`;
  }

  holderFor({ factionId = 'global', holderType = this.holderType } = {}) {
    const id = this.holderIdFor({ factionId, holderType });
    if (!this.holders.has(id)) {
      this.holders.set(id, {
        id,
        type: holderType,
        factionId: factionId || null,
        name: `${holderType}:${factionId || 'global'}`,
        inventory: new Inventory(),
        state: createState(),
      });
    }
    return this.holders.get(id);
  }

  byId(id) {
    return this.holders.get(id) || null;
  }

  restore(entry = {}) {
    const holder = this.holderFor({
      factionId: entry.factionId || 'global',
      holderType: entry.type || entry.holderType || this.holderType,
    });
    if (typeof holder.inventory?.loadFrom === 'function') {
      holder.inventory.loadFrom(entry.inventory || {});
    }
    holder.state = createState(entry.state || {});
    return holder;
  }

  snapshot() {
    return [...this.holders.values()].map(holder => ({
      id: holder.id,
      type: holder.type,
      factionId: holder.factionId,
      name: holder.name,
      inventory: clone(inventorySnapshot(holder.inventory)),
      state: clone(holder.state?.snapshot?.() || {}),
    }));
  }
}
