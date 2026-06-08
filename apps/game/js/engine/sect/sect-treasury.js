function quantityOf(value) {
  const quantity = Math.floor(Number(value) || 0);
  return Math.max(0, quantity);
}

function stateAmount(entity, key) {
  return Number(entity?.state?.get?.(key) || 0);
}

function setStateAmount(entity, key, value) {
  entity?.state?.set?.(key, Math.max(0, Number(value) || 0));
}

function stateHolder(id) {
  const values = new Map();
  return {
    id,
    state: {
      get(key) {
        return values.get(key) || 0;
      },
      set(key, value) {
        values.set(key, Math.max(0, Number(value) || 0));
      },
    },
  };
}

function itemHolder(id, itemId, quantity) {
  let amount = quantityOf(quantity);
  return {
    id,
    inventory: {
      getAmount(id_) {
        return id_ === itemId ? amount : 0;
      },
      remove(id_, quantity_) {
        const q = quantityOf(quantity_);
        if (id_ !== itemId || amount < q) return false;
        amount -= q;
        return true;
      },
      add(id_, quantity_) {
        if (id_ === itemId) amount += quantityOf(quantity_);
      },
    },
  };
}

export class SectTreasury {
  constructor({ economicSystem = null, config = {} } = {}) {
    this.economicSystem = economicSystem;
    this.config = config || {};
  }

  settle({ day = 0, scenarioId, type = scenarioId, from, to, asset, source = null, visibility = 'institution' } = {}) {
    if (!this.economicSystem) return { success: false, reason: 'economic_system_missing' };
    if (!scenarioId) return { success: false, reason: 'scenario_missing' };
    const normalized = { ...(asset || {}), quantity: quantityOf(asset?.quantity ?? asset?.amount) };
    if (normalized.quantity <= 0) {
      return { success: true, skipped: true, reason: 'zero_quantity', quantity: 0 };
    }
    return this.economicSystem.settle({
      day,
      scenarioId,
      type: type || scenarioId,
      parties: [
        { role: 'payer', entity: from },
        { role: 'receiver', entity: to },
      ],
      transfers: [
        { from: 'payer', to: 'receiver', asset: normalized },
      ],
      source,
      visibility,
    });
  }

  transferFactionStonesToNpc({ day = 0, faction, npc, quantity, source = null } = {}) {
    if (!this.economicSystem) return { success: false, reason: 'economic_system_missing' };
    if (!this.config.stipendScenarioId) return { success: false, reason: 'scenario_missing' };
    if (!this.config.stoneResourceId) return { success: false, reason: 'stone_resource_missing' };
    const normalizedQuantity = quantityOf(quantity);
    if (normalizedQuantity <= 0) {
      return { success: true, skipped: true, reason: 'zero_quantity', quantity: 0 };
    }
    const stoneResourceId = this.config.stoneResourceId;
    return this.economicSystem.settle({
      day,
      scenarioId: this.config.stipendScenarioId,
      type: this.config.stipendScenarioId,
      parties: [
        { role: 'payer', entity: faction },
        { role: 'receiver', entity: npc },
        { role: 'conversion_sink', entity: stateHolder(`${faction?.id || 'faction'}:sect_stipend_sink:${npc?.id || 'npc'}`) },
        { role: 'conversion_source', entity: itemHolder(`${faction?.id || 'faction'}:sect_stipend_source:${npc?.id || 'npc'}`, stoneResourceId, normalizedQuantity) },
      ],
      transfers: [
        {
          from: 'payer',
          to: 'conversion_sink',
          asset: { kind: 'faction_state_resource', itemId: stoneResourceId, quantity: normalizedQuantity },
        },
        {
          from: 'conversion_source',
          to: 'receiver',
          asset: { kind: 'item', itemId: stoneResourceId, quantity: normalizedQuantity },
        },
      ],
      source,
      visibility: 'institution',
    });
  }

  transferFactionItemToNpc({ day = 0, faction, npc, itemId, quantity, source = null } = {}) {
    return this.settle({
      day,
      scenarioId: this.config.pillScenarioId,
      from: faction,
      to: npc,
      asset: { kind: 'item', itemId, quantity },
      source,
    });
  }

  payBountyFeeToFaction({ day = 0, faction, issuer, feeItemId, quantity = 0, source = null } = {}) {
    const feeQuantity = quantityOf(quantity);
    const result = this.settle({
      day,
      scenarioId: this.config.bountyFeeScenarioId,
      from: issuer,
      to: faction,
      asset: { kind: 'item', itemId: feeItemId, quantity: feeQuantity },
      source,
    });
    if (!result.success || feeQuantity <= 0) return result;

    const stoneResourceId = this.config.stoneResourceId;
    if (stoneResourceId && feeItemId === stoneResourceId) {
      const received = faction?.inventory?.getAmount?.(feeItemId) || 0;
      const converted = Math.min(received, feeQuantity);
      if (converted > 0 && faction?.inventory?.remove?.(feeItemId, converted) !== false) {
        setStateAmount(faction, stoneResourceId, stateAmount(faction, stoneResourceId) + converted);
      }
    }
    return result;
  }
}
