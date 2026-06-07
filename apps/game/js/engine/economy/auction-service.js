import { ItemRegistry } from '../items/item-registry.js';

function amount(entity, itemId) {
  return Number(entity?.inventory?.getAmount?.(itemId) || 0);
}

function pickBidder(participants, price, rng) {
  const affordable = participants.filter(entity => amount(entity, 'low_spirit_stone') >= price);
  if (affordable.length === 0) return null;
  affordable.sort((a, b) => amount(b, 'low_spirit_stone') - amount(a, 'low_spirit_stone'));
  const top = affordable.slice(0, Math.min(3, affordable.length));
  const idx = Math.floor((rng?.next?.() ?? 0) * top.length);
  return top[Math.max(0, Math.min(top.length - 1, idx))];
}

export class AuctionService {
  constructor({ economicSystem, config = {} }) {
    this.economicSystem = economicSystem;
    this.config = config || {};
  }

  lotName(lot) {
    return ItemRegistry.get(lot.itemId)?.name || lot.itemId;
  }

  resolveAbstractAuction({ day = 0, event, auctionHouse, lots = [], participants = [], rng = null } = {}) {
    const cfg = this.config?.auction?.abstractBid || {};
    const configuredExposureThreshold = cfg.wealthExposureThreshold ?? 300;
    const results = [];
    const wealthExposureEvents = [];

    for (const lot of lots) {
      const fallbackQuote = this.economicSystem.quote({
        asset: { kind: 'item', itemId: lot.itemId, quantity: lot.quantity || 1 },
        scenarioId: 'auction',
      });
      const base = Number(lot.reservePrice ?? fallbackQuote) || 0;
      const min = cfg.winnerMultiplierMin ?? 1.05;
      const max = cfg.winnerMultiplierMax ?? 1.65;
      const price = Math.max(1, Math.round(base * (min + (rng?.next?.() ?? 0.5) * (max - min))));
      const winner = pickBidder(participants, price, rng);

      if (!winner) {
        results.push({ itemId: lot.itemId, quantity: lot.quantity || 1, status: 'unsold', price: 0, winnerId: null });
        this.economicSystem.ledger.append({
          type: 'auction_unsold',
          status: 'settled',
          day,
          parties: [{ role: 'auction_house', entityId: auctionHouse?.id || null }],
          assets: [{ kind: 'item', itemId: lot.itemId, quantity: lot.quantity || 1 }],
          visibility: 'public',
          source: { type: 'auction', id: event?.id || null },
        });
        continue;
      }

      const tx = this.economicSystem.settle({
        type: 'auction_sale',
        scenarioId: 'auction',
        day,
        parties: [{ role: 'buyer', entity: winner }, { role: 'seller', entity: auctionHouse }],
        transfers: [
          { from: 'buyer', to: 'seller', asset: { kind: 'item', itemId: 'low_spirit_stone', quantity: price } },
          { from: 'seller', to: 'buyer', asset: { kind: 'item', itemId: lot.itemId, quantity: lot.quantity || 1 } },
        ],
        visibility: 'public',
        source: { type: 'auction', id: event?.id || null, lotName: this.lotName(lot) },
      });
      const status = tx.success ? 'sold' : 'failed';
      results.push({
        itemId: lot.itemId,
        quantity: lot.quantity || 1,
        status,
        price,
        winnerId: winner.id,
        transactionId: tx.transactionId,
      });
      const exposureThreshold = Math.min(configuredExposureThreshold, Math.max(1, base));
      if (tx.success && price >= exposureThreshold) {
        wealthExposureEvents.push({
          type: 'wealth_exposure',
          day,
          eventId: event?.id || null,
          npcId: winner.id,
          value: price,
          description: `${winner.name || winner.id} 在${event?.name || '拍卖会'}高价拍下${this.lotName(lot)}，财富外露`,
        });
      }
    }

    return { success: true, eventId: event?.id || null, lots: results, wealthExposureEvents };
  }
}
