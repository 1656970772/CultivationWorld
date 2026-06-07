import { AssetAdapter } from './asset-adapter.js';
import { PriceService } from './price-service.js';
import { SettlementService } from './settlement-service.js';
import { TransactionLedger } from './transaction-ledger.js';
import { EscrowService } from './escrow-service.js';
import { DebtService } from './debt-service.js';
import { EconomicSignalProvider } from './economic-signal-provider.js';

export class EconomicSystem {
  constructor({ config = {} } = {}) {
    this.config = config || {};
    this.assetAdapter = new AssetAdapter(this.config);
    this.price = new PriceService(this.config);
    this.ledger = new TransactionLedger();
    this.settlement = new SettlementService({ assetAdapter: this.assetAdapter });
    this.escrow = new EscrowService({ assetAdapter: this.assetAdapter, ledger: this.ledger });
    this.debts = new DebtService({ ledger: this.ledger, config: this.config });
    this.signals = new EconomicSignalProvider({
      assetAdapter: this.assetAdapter,
      priceService: this.price,
      escrowService: this.escrow,
      debtService: this.debts,
    });
  }

  quote(input = {}) {
    return this.price.quoteAsset(input.asset, input.scenarioId, input.privateAdjustment ?? 1);
  }

  _appendRecord(input = {}, result = {}) {
    return this.ledger.append({
      type: input.type || 'transaction',
      status: result.success ? 'settled' : 'failed',
      day: input.day ?? 0,
      parties: (input.parties || []).map(p => ({
        role: p.role,
        entityId: p.entity?.id || p.entityId || null,
      })),
      assets: (input.transfers || []).map(t => ({ from: t.from, to: t.to, asset: t.asset })),
      visibility: input.visibility || this.config?.scenarios?.[input.scenarioId]?.visibility || 'system',
      source: input.source || null,
      reason: result.reason || null,
    });
  }

  _validateScenarioTransfers(input = {}) {
    const scenario = this.config?.scenarios?.[input.scenarioId] || {};
    if (scenario.kind !== 'private') return { success: true };

    const forbidden = new Set(this.config?.assets?.privateForbiddenKinds || []);
    for (const transfer of input.transfers || []) {
      const spec = this.assetAdapter.normalize(transfer.asset);
      if (forbidden.has(spec.kind) || !this.assetAdapter.isPrivatelyTransferable(spec)) {
        return {
          success: false,
          reason: 'private_asset_forbidden',
          failedTransfer: transfer,
          deltas: [],
        };
      }
    }
    return { success: true };
  }

  settle(input = {}) {
    const validation = this._validateScenarioTransfers(input);
    if (!validation.success) {
      const record = this._appendRecord(input, validation);
      return { ...validation, transactionId: record.id, record };
    }

    const result = this.settlement.settle(input);
    const record = this._appendRecord(input, result);
    return { ...result, transactionId: record.id, record };
  }

  openEscrow(input = {}) {
    return this.escrow.open(input);
  }

  settleEscrow(input = {}) {
    const entry = this.escrow.byId(input.escrowId);
    return this.escrow.settle({
      ...input,
      holder: input.holder || input.escrowHolder || null,
      source: input.source || entry?.source || null,
    });
  }

  createDebt(input = {}) {
    return this.debts.create(input);
  }

  advanceDay(day) {
    this.debts.advanceDay(day);
  }

  signalsFor(input = {}) {
    return this.signals.signalsFor(input);
  }

  snapshot() {
    return {
      ledger: this.ledger.snapshot(),
      debts: [...this.debts.records.values()],
      escrows: [...this.escrow.entries.values()],
    };
  }
}
