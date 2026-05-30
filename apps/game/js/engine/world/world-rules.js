/**
 * WorldRules - 世界规则（作为行为执行器）
 *
 * 世界暂无需求系统，用规则引擎模式替代。
 * 每条规则 = 条件检查 + 执行逻辑。
 *
 * 修正器模板数据来自 data/world/modifiers.json（通过 worldContext.modifierTemplates 传入）。
 * 经济参数来自 data/balance/economy.json（通过 worldContext.balanceConfig.economy 传入）。
 */
import { ActionExecutor } from '../abstract/action.js';
import { ActionPool } from '../pools/action-pool.js';

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

export class ModifierSpawnExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const worldState = worldContext.worldState;
    if (!worldState) return { spawned: false };

    const activeModifiers = worldState.get('activeModifiers') || [];
    const maxActive = action.params?.maxActiveModifiers ?? 3;
    if (activeModifiers.length >= maxActive) return { spawned: false };

    const spawnChance = action.params?.spawnChance ?? 0.05;
    if (Math.random() > spawnChance) return { spawned: false };

    // 优先使用 worldContext 传入的修正器模板（来自 modifiers.json）
    const modifierTemplates = worldContext.modifierTemplates || [];
    if (modifierTemplates.length === 0) return { spawned: false };

    const activeIds = new Set(activeModifiers.map(m => m.id));
    const candidates = modifierTemplates.filter(t => !activeIds.has(t.id));
    if (candidates.length === 0) return { spawned: false };

    const template = candidates[Math.floor(Math.random() * candidates.length)];
    const modifier = {
      id: template.id,
      name: template.name,
      intensity: randRange(template.intensityMin ?? 0.5, template.intensityMax ?? 1.0),
      remainingDays: randInt(template.minDuration, template.maxDuration),
      effects: { ...template.effects },
      spawnDay: worldState.get('currentDay'),
    };

    worldState.addModifier(modifier);
    return {
      spawned: true,
      modifier: { id: modifier.id, name: modifier.name, remainingDays: modifier.remainingDays },
    };
  }
}

export class ModifierDecayExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const worldState = worldContext.worldState;
    if (!worldState) return { expired: [] };
    const result = worldState.tickModifiers();
    return {
      expired: result.expired.map(m => ({ id: m.id, name: m.name })),
      remaining: result.remaining.length,
    };
  }
}

export class NaturalDisasterExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const chance = action.params?.disasterChance ?? 0.02;
    if (Math.random() > chance) return { disaster: false };

    const registry = worldContext.entityRegistry;
    if (!registry) return { disaster: false };

    const factions = registry.getAliveByType('faction');
    if (factions.length === 0) return { disaster: false };

    const target = factions[Math.floor(Math.random() * factions.length)];
    const stabilityLoss = randInt(5, 15);
    const foodLoss = randInt(50, 200);

    const stability = target.state.get('stability') || 50;
    target.state.set('stability', Math.max(0, stability - stabilityLoss));
    target.inventory.remove('food', foodLoss);

    return {
      disaster: true,
      targetId: target.id,
      targetName: target.name,
      stabilityLoss,
      foodLoss,
    };
  }
}

export class ResourceRegenExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const registry = worldContext.entityRegistry;
    if (!registry) return {};

    const factions = registry.getAliveByType('faction');
    const results = [];

    // 从 balanceConfig 读取经济参数，降级回退到硬编码默认值保证向后兼容
    const eco = worldContext.balanceConfig?.economy || {};
    const regen = eco.resourceRegen || {};
    const stabCfg = eco.stability || {};
    const costs = eco.dailyCosts || {};
    const salaryCfg = eco.salary || {};
    const formationCfg = eco.formation || {};
    const veinOutput = eco.veinOutput || {};
    const modEffectsCfg = eco.modifierEffects || {};

    const foodPerTerritory = regen.foodPerTerritory ?? 2;
    const stonePerTerritory = regen.stonePerTerritory ?? 1;
    const disciplesPerDay = regen.disciplesPerDay ?? 1;
    const maxDisciplesBase = regen.maxDisciplesBase ?? 100;
    const maxDisciplesPerTerritory = regen.maxDisciplesPerTerritory ?? 30;

    const stabilityRecoveryMax = stabCfg.naturalRecoveryMax ?? 80;
    const stabilityRecoveryRate = stabCfg.naturalRecoveryRate ?? 1;
    const stabilityDecayThreshold = stabCfg.decayThreshold ?? 50;
    const stabilityDecayRate = stabCfg.decayRate ?? 0.5;
    const paymentShortfallPenalty = stabCfg.paymentShortfallPenalty ?? 5;

    const foodCostPerDisciple = costs.foodPerDisciple ?? 0.04;
    const foodCostPerTerritory = costs.foodPerTerritory ?? 0.5;
    const stoneCostPerDisciple = costs.stonePerDisciple ?? 0.02;
    const stoneCostPerTerritory = costs.stonePerTerritory ?? 0.5;
    const minDisciplesForFoodCost = costs.minDisciplesForFoodCost ?? 10;

    const paymentInterval = salaryCfg.paymentIntervalDays ?? 30;
    const roleSalary = salaryCfg.roles || {
      leader: 200, elder: 80, general: 50, officer: 50,
      heir: 60, core_disciple: 20, disciple: 5, wanderer: 0,
    };

    const formationBaseCost = formationCfg.baseCost ?? 100;
    const formationCostPerTerritory = formationCfg.costPerTerritory ?? 20;

    // 矿脉产出配置
    const VEIN_VALUES = {
      low_spirit_vein: veinOutput.low_spirit_vein ?? 2,
      mid_spirit_vein: veinOutput.mid_spirit_vein ?? 100,
      high_spirit_vein: veinOutput.high_spirit_vein ?? 500,
      top_spirit_vein: veinOutput.top_spirit_vein ?? 5000,
    };

    // modifier 效果倍率
    const evilAggressionStabilityGain = modEffectsCfg.evilAggressionStabilityGain ?? 2;
    const righteousDefenseStabilityGain = modEffectsCfg.righteousDefenseStabilityGain ?? 1;
    const allStabilityMultiplier = modEffectsCfg.allStabilityMultiplier ?? 10;

    // 收集活跃 modifier 效果
    const worldState = worldContext.worldState;
    const activeModifiers = worldState ? (worldState.get('activeModifiers') || []) : [];
    const modEffects = this._aggregateModifierEffects(activeModifiers);

    // 设置修炼加速标记供 NPC 使用
    if (modEffects.cultivation_speed > 0) {
      worldContext.cultivationSpeedBonus = modEffects.cultivation_speed;
    }

    for (const faction of factions) {
      const territoryCount = faction.state.get('territoryCount') || 1;
      const disciples = faction.inventory.getAmount('disciples') || 0;
      const factionType = faction.factionType || '';

      // === 领地产出 ===
      let foodRegen = Math.floor(territoryCount * foodPerTerritory);

      // modifier: food_production 影响粮食产出
      if (modEffects.food_production < 0) {
        foodRegen = Math.floor(foodRegen * (1 + modEffects.food_production));
      }

      faction.inventory.add('food', foodRegen);

      // 矿脉产出
      const factionVeinOutput = worldContext.factionVeinOutput;
      const stoneFromVeins = factionVeinOutput ? (factionVeinOutput.get(faction.id) || 0) : 0;
      const stoneRegen = Math.floor(territoryCount * stonePerTerritory) + stoneFromVeins;
      faction.inventory.add('low_spirit_stone', stoneRegen);

      // === 弟子自然增长 ===
      const maxDisciples = Math.max(maxDisciplesBase, territoryCount * maxDisciplesPerTerritory);
      if (disciples < maxDisciples) {
        faction.inventory.add('disciples', disciplesPerDay);
      }

      // === 稳定度自然恢复 ===
      let stability = faction.state.get('stability') || 50;
      if (stability < stabilityRecoveryMax) {
        stability = Math.min(stabilityRecoveryMax, stability + stabilityRecoveryRate);
      }

      // === 月俸 & 大阵维护（每月一次）===
      const currentDay = worldContext.currentDay || 0;
      if (currentDay > 0 && currentDay % paymentInterval === 0) {
        const registry2 = worldContext.entityRegistry;
        const factionNPCs = registry2.getAliveByType('npc').filter(n => n.state.get('factionId') === faction.id);
        let totalSalary = 0;
        for (const npc of factionNPCs) {
          const role = npc.state.get('currentRole') || 'disciple';
          const salary = roleSalary[role] ?? 5;
          npc.inventory.add('low_spirit_stone', salary);
          totalSalary += salary;
        }
        const formationCost = formationBaseCost + territoryCount * formationCostPerTerritory;
        totalSalary += formationCost;

        const curStone = faction.inventory.getAmount('low_spirit_stone');
        faction.inventory.remove('low_spirit_stone', Math.min(totalSalary, curStone));

        if (curStone < totalSalary) {
          const newStability = Math.max(0, (faction.state.get('stability') || 50) - paymentShortfallPenalty);
          faction.state.set('stability', newStability);
        }
      }

      // === 每日资源消耗 ===
      const foodCost = disciples > minDisciplesForFoodCost
        ? Math.floor(disciples * foodCostPerDisciple + territoryCount * foodCostPerTerritory)
        : 0;
      const stoneCost = Math.floor(disciples * stoneCostPerDisciple + territoryCount * stoneCostPerTerritory);

      const currentFood = faction.inventory.getAmount('food');
      faction.inventory.remove('food', Math.min(foodCost, currentFood));

      const currentStone = faction.inventory.getAmount('low_spirit_stone');
      faction.inventory.remove('low_spirit_stone', Math.min(stoneCost, currentStone));

      // 稳定度自然衰减：高于阈值时趋向均衡
      if (stability > stabilityDecayThreshold) {
        stability = Math.max(stabilityDecayThreshold, stability - stabilityDecayRate);
      }

      // === Modifier 效果 ===
      if (modEffects.evil_aggression > 0 && factionType === 'evil') {
        stability = Math.min(100, stability + evilAggressionStabilityGain);
      }
      if (modEffects.righteous_defense > 0 && factionType === 'righteous') {
        stability = Math.min(100, stability + righteousDefenseStabilityGain);
      }
      if (modEffects.disciple_loss < 0 && disciples >= 20) {
        const loss = Math.floor(disciples * Math.abs(modEffects.disciple_loss));
        if (loss > 0) {
          const curDisciples = faction.inventory.getAmount('disciples');
          faction.inventory.remove('disciples', Math.min(loss, curDisciples));
        }
      }
      if (modEffects.all_stability < 0) {
        stability = Math.max(0, stability + modEffects.all_stability * allStabilityMultiplier);
      }

      faction.state.set('stability', stability);

      results.push({
        factionId: faction.id,
        foodRegen,
        stoneRegen,
        foodCost,
        stoneCost,
      });
    }

    return { regenResults: results };
  }

  /**
   * 汇总所有活跃 modifier 的效果值（按 intensity 加权）
   */
  _aggregateModifierEffects(modifiers) {
    const agg = {};
    for (const mod of modifiers) {
      if (!mod.effects) continue;
      const intensity = mod.intensity || 1;
      for (const [key, value] of Object.entries(mod.effects)) {
        agg[key] = (agg[key] || 0) + value * intensity;
      }
    }
    return agg;
  }
}

/**
 * 注册世界规则执行器
 */
export function registerWorldRuleExecutors() {
  ActionPool.registerExecutor('world_modifier_spawn', new ModifierSpawnExecutor());
  ActionPool.registerExecutor('world_modifier_decay', new ModifierDecayExecutor());
  ActionPool.registerExecutor('world_natural_disaster', new NaturalDisasterExecutor());
  ActionPool.registerExecutor('world_resource_regen', new ResourceRegenExecutor());
}
