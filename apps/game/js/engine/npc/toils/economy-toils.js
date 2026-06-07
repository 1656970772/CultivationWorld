import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import { redeemExchangeItem, useQiPill } from '../npc-economy.js';

function paramsOf(toil) {
  return toil?.params || {};
}

function inventoryOf(entity) {
  const inventory = entity?.inventory;
  if (!inventory || typeof inventory.getAmount !== 'function') return null;
  return inventory;
}

function stateOf(entity) {
  const state = entity?.state;
  if (!state || typeof state.get !== 'function' || typeof state.set !== 'function') return null;
  return state;
}

function amountOf(inventory, itemId) {
  return Number(inventory.getAmount(itemId) || 0);
}

function addItem(inventory, itemId, amount) {
  if (typeof inventory.add !== 'function') return false;
  inventory.add(itemId, amount);
  return true;
}

function removeItem(inventory, itemId, amount) {
  if (typeof inventory.remove !== 'function') return false;
  const result = inventory.remove(itemId, amount);
  return result !== false;
}

function hasItem(inventory, itemId, amount) {
  if (typeof inventory.has === 'function') return inventory.has(itemId, amount);
  return amountOf(inventory, itemId) >= amount;
}

function missingInventory() {
  return { status: ToilResultStatus.FAILED, reason: 'inventory_missing' };
}

function invalidPurchase() {
  return { status: ToilResultStatus.BLOCKED, reason: 'invalid_purchase_params' };
}

function invalidCurrency() {
  return { status: ToilResultStatus.BLOCKED, reason: 'invalid_currency_params' };
}

function invalidExchange() {
  return { status: ToilResultStatus.BLOCKED, reason: 'invalid_exchange_params' };
}

function readAmount(value, { fallback, allowZero = false } = {}) {
  if (value == null) {
    if (fallback == null) return null;
    return fallback;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount < 0 || (!allowZero && amount === 0)) return null;
  return amount;
}

function currencyParams(params) {
  const rawAmount = params.priceAmount ?? params.amount;
  if (rawAmount == null) return null;
  const amount = readAmount(rawAmount, { allowZero: true });
  if (amount == null) return null;
  return {
    itemId: params.priceItemId || params.currencyItemId || 'low_spirit_stone',
    amount,
  };
}

function validatePurchaseParams(params, invalidResult = invalidPurchase()) {
  const itemId = params.itemId;
  const amount = readAmount(params.amount ?? params.minAmount);
  const priceItemId = params.priceItemId || params.currencyItemId;
  const priceAmount = readAmount(params.priceAmount, { allowZero: true });

  if (!itemId || amount == null || !priceItemId || priceAmount == null) {
    return { ok: false, result: invalidResult };
  }
  return { ok: true, itemId, amount, priceItemId, priceAmount };
}

function buyItem(entity, worldContext, params, successReason, invalidResult = invalidPurchase()) {
  const inventory = inventoryOf(entity);
  if (!inventory) return missingInventory();
  const purchase = validatePurchaseParams(params, invalidResult);
  if (!purchase.ok) return purchase.result;
  const { itemId, amount, priceItemId, priceAmount } = purchase;

  if (typeof inventory.add !== 'function') {
    return { status: ToilResultStatus.FAILED, reason: 'inventory_add_failed' };
  }
  if (typeof inventory.remove !== 'function') {
    return { status: ToilResultStatus.FAILED, reason: 'inventory_remove_failed' };
  }

  if (worldContext?.settleTransaction) {
    const vendor = {
      id: params.vendorId || 'org_market',
      name: params.vendorName || '坊市',
      inventory: {
        getAmount(id) { return id === itemId ? Number.MAX_SAFE_INTEGER : 0; },
        remove() { return true; },
        add() {},
      },
      state: { get() { return 0; }, set() {} },
    };
    const result = worldContext.settleTransaction({
      type: 'direct_purchase',
      scenarioId: 'formal_market',
      parties: [{ role: 'buyer', entity }, { role: 'seller', entity: vendor }],
      transfers: [
        { from: 'buyer', to: 'seller', asset: { kind: 'item', itemId: priceItemId, quantity: priceAmount } },
        { from: 'seller', to: 'buyer', asset: { kind: 'item', itemId, quantity: amount } },
      ],
      source: { type: 'toil_buy_item', itemId },
      visibility: 'institution',
    });
    return result.success
      ? { status: ToilResultStatus.SUCCESS, reason: successReason, contextPatch: { transactionId: result.transactionId } }
      : { status: ToilResultStatus.FAILED, reason: result.reason || 'transaction_failed', contextPatch: { transactionId: result.transactionId } };
  }

  if (amountOf(inventory, priceItemId) < priceAmount) {
    return { status: ToilResultStatus.FAILED, reason: 'insufficient_currency' };
  }
  if (priceAmount > 0 && !removeItem(inventory, priceItemId, priceAmount)) {
    return { status: ToilResultStatus.FAILED, reason: 'insufficient_currency' };
  }
  if (!addItem(inventory, itemId, amount)) {
    return { status: ToilResultStatus.FAILED, reason: 'inventory_add_failed' };
  }
  return { status: ToilResultStatus.SUCCESS, reason: successReason };
}

function ensureItem(entity, params, defaultItemId = null, worldContext = null) {
  const inventory = inventoryOf(entity);
  if (!inventory) return missingInventory();

  const itemId = params.itemId || defaultItemId;
  const minAmount = readAmount(params.minAmount, { fallback: 1 });
  if (!itemId || minAmount == null) {
    return { status: ToilResultStatus.BLOCKED, reason: 'invalid_item_params' };
  }

  const current = amountOf(inventory, itemId);
  if (current >= minAmount) {
    return { status: ToilResultStatus.SUCCESS, reason: 'item_already_available' };
  }

  if (!params.priceItemId || params.priceAmount == null) {
    return { status: ToilResultStatus.BLOCKED, reason: 'item_missing' };
  }

  return buyItem(entity, worldContext, { ...params, itemId, amount: minAmount - current }, 'item_purchased');
}

export class NPCCheckInventoryItemToilExecutor extends ToilExecutor {
  run(entity, _worldContext, _job, toil) {
    const inventory = inventoryOf(entity);
    if (!inventory) return missingInventory();

    const params = paramsOf(toil);
    const itemId = params.itemId;
    const minAmount = readAmount(params.minAmount, { fallback: 1 });
    if (!itemId || minAmount == null) return { status: ToilResultStatus.BLOCKED, reason: 'invalid_item_params' };

    if (hasItem(inventory, itemId, minAmount)) {
      return { status: ToilResultStatus.SUCCESS, reason: 'inventory_item_available' };
    }
    return { status: ToilResultStatus.BLOCKED, reason: 'item_missing' };
  }
}

export class NPCEnsureItemToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    return ensureItem(entity, paramsOf(toil), null, worldContext);
  }
}

export class NPCCheckCurrencyToilExecutor extends ToilExecutor {
  run(entity, _worldContext, _job, toil) {
    const inventory = inventoryOf(entity);
    if (!inventory) return missingInventory();

    const currency = currencyParams(paramsOf(toil));
    if (!currency) return invalidCurrency();
    if (amountOf(inventory, currency.itemId) >= currency.amount) {
      return { status: ToilResultStatus.SUCCESS, reason: 'currency_available' };
    }
    return { status: ToilResultStatus.FAILED, reason: 'insufficient_currency' };
  }
}

export class NPCBuyItemToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    return buyItem(entity, worldContext, paramsOf(toil), 'item_purchased');
  }
}

export class NPCExchangeFactionItemToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    const inventory = inventoryOf(entity);
    if (!inventory) return missingInventory();

    const params = paramsOf(toil);
    const purchase = validatePurchaseParams(params, invalidExchange());
    if (!purchase.ok) return purchase.result;
    const { itemId, amount, priceItemId, priceAmount } = purchase;

    const contributionCost = readAmount(params.contributionCost, { fallback: 0, allowZero: true });
    if (contributionCost == null) return invalidExchange();
    const state = contributionCost > 0 ? stateOf(entity) : null;
    if (contributionCost > 0) {
      if (!state) return { status: ToilResultStatus.FAILED, reason: 'state_missing' };
      if (Number(state.get('contribution') || 0) < contributionCost) {
        return { status: ToilResultStatus.FAILED, reason: 'insufficient_contribution' };
      }
    }

    if (typeof inventory.add !== 'function') {
      return { status: ToilResultStatus.FAILED, reason: 'inventory_add_failed' };
    }
    if (typeof inventory.remove !== 'function') {
      return { status: ToilResultStatus.FAILED, reason: 'inventory_remove_failed' };
    }

    if (worldContext?.settleTransaction) {
      const vendor = {
        id: params.vendorId || 'org_faction_exchange',
        name: params.vendorName || '宗门库房',
        inventory: {
          getAmount(id) { return id === itemId ? Number.MAX_SAFE_INTEGER : 0; },
          remove() { return true; },
          add() {},
        },
        state: { get() { return 0; }, set() {} },
      };
      const transfers = [];
      if (priceAmount > 0) {
        transfers.push({ from: 'buyer', to: 'seller', asset: { kind: 'item', itemId: priceItemId, quantity: priceAmount } });
      }
      if (contributionCost > 0) {
        transfers.push({ from: 'buyer', to: 'seller', asset: { kind: 'organization_point', pointKey: 'contribution', quantity: contributionCost } });
      }
      transfers.push({ from: 'seller', to: 'buyer', asset: { kind: 'item', itemId, quantity: amount } });

      const transaction = worldContext.settleTransaction({
        type: 'contribution_exchange',
        scenarioId: 'faction_exchange',
        parties: [{ role: 'buyer', entity }, { role: 'seller', entity: vendor }],
        transfers,
        source: { type: 'toil_exchange_faction_item', itemId },
        visibility: 'institution',
      });
      return transaction.success
        ? { status: ToilResultStatus.SUCCESS, reason: 'faction_exchange_completed', contextPatch: { transactionId: transaction.transactionId } }
        : { status: ToilResultStatus.FAILED, reason: transaction.reason || 'transaction_failed', contextPatch: { transactionId: transaction.transactionId } };
    }

    return { status: ToilResultStatus.FAILED, reason: 'economic_system_missing' };
  }
}

export class NPCRedeemQiPillToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const result = redeemExchangeItem(entity, worldContext, 'qi_pill');
    return result.success
      ? { status: ToilResultStatus.SUCCESS, reason: 'qi_pill_redeemed', contextPatch: result }
      : { status: ToilResultStatus.FAILED, reason: result.outcome || 'qi_pill_redeem_failed', contextPatch: result };
  }
}

export class NPCUseQiPillToilExecutor extends ToilExecutor {
  run(entity, worldContext) {
    const result = useQiPill(entity, worldContext);
    return result.success
      ? { status: ToilResultStatus.SUCCESS, reason: 'qi_pill_used', contextPatch: result }
      : { status: ToilResultStatus.FAILED, reason: result.outcome || 'qi_pill_use_failed', contextPatch: result };
  }
}

export class NPCEnsureArtifactToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    return ensureItem(entity, paramsOf(toil), 'artifact_green_sword', worldContext);
  }
}

export class NPCCheckEquippedArtifactToilExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    const state = stateOf(entity);
    if (!state) return { status: ToilResultStatus.FAILED, reason: 'state_missing' };

    const itemId = paramsOf(toil).itemId || job?.context?.artifactId;
    if (!itemId) {
      return { status: ToilResultStatus.BLOCKED, reason: 'invalid_artifact_params' };
    }
    if (state.get('equippedArtifactId') === itemId) {
      return { status: ToilResultStatus.SUCCESS, reason: 'artifact_equipped' };
    }
    return { status: ToilResultStatus.BLOCKED, reason: 'artifact_not_equipped' };
  }
}

export class NPCEquipArtifactToilExecutor extends ToilExecutor {
  run(entity, _worldContext, job, toil) {
    const inventory = inventoryOf(entity);
    if (!inventory) return missingInventory();
    const state = stateOf(entity);
    if (!state) return { status: ToilResultStatus.FAILED, reason: 'state_missing' };

    const itemId = paramsOf(toil).itemId || job?.context?.artifactId || 'artifact_green_sword';
    if (!hasItem(inventory, itemId, 1)) {
      return { status: ToilResultStatus.FAILED, reason: 'artifact_missing' };
    }

    state.set('equippedArtifactId', itemId);
    entity.refreshArtifactCombatModifiers?.();
    return { status: ToilResultStatus.SUCCESS, reason: 'artifact_equipped' };
  }
}
