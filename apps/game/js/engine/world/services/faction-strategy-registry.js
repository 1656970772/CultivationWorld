function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function includesOrEmpty(list, value) {
  const values = asArray(list);
  return values.length === 0 || values.includes(value);
}

function stateNumber(entity, key, fallback = 0) {
  const value = entity?.state?.get?.(key) ?? entity?.inventory?.getAmount?.(key) ?? fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class FactionStrategyRegistry {
  constructor(config = {}) {
    this.config = config || {};
    this.diplomacy = this.config.diplomacy || {};
    this.military = this.config.military || {};
    this.trade = this.config.trade || {};
    this.transactionScenarios = this.config.transactionScenarios || this.config.economicTransactionConfig || {};
    this.factionTrade = this.transactionScenarios.factionTrade || this.trade.factionTrade || {};
    this.alliance = this.config.alliance || {};
    this.attack = this.config.attack || {};
    this.cohesion = this.config.cohesion || {};
  }

  isHostileRelation(relation) {
    return Number(relation ?? 0) <= Number(this.diplomacy.hostileThreshold ?? -50);
  }

  isHostileFaction({ relation = 0, selfType = '', targetType = '' } = {}) {
    if (this.isHostileRelation(relation)) return true;
    const matrix = this.diplomacy.hostileMatrix || this.diplomacy.hostilityMatrix || [];
    for (const rule of matrix) {
      const limit = Number(rule.relationLte ?? rule.maxRelation ?? this.diplomacy.alignmentHostileThreshold ?? 0);
      if (Number(relation) > limit) continue;
      if (!includesOrEmpty(rule.selfTypes ?? rule.fromTypes, selfType)) continue;
      if (!includesOrEmpty(rule.targetTypes ?? rule.toTypes, targetType)) continue;
      return true;
    }
    return false;
  }

  isWeakEnemy(enemy) {
    const stability = stateNumber(enemy, 'stability', 50);
    const disciples = stateNumber(enemy, 'disciples', 0);
    return stability < Number(this.diplomacy.weakEnemyStabilityThreshold ?? 30)
      || disciples < Number(this.diplomacy.weakEnemyDisciplesThreshold ?? 50);
  }

  militaryPower(snapshot = {}) {
    const disciples = Number(snapshot.disciples ?? 0);
    const territoryCount = Number(snapshot.territoryCount ?? 0);
    const stability = Number(snapshot.stability ?? 0);
    return disciples * Number(this.military.disciplesWeight ?? 1.0)
      + territoryCount * Number(this.military.territoryWeight ?? 10)
      + stability * Number(this.military.stabilityWeight ?? 0.5);
  }

  selectAttackTarget({ relations = {}, selfType = '', getFaction, isClose }) {
    let targetId = null;
    let worstRelation = Infinity;
    for (const [factionId, relation] of Object.entries(relations)) {
      const enemy = getFaction?.(factionId);
      if (!enemy || enemy.alive === false) continue;
      const relationValue = Number(relation ?? 0);
      if (!this.isHostileFaction({
        relation: relationValue,
        selfType,
        targetType: enemy.factionType || '',
      })) continue;
      if (typeof isClose === 'function' && !isClose(factionId)) continue;
      if (relationValue >= worstRelation) continue;
      worstRelation = relationValue;
      targetId = factionId;
    }
    return targetId;
  }

  selectAllianceCandidate(relations = {}, getFaction) {
    const min = Number(this.alliance.minRelation ?? 20);
    const max = Number(this.alliance.maxRelation ?? 60);
    let bestId = null;
    let bestRelation = min;
    for (const [factionId, relation] of Object.entries(relations || {})) {
      if (relation <= bestRelation || relation >= max) continue;
      const candidate = getFaction?.(factionId);
      if (candidate && candidate.alive !== false) {
        bestRelation = relation;
        bestId = factionId;
      }
    }
    return bestId;
  }

  selectTradePartner({ selfId, factions = [], relations = {} }) {
    const min = Number(this.trade.minRelation ?? 20);
    let bestPartner = null;
    let bestRelation = min;
    for (const faction of factions) {
      if (!faction || faction.alive === false || faction.id === selfId) continue;
      const relation = Number(relations[faction.id] || 0);
      if (relation > bestRelation) {
        bestRelation = relation;
        bestPartner = faction;
      }
    }
    return bestPartner;
  }

  tradeResources() {
    const cfg = this.factionTrade || {};
    const payResourceId = cfg.payResourceId || this.trade.payResourceId || null;
    const receiveResourceId = cfg.receiveResourceId || this.trade.receiveResourceId || null;
    if (!payResourceId || !receiveResourceId) return null;
    return {
      scenarioId: cfg.scenarioId || this.trade.scenarioId || 'formal_market',
      payResourceId,
      receiveResourceId,
      payResourceKind: cfg.payResourceKind || this.trade.payResourceKind || 'faction_state_resource',
      receiveResourceKind: cfg.receiveResourceKind || this.trade.receiveResourceKind || 'faction_state_resource',
    };
  }

  tradePlan({ payerResource = 0, partnerResource = 0 }) {
    const planConfig = this.factionTrade || {};
    const payRatio = Number(planConfig.payRatio ?? this.trade.payRatio ?? 0.1);
    const payMax = Number(planConfig.maxPayAmount ?? this.trade.maxPayAmount ?? 200);
    const receiveRate = Number(planConfig.receiveExchangeRate ?? this.trade.receiveExchangeRate ?? 2);
    const payAmount = Math.min(Math.floor(Number(payerResource || 0) * payRatio), payMax);
    const requested = payAmount * receiveRate;
    const receiveAmount = Math.min(requested, Number(partnerResource || 0));
    return { payAmount, receiveAmount };
  }

  isCrisis({ defenderStability, powerRatio, aliveCount }) {
    const cfg = this.cohesion || {};
    return Number(defenderStability) <= Number(cfg.crisisStabilityThreshold ?? 35)
      || Number(powerRatio) >= Number(cfg.crisisPowerRatio ?? 1.5)
      || Number(aliveCount) <= Number(cfg.crisisAliveNpcThreshold ?? 6);
  }

  shouldSurrender({ leaderAlive, defenderStability, powerRatio }) {
    const surrender = this.cohesion?.surrender || {};
    if (!surrender.enabled) return false;
    return (surrender.leaderDeadTriggers && !leaderAlive)
      || Number(defenderStability) <= Number(surrender.stabilityThreshold ?? 12)
      || Number(powerRatio) >= Number(surrender.powerRatio ?? 3.0);
  }

  trait(npc, name, inv = false) {
    const personality = npc?.staticData?.personality || npc?.staticData?.get?.('personality') || {};
    const value = typeof personality[name] === 'number' ? personality[name] : 50;
    return inv ? (100 - value) : value;
  }

  traitFactor(npc, name, range, inv = false) {
    if (!Array.isArray(range)) return 1;
    const trait = this.trait(npc, name, inv);
    const [lo, hi] = range;
    return Number(lo) + (trait / 100) * (Number(hi) - Number(lo));
  }

  chooseCrisisReaction(npc, ctx = {}, rng = null) {
    const reactions = this.cohesion?.reactions || {};
    const weights = {};
    for (const [key, cfg] of Object.entries(reactions)) {
      if (cfg.requireStrongerEnemy && !ctx.hasStrongerEnemy) {
        weights[key] = 0;
        continue;
      }
      let weight = Number(cfg.base ?? 1);
      if (cfg.loyalty) weight *= this.traitFactor(npc, 'loyalty', cfg.loyalty);
      if (cfg.loyaltyInv) weight *= this.traitFactor(npc, 'loyalty', cfg.loyaltyInv, true);
      if (cfg.courage) weight *= this.traitFactor(npc, 'courage', cfg.courage);
      if (cfg.courageInv) weight *= this.traitFactor(npc, 'courage', cfg.courageInv, true);
      if (cfg.caution) weight *= this.traitFactor(npc, 'caution', cfg.caution);
      if (cfg.ambition) weight *= this.traitFactor(npc, 'ambition', cfg.ambition);
      if (cfg.ambitionInv) weight *= this.traitFactor(npc, 'ambition', cfg.ambitionInv, true);
      if (cfg.cautionExtreme) {
        const caution = this.trait(npc, 'caution') / 100;
        const [lo, hi] = cfg.cautionExtreme;
        weight *= Number(lo) + (caution * caution) * (Number(hi) - Number(lo));
      }
      if (key === 'fight' && ctx.isCore && cfg.coreMult) weight *= Number(cfg.coreMult);
      weights[key] = Math.max(0, weight);
    }

    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return 'fight';
    const next = typeof rng?.next === 'function' ? rng.next() : Math.random();
    let roll = next * total;
    for (const [key, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return key;
    }
    return 'fight';
  }
}
