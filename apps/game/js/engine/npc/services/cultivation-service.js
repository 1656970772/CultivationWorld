import { getCultivationConfig } from '../actions/npc-action-utils.js';
import { readTraitSpeedMult } from '../npc-traits.js';
import { syncNumericCultivationFromRatios } from '../numeric-cultivation.js';

export function runCultivation(entity, worldContext, action = {}, opts = {}) {
  const extraSpeedMultiplier = opts.extraSpeedMultiplier ?? 1.0;
  const descriptionPrefix = opts.descriptionPrefix ?? '闭关修炼';
  const cult = getCultivationConfig(worldContext);
  const speedMap = cult.cultivationSpeed || {};
  const stoneMap = cult.spiritStoneCost || {};
  const qiMap = cult.qiBaseGain || {};
  const variance = cult.speedVariance || { min: 0.7, max: 1.3 };
  const companionBonus = cult.daoCompanionBonus || {};

  const rankId = entity.state.get('rankId') || 'mortal';
  const baseSpeed = speedMap[rankId] ?? 0.002;
  let speedMultiplier = (variance.min + worldContext.rng.next() * (variance.max - variance.min)) * extraSpeedMultiplier;

  const techniqueId = entity.state.get('techniqueId');
  let techniqueBreakthroughBonus = 0;
  let techniqueLifespanEffect = 0;
  if (techniqueId && worldContext.techniqueRegistry) {
    const technique = worldContext.techniqueRegistry.get(techniqueId);
    if (technique && technique.effects) {
      speedMultiplier *= technique.effects.cultivationSpeedMultiplier ?? 1.0;
      techniqueBreakthroughBonus = technique.effects.breakthroughBonus ?? 0;
      techniqueLifespanEffect = technique.effects.lifespanBonus ?? 0;
    }
  }

  speedMultiplier *= readTraitSpeedMult(entity);

  const days = Math.max(1, action?.duration ?? 1);
  const speed = baseSpeed * speedMultiplier;
  const progressGain = speed * days;

  const capMap = cult.cultivationCap || {};
  const cap = capMap[rankId] ?? 1.0;
  const decayK = cult.cultivationDecayK ?? 2.5;
  const current = entity.state.get('cultivationProgress') || 0;
  const decayFactor = Math.exp(-decayK * Math.min(1, current / Math.max(cap, 1e-6)));
  const effectiveGain = progressGain * decayFactor;
  const newProgress = Math.min(current + effectiveGain, cap);
  const qiPerProgressMap = cult.qiPerProgress || {};
  let progressQi = (qiPerProgressMap[rankId] ?? 0) * (newProgress - current);
  entity.state.set('cultivationProgress', newProgress);

  if (techniqueLifespanEffect !== 0) {
    const daysPerYear = 360;
    const lifeDelta = Math.round((techniqueLifespanEffect / 365) * daysPerYear * 0.01);
    if (lifeDelta !== 0) {
      const maxAgeDays = entity.state.get('maxAgeDays') || 1;
      const newMax = Math.max(1, maxAgeDays + lifeDelta);
      entity.state.set('maxAgeDays', newMax);
      const ageDays = entity.state.get('ageDays') || 0;
      entity.state.set('lifeRatio', ageDays / newMax);
    }
  }

  const stoneCost = (stoneMap[rankId] ?? 1) * days;
  const available = entity.inventory.getAmount('low_spirit_stone') || 0;
  const consumed = Math.min(stoneCost, available);
  if (consumed > 0) {
    entity.inventory.remove('low_spirit_stone', consumed);
  }

  const baseQi = (qiMap[rankId] ?? 0.5) * days;
  const stoneQi = consumed;
  let qiGain = baseQi + stoneQi + progressQi;

  const companionId = entity.state.get('daoCompanionId');
  let companionBonusApplied = false;
  if (companionId) {
    const companion = worldContext.entityRegistry?.getById(companionId);
    if (companion && companion.alive) {
      const qiMultiplier = companionBonus.qiMultiplier ?? 1.2;
      const progressBonus = companionBonus.progressBonus ?? 0.2;
      qiGain *= qiMultiplier;
      let dualBonus = progressBonus;
      if (techniqueId && worldContext.techniqueRegistry) {
        const technique = worldContext.techniqueRegistry.get(techniqueId);
        const dualEffect = technique?.effects?.specialEffects?.find(
          e => e.type === 'dual_cultivation_bonus',
        );
        if (dualEffect) dualBonus *= dualEffect.value;
      }
      const curWithBase = entity.state.get('cultivationProgress') || 0;
      const dualDecay = Math.exp(-decayK * Math.min(1, curWithBase / Math.max(cap, 1e-6)));
      const dualProgress = Math.min(curWithBase + speed * days * dualBonus * dualDecay, cap);
      qiGain += (qiPerProgressMap[rankId] ?? 0) * (dualProgress - curWithBase) * qiMultiplier;
      entity.state.set('cultivationProgress', dualProgress);
      companionBonusApplied = true;
    }
  }

  syncNumericCultivationFromRatios(entity, worldContext.ranksData || []);

  const currentQi = entity.state.get('qi') || 0;
  entity.state.set('qi', currentQi + qiGain);
  entity.state.set('techniqueBreakthroughBonus', techniqueBreakthroughBonus);

  return {
    success: true,
    progress: entity.state.get('cultivationProgress'),
    speed,
    qiGain,
    qi: currentQi + qiGain,
    stoneConsumed: consumed,
    techniqueId: techniqueId || null,
    techniqueBreakthroughBonus,
    companionBonusApplied,
    description: `${entity.staticData.name} ${descriptionPrefix}，消耗${consumed}灵石，真气+${qiGain.toFixed(1)}`,
  };
}

export function runTrainChamber(entity, worldContext, action = {}) {
  const cult = getCultivationConfig(worldContext);
  const chamberCfg = cult.actions?.trainChamber || {};
  const contributionCost = chamberCfg.contributionCost ?? 10;
  const speedBonus = chamberCfg.speedBonusMultiplier ?? 1.25;

  const contribution = entity.state.get('contribution') || 0;
  if (contribution < contributionCost) {
    return runCultivation(entity, worldContext, action);
  }

  entity.state.set('contribution', contribution - contributionCost);

  const result = runCultivation(entity, worldContext, action, {
    extraSpeedMultiplier: speedBonus,
    descriptionPrefix: `入修炼场加速修炼（消耗${contributionCost}贡献）`,
  });
  return {
    ...result,
    contributionSpent: contributionCost,
    speedBonusMultiplier: speedBonus,
  };
}

export function runHeal(entity) {
  const current = entity.state.get('injuryLevel') || 0;
  const next = Math.max(0, current - 1);
  entity.state.set('injuryLevel', next);
  return {
    success: true,
    injuryLevel: next,
    description: next > 0
      ? `${entity.staticData.name} 静心疗伤，伤势减轻（剩余 ${next}）`
      : `${entity.staticData.name} 伤势痊愈`,
  };
}
