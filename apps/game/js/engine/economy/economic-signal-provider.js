export class EconomicSignalProvider {
  constructor({ assetAdapter, priceService, escrowService, debtService }) {
    this.assetAdapter = assetAdapter;
    this.priceService = priceService;
    this.escrowService = escrowService;
    this.debtService = debtService;
  }

  signalsFor({ actor, target = null, asset = null, scenarioId = 'formal_market' } = {}) {
    const estimatedPrice = asset ? this.priceService.quoteAsset(asset, scenarioId) : 0;
    const currencyAsset = { kind: 'item', itemId: 'low_spirit_stone', quantity: estimatedPrice };
    const debts = actor?.id ? this.debtService.forEntity(actor.id) : [];
    const pendingEscrow = actor?.id ? this.escrowService.pendingFor(actor.id) : [];
    return {
      facts: {
        canAfford: actor ? this.assetAdapter.canWithdraw(actor, currencyAsset) : false,
        canEscrow: actor ? this.assetAdapter.canWithdraw(actor, currencyAsset) : false,
        estimatedPrice,
        hasOverdueDebt: debts.some(debt => debt.debtorId === actor?.id && debt.status === 'overdue'),
        hasEscrowPending: pendingEscrow.length > 0,
        targetId: target?.id || null,
      },
      gates: {
        privateTransferAllowed: asset ? this.assetAdapter.isPrivatelyTransferable(asset) : true,
      },
      modifiers: {},
      traces: [],
    };
  }
}
