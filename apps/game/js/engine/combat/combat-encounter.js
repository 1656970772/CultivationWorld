export function resolveCombatEncounter(input = {}) {
  const scene = input.scene || 'generic';
  const power = Math.max(0, Number(input.power) || 0);
  const defense = Math.max(0, Math.min(0.95, Number(input.defense) || 0));
  const damage = resolveDamage(scene, power, defense, input);
  const winChance = computeWinChance(scene, input);

  return {
    scene,
    hit: true,
    damage,
    winChance,
    died: false,
    injuryGain: damage > 0 ? 1 : 0,
    retreatSuggested: shouldSuggestRetreat(scene, input, damage),
    deathInfo: null,
    experienceContext: {
      sourceKind: input.sourceKind || scene,
      value: Number(input.value) || 0,
      riskScore: Number(input.riskScore) || 0,
      outcome: input.outcome || 'success',
    },
  };
}

function resolveDamage(scene, power, defense, input) {
  const random = typeof input.random === 'function' ? input.random : Math.random;
  if (scene === 'monster_ambush') {
    const roll = 0.8 + random() * 0.4;
    const multiplier = sceneDamageMultiplier(scene, input.worldContext);
    return Math.max(1, power * (1 - defense) * roll * multiplier);
  }
  if (scene === 'monster_counter') {
    const randomBonus = Math.max(0, Number(input.randomBonus ?? 10) || 0);
    const multiplier = sceneDamageMultiplier(scene, input.worldContext);
    return Math.max(1, (power + random() * randomBonus) * (1 - defense) * multiplier);
  }
  if (scene === 'pvp') {
    const multiplier = sceneDamageMultiplier(scene, input.worldContext);
    return Math.max(1, power * (1 - defense) * multiplier);
  }
  if (scene === 'quest_risk') {
    const maxHp = Number(input.maxHp ?? input.defender?.state?.get?.('maxHp') ?? 0) || 0;
    const min = Number(input.dmgRatioMin ?? 0.3);
    const max = Number(input.dmgRatioMax ?? 0.6);
    const ratio = min + random() * (max - min);
    return Math.max(1, maxHp * ratio);
  }
  return null;
}

function sceneDamageMultiplier(scene, worldContext) {
  if (scene === 'monster_ambush') {
    const configured = worldContext?.balanceConfig?.monsterSpawn?.combat?.damageMultiplier
      ?? worldContext?.monsterSpawn?.combat?.damageMultiplier;
    const multiplier = Number(configured);
    return Number.isFinite(multiplier) ? multiplier : 1;
  }
  const configured = worldContext?.balanceConfig?.combat?.encounterScenes?.[scene]?.damageMultiplier;
  const multiplier = Number(configured);
  return Number.isFinite(multiplier) ? multiplier : 1;
}

function computeWinChance(scene, input) {
  if (scene !== 'monster_hunt_quest' && scene !== 'pvp' && scene !== 'quest_risk') return null;
  const attackPower = Math.max(0.01, Number(input.power) || 0.01);
  const defensePower = Math.max(0.01, Number(input.defenderPower ?? input.monsterPower) || 0.01);
  return Math.max(0.02, Math.min(0.98, attackPower / (attackPower + defensePower)));
}

function shouldSuggestRetreat(scene, input, damage) {
  if (scene !== 'monster_ambush' && scene !== 'monster_hunt_quest') return false;
  if (!(damage > 0)) return false;
  const maxHp = Number(input.defender?.state?.get?.('maxHp') ?? input.defenderMaxHp ?? 0);
  return maxHp > 0 && damage >= maxHp * 0.4;
}
