import { SectTreasury } from './sect-treasury.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function rankOrderOf(rankId, ranksData = []) {
  const rank = ranksData.find(entry => entry?.id === rankId);
  return Number(rank?.order || 0);
}

function normalizeRewardAssets(assets = []) {
  return asList(assets)
    .map(asset => ({
      ...asset,
      quantity: Math.max(0, Math.floor(Number(asset?.quantity ?? asset?.amount) || 0)),
    }))
    .filter(asset => asset.quantity > 0);
}

function availableState(state) {
  return state === 'available' || state === 'open';
}

export class SectBountyService {
  constructor({ config = {}, treasuryConfig = {}, ranksData = [], economicSystem = null, questBoard = null, escrowHolders = null } = {}) {
    if (!config || !treasuryConfig || !Array.isArray(ranksData) || !escrowHolders) {
      throw new Error('SectBountyService requires config, treasuryConfig, ranksData and escrowHolders');
    }
    this.config = config;
    this.ranksData = ranksData;
    this.economicSystem = economicSystem;
    this.questBoard = questBoard;
    this.escrowHolders = escrowHolders;
    this.treasury = new SectTreasury({ economicSystem, config: treasuryConfig });
  }

  rankOrderOf(entity) {
    return rankOrderOf(entity?.state?.get?.('rankId'), this.ranksData);
  }

  canPublish(issuer) {
    return this.rankOrderOf(issuer) >= Number(this.config.minRankOrder || 0);
  }

  vaultFor(factionId) {
    return this.escrowHolders.holderFor({
      factionId,
      holderType: this.config.escrowHolderType,
    });
  }

  _validateBountyInput({ faction, issuer, questTemplateId, rewardAssets }) {
    if (!faction || !issuer || !this.questBoard || !this.economicSystem) {
      return { success: false, reason: 'bounty_context_missing' };
    }
    if (!this.canPublish(issuer)) return { success: false, reason: 'rank_too_low' };

    const allowedTemplates = asList(this.config.allowedQuestTemplateIds);
    if (allowedTemplates.length > 0 && !allowedTemplates.includes(questTemplateId)) {
      return { success: false, reason: 'quest_template_not_allowed' };
    }

    const allowedRewardKinds = new Set(asList(this.config.allowedRewardKinds));
    if (allowedRewardKinds.size > 0) {
      for (const asset of rewardAssets) {
        const kind = asset.kind || 'item';
        if (!allowedRewardKinds.has(kind)) {
          return { success: false, reason: 'reward_kind_not_allowed', kind };
        }
      }
    }
    if (rewardAssets.length === 0) return { success: false, reason: 'reward_assets_missing' };
    return { success: true };
  }

  createPersonalBounty({ day = 0, faction, issuer, questTemplateId, difficulty = null, rewardAssets = [], metadata = {}, dedupeKey = null } = {}) {
    const assets = normalizeRewardAssets(rewardAssets);
    const validation = this._validateBountyInput({ faction, issuer, questTemplateId, rewardAssets: assets });
    if (!validation.success) return validation;

    const fee = this.treasury.payBountyFeeToFaction({
      day,
      faction,
      issuer,
      feeItemId: this.config.feeItemId,
      quantity: this.config.feeAmount,
      source: { type: 'personal_bounty_fee', issuerId: issuer.id, factionId: faction.id },
    });
    if (!fee.success) return { ...fee, phase: 'bounty_fee' };

    const vault = this.vaultFor(faction.id);
    const escrow = this.economicSystem.openEscrow({
      day,
      purpose: this.config.rewardScenarioId || 'personal_bounty_reward',
      sourceEntity: issuer,
      escrowHolder: vault,
      nominalOwnerId: issuer.id,
      assets,
      source: {
        type: 'personal_bounty_reward',
        issuerId: issuer.id,
        factionId: faction.id,
        questTemplateId,
      },
    });
    if (!escrow.success) return { ...escrow, phase: 'bounty_reward_escrow' };

    const quest = this.questBoard.publish({
      day,
      factionId: faction.id,
      issuerType: 'npc',
      issuerId: issuer.id,
      issuerNpcId: issuer.id,
      issuerName: issuer.name || issuer.id,
      questBoard: this.config.defaultQuestBoard || 'bounty',
      questKind: 'personal_bounty',
      questTemplateId,
      difficulty: difficulty ?? this.config.defaultDifficulty ?? 1,
      priority: this.config.defaultPriority ?? 0,
      rewardAssets: assets,
      escrowId: escrow.escrowId,
      escrowRefs: [escrow.escrowId],
      dedupeKey,
      metadata: {
        ...clone(metadata),
        rewardAssets: assets,
        rewardScenarioId: this.config.rewardScenarioId || 'personal_bounty_reward',
      },
    });

    if (!quest?.id) {
      this.economicSystem.settleEscrow({
        day,
        escrowId: escrow.escrowId,
        holder: vault,
        destination: issuer,
        status: 'refunded',
        source: { type: 'personal_bounty_publish_failed', reason: quest?.reason || 'quest_publish_failed' },
      });
      return { success: false, reason: quest?.reason || 'quest_publish_failed', escrowId: escrow.escrowId, quest };
    }

    return {
      success: true,
      questId: quest.id,
      escrowId: escrow.escrowId,
      quest,
      feeTransactionId: fee.transactionId || null,
      escrow,
    };
  }

  _activateQuestIfNeeded(questId, quest, completer, day) {
    if (availableState(quest.state)) {
      const accepted = this.questBoard.accept(questId, completer, day);
      if (!accepted.success) return accepted;
      return { success: true, quest: accepted.quest };
    }
    return { success: true, quest };
  }

  completePersonalBounty({ day = 0, questId, completer } = {}) {
    if (!this.questBoard || !this.economicSystem) {
      return { success: false, reason: 'bounty_context_missing' };
    }
    const quest = this.questBoard.byId(questId);
    if (!quest || quest.questKind !== 'personal_bounty') {
      return { success: false, reason: 'bounty_missing' };
    }
    if (!completer) return { success: false, reason: 'completer_missing' };

    const active = this._activateQuestIfNeeded(questId, quest, completer, day);
    if (!active.success) return active;

    const vault = this.vaultFor(quest.factionId);
    const release = this.economicSystem.settleEscrow({
      day,
      escrowId: quest.escrowId,
      holder: vault,
      destination: completer,
      status: 'released',
      source: { type: 'personal_bounty_complete', questId, completerId: completer.id || null },
    });
    if (!release.success) return { ...release, phase: 'bounty_reward_release' };

    const completed = this.questBoard.complete(questId, completer, day);
    if (!completed.success) return completed;
    return {
      success: true,
      questId,
      escrowId: quest.escrowId,
      quest: completed.quest,
      release,
    };
  }

  cancelPersonalBounty({ day = 0, questId, issuer = null } = {}) {
    if (!this.questBoard || !this.economicSystem) {
      return { success: false, reason: 'bounty_context_missing' };
    }
    const quest = this.questBoard.byId(questId);
    if (!quest || quest.questKind !== 'personal_bounty') {
      return { success: false, reason: 'bounty_missing' };
    }
    if (!issuer) return { success: false, reason: 'issuer_missing' };

    const vault = this.vaultFor(quest.factionId);
    const refund = this.economicSystem.settleEscrow({
      day,
      escrowId: quest.escrowId,
      holder: vault,
      destination: issuer,
      status: 'refunded',
      source: { type: 'personal_bounty_cancel', questId, issuerId: issuer.id || null },
    });
    if (!refund.success) return { ...refund, phase: 'bounty_reward_refund' };

    const expired = this.questBoard.cancel(questId, day, 'cancelled');
    if (!expired.success) return expired;
    return {
      success: true,
      questId,
      escrowId: quest.escrowId,
      quest: expired.quest,
      refund,
    };
  }
}
