import { ItemRegistry } from '../items/item-registry.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class PriceService {
  constructor(config = {}) {
    this.config = config || {};
  }

  scenario(scenarioId = 'formal_market') {
    return this.config?.scenarios?.[scenarioId]
      || this.config?.scenarios?.formal_market
      || {};
  }

  itemValue(itemId) {
    const def = ItemRegistry.get(itemId);
    const value = Number(def?.properties?.value ?? def?.value ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  assetValue(asset = {}) {
    const quantity = Math.max(0, Number(asset.quantity ?? asset.amount ?? 1) || 0);
    if (asset.kind === 'organization_point') return 0;
    return this.itemValue(asset.itemId) * quantity;
  }

  quoteAsset(asset, scenarioId = 'formal_market', privateAdjustment = 1) {
    const scenario = this.scenario(scenarioId);
    const multiplier = Number(scenario.priceMultiplier ?? 1) || 1;
    return Math.max(0, Math.round(this.assetValue(asset) * multiplier * privateAdjustment));
  }

  privateAdjustment({ relationship = 0, urgency = 0, informationAdvantage = 0, rng = null } = {}) {
    const variance = this.scenario('private_trade').privateVariance || { min: 0.75, max: 1.45 };
    const random = typeof rng?.next === 'function' ? rng.next() : 0.5;
    const spread = variance.min + random * (variance.max - variance.min);
    const social = 1 - clamp(relationship, -100, 100) / 400;
    const urgent = 1 + clamp(urgency, 0, 100) / 250;
    const info = 1 + clamp(informationAdvantage, -100, 100) / 300;
    return clamp(spread * social * urgent * info, 0.5, 2.5);
  }
}
