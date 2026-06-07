export class SettlementService {
  constructor({ assetAdapter }) {
    this.assetAdapter = assetAdapter;
  }

  settle({ parties = [], transfers = [], type = 'transaction', source = null } = {}) {
    const roleMap = new Map(parties.map(p => [p.role, p.entity]));
    const deltas = [];

    for (const transfer of transfers) {
      const from = typeof transfer.from === 'string' ? roleMap.get(transfer.from) : transfer.from;
      const to = typeof transfer.to === 'string' ? roleMap.get(transfer.to) : transfer.to;
      const asset = transfer.asset;

      const out = this.assetAdapter.withdraw(from, asset, { type, source, transfer });
      if (!out.success) {
        for (let i = deltas.length - 1; i >= 0; i--) this.assetAdapter.rollback(deltas[i]);
        return { success: false, reason: 'asset_unavailable', failedTransfer: transfer, deltas: [] };
      }
      deltas.push(out);

      const incoming = this.assetAdapter.deposit(to, asset, { type, source, transfer });
      if (!incoming.success) {
        for (let i = deltas.length - 1; i >= 0; i--) this.assetAdapter.rollback(deltas[i]);
        return { success: false, reason: 'asset_deposit_failed', failedTransfer: transfer, deltas: [] };
      }
      deltas.push(incoming);
    }

    return { success: true, deltas };
  }
}
