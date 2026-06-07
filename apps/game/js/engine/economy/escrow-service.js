export class EscrowService {
  constructor({ assetAdapter, ledger }) {
    this.assetAdapter = assetAdapter;
    this.ledger = ledger;
    this.entries = new Map();
    this.holders = new Map();
    this.nextId = 1;
  }

  open({ day = 0, purpose = 'escrow', sourceEntity, escrowHolder, nominalOwnerId, assets = [], source = null } = {}) {
    const deltas = [];
    const escrowId = `escrow_${this.nextId++}`;

    for (const asset of assets) {
      const out = this.assetAdapter.withdraw(sourceEntity, asset, { purpose, escrowId, source });
      if (!out.success) {
        for (let i = deltas.length - 1; i >= 0; i--) this.assetAdapter.rollback(deltas[i]);
        return { success: false, reason: 'escrow_asset_unavailable', escrowId: null };
      }
      deltas.push(out);

      const incoming = this.assetAdapter.deposit(escrowHolder, asset, { purpose, escrowId, source });
      if (!incoming.success) {
        for (let i = deltas.length - 1; i >= 0; i--) this.assetAdapter.rollback(deltas[i]);
        return { success: false, reason: 'escrow_deposit_failed', escrowId: null };
      }
      deltas.push(incoming);
    }

    const entry = {
      id: escrowId,
      day,
      purpose,
      itemizedAssets: assets.map(asset => ({ ...asset })),
      nominalOwnerId,
      sourceEntityId: sourceEntity?.id || null,
      escrowHolderId: escrowHolder?.id || null,
      status: 'locked',
      source,
    };
    this.entries.set(escrowId, entry);
    this.holders.set(escrowId, escrowHolder);
    this.ledger.append({
      type: 'escrow_lock',
      status: 'settled',
      day,
      parties: [
        { role: 'source', entityId: sourceEntity?.id || null },
        { role: 'escrow_holder', entityId: escrowHolder?.id || null },
      ],
      assets,
      escrowRefs: [escrowId],
      visibility: 'institution',
      source,
    });
    return { success: true, escrowId, entry };
  }

  settle({ day = 0, escrowId, holder, destination, status = 'released', source = null } = {}) {
    const entry = this.entries.get(escrowId);
    const effectiveHolder = holder || this.holders.get(escrowId);
    if (!entry || entry.status !== 'locked') return { success: false, reason: 'escrow_not_locked' };
    const deltas = [];

    for (const asset of entry.itemizedAssets) {
      const out = this.assetAdapter.withdraw(effectiveHolder, asset, { escrowId, source });
      if (!out.success) {
        for (let i = deltas.length - 1; i >= 0; i--) this.assetAdapter.rollback(deltas[i]);
        return { success: false, reason: 'escrow_holder_asset_missing' };
      }
      deltas.push(out);

      const incoming = this.assetAdapter.deposit(destination, asset, { escrowId, source });
      if (!incoming.success) {
        for (let i = deltas.length - 1; i >= 0; i--) this.assetAdapter.rollback(deltas[i]);
        return { success: false, reason: 'escrow_destination_failed' };
      }
      deltas.push(incoming);
    }

    entry.status = status;
    entry.closedDay = day;
    this.ledger.append({
      type: status === 'forfeited' ? 'escrow_forfeit' : 'escrow_release',
      status: 'settled',
      day,
      parties: [
        { role: 'escrow_holder', entityId: effectiveHolder?.id || entry.escrowHolderId },
        { role: 'destination', entityId: destination?.id || null },
      ],
      assets: entry.itemizedAssets,
      escrowRefs: [escrowId],
      visibility: 'institution',
      source,
    });
    return { success: true, escrowId, entry };
  }

  byId(id) {
    return this.entries.get(id) || null;
  }

  pendingFor(entityId) {
    return [...this.entries.values()].filter(entry =>
      entry.status === 'locked'
      && (entry.nominalOwnerId === entityId || entry.sourceEntityId === entityId || entry.escrowHolderId === entityId),
    );
  }
}
