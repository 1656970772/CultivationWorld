import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import { runCultivation, runHeal, runTrainChamber } from '../services/cultivation-service.js';
import {
  getCultivationConfig,
  settleRisk,
  weightedPickFrom,
} from '../actions/npc-action-utils.js';
import { addExperienceCultivation } from '../numeric-cultivation.js';

export class NPCCultivateToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    const params = toil?.params || {};
    const result = runCultivation(entity, worldContext, { duration: params.duration ?? 30 });
    return { status: ToilResultStatus.SUCCESS, reason: 'cultivated', contextPatch: result };
  }
}

export class NPCTrainChamberToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    const params = toil?.params || {};
    const result = runTrainChamber(entity, worldContext, { duration: params.duration ?? 30 });
    return { status: ToilResultStatus.SUCCESS, reason: 'trained_chamber', contextPatch: result };
  }
}

export class NPCHealToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    const result = runHeal(entity, worldContext, toil?.params || {});
    return { status: ToilResultStatus.SUCCESS, reason: 'healed', contextPatch: result };
  }
}

export class NPCExploreToilExecutor extends ToilExecutor {
  run(entity, worldContext, _job, toil) {
    const cult = getCultivationConfig(worldContext);
    const exploreCfg = cult.actions?.explore || {};
    const experienceMin = exploreCfg.experienceCultivationMin ?? 1;
    const experienceMax = exploreCfg.experienceCultivationMax ?? 3;
    const qiMin = exploreCfg.fortuneQiMin ?? 5;
    const qiMax = exploreCfg.fortuneQiMax ?? 20;
    const events = exploreCfg.fortuneEvents || [];
    const event = weightedPickFrom(events, worldContext.rng)
      || { id: 'normal', name: '游历归来', experienceCultivationMultiplier: 1.0, qiMultiplier: 1.0 };

    const baseExperience = experienceMin + worldContext.rng.next() * (experienceMax - experienceMin);
    const experienceCultivationGain = Number((baseExperience * (event.experienceCultivationMultiplier ?? 1.0)).toFixed(4));
    const totalCultivation = addExperienceCultivation(
      entity,
      worldContext?.ranksData || entity?._ranksData || [],
      experienceCultivationGain,
      cult,
    );

    const baseQi = qiMin + Math.floor(worldContext.rng.next() * (qiMax - qiMin + 1));
    const qiGain = Math.round(baseQi * (event.qiMultiplier ?? 1.0));
    if (qiGain > 0) entity.state.set('qi', (entity.state.get('qi') || 0) + qiGain);

    const risk = settleRisk(entity, worldContext, 'explore');

    if (risk.died) {
      return {
        status: ToilResultStatus.FAILED,
        reason: 'explore_death',
        contextPatch: { fortuneEvent: event.id, riskTriggered: risk.triggered, experienceCultivationGain, totalCultivation },
      };
    }

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'explored',
      contextPatch: {
        success: true,
        fortuneEvent: event.id,
        fortuneEventName: event.name,
        experienceCultivationGain,
        totalCultivation,
        qiGain,
        riskTriggered: risk.triggered,
        description: `${entity.staticData?.name || entity.name || entity.id} 游历归来：${event.name}，历练修为+${experienceCultivationGain.toFixed(3)}、真气+${qiGain}`,
      },
    };
  }
}
