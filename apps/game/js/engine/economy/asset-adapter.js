import { ResourceRegistry } from './resource-registry.js';

function asQuantity(value) {
  const quantity = Number(value ?? 0);
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, quantity);
}

function itemIdOf(asset) {
  return asset?.itemId || asset?.id || null;
}

function pointKeyOf(asset) {
  return asset?.pointKey || asset?.key || asset?.itemId || null;
}

function stateGet(entity, key) {
  return Number(entity?.state?.get?.(key) || 0);
}

function stateSet(entity, key, value) {
  entity?.state?.set?.(key, Math.max(0, Number(value) || 0));
}

export class AssetAdapter {
  constructor(config = {}) {
    this.hasExplicitResourceConfig = !!config.resourceRegistry || !!config.assets;
    this.resourceRegistry = config.resourceRegistry || ResourceRegistry.fromConfig(config);
  }

  normalize(asset = {}) {
    const kind = asset.kind || 'item';
    const quantity = asQuantity(asset.quantity ?? asset.amount);
    if (kind === 'organization_point') {
      return { kind, pointKey: pointKeyOf(asset), quantity };
    }
    if (kind === 'faction_state_resource') {
      return { kind, itemId: itemIdOf(asset), quantity };
    }
    return { kind: 'item', itemId: itemIdOf(asset), quantity };
  }

  isPrivatelyTransferable(asset) {
    return this.normalize(asset).kind !== 'organization_point';
  }

  amountOf(entity, asset) {
    const spec = this.normalize(asset);
    if (!entity) return 0;
    if (spec.kind === 'organization_point') return stateGet(entity, spec.pointKey);
    if (spec.kind === 'faction_state_resource') return stateGet(entity, spec.itemId);
    return Number(entity.inventory?.getAmount?.(spec.itemId) || 0);
  }

  canWithdraw(entity, asset) {
    const spec = this.normalize(asset);
    if (!entity) return false;
    if (spec.quantity === 0) return true;
    if (
      spec.kind === 'organization_point'
      && this.hasExplicitResourceConfig
      && !this.resourceRegistry.isOrganizationPoint(spec.pointKey)
    ) return false;
    if (
      spec.kind === 'faction_state_resource'
      && this.hasExplicitResourceConfig
      && !this.resourceRegistry.isFactionStateResource(spec.itemId)
    ) return false;
    if (spec.kind === 'item' && !spec.itemId) return false;
    return this.amountOf(entity, spec) >= spec.quantity;
  }

  withdraw(entity, asset, meta = {}) {
    const spec = this.normalize(asset);
    if (!this.canWithdraw(entity, spec)) {
      return { success: false, op: 'withdraw', entity, asset: spec, meta };
    }
    if (spec.kind === 'organization_point') {
      stateSet(entity, spec.pointKey, stateGet(entity, spec.pointKey) - spec.quantity);
    } else if (spec.kind === 'faction_state_resource') {
      stateSet(entity, spec.itemId, stateGet(entity, spec.itemId) - spec.quantity);
    } else if (spec.quantity > 0) {
      const removed = entity.inventory?.remove?.(spec.itemId, spec.quantity);
      if (removed === false) return { success: false, op: 'withdraw', entity, asset: spec, meta };
    }
    return { success: true, op: 'withdraw', entity, asset: spec, meta };
  }

  deposit(entity, asset, meta = {}) {
    const spec = this.normalize(asset);
    if (!entity) return { success: false, op: 'deposit', entity, asset: spec, meta };
    if (spec.kind === 'organization_point') {
      stateSet(entity, spec.pointKey, stateGet(entity, spec.pointKey) + spec.quantity);
    } else if (spec.kind === 'faction_state_resource') {
      stateSet(entity, spec.itemId, stateGet(entity, spec.itemId) + spec.quantity);
    } else if (spec.quantity > 0) {
      if (typeof entity.inventory?.add !== 'function') {
        return { success: false, op: 'deposit', entity, asset: spec, meta };
      }
      entity.inventory.add(spec.itemId, spec.quantity);
    }
    return { success: true, op: 'deposit', entity, asset: spec, meta };
  }

  rollback(delta) {
    if (!delta?.success) return false;
    if (delta.op === 'withdraw') return this.deposit(delta.entity, delta.asset, { rollbackOf: delta.meta });
    if (delta.op === 'deposit') return this.withdraw(delta.entity, delta.asset, { rollbackOf: delta.meta });
    return false;
  }
}
