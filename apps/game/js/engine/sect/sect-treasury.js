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
    return this.settle({
      day,
      scenarioId: this.config.stipendScenarioId,
      from: faction,
      to: npc,
      asset: {
        kind: 'faction_state_resource',
        itemId: this.config.stoneResourceId,
        quantity,
      },
      source,
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
