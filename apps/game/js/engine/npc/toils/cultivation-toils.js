import { ToilExecutor, ToilResultStatus } from '../../abstract/toil.js';
import { runCultivation, runHeal, runTrainChamber } from '../services/cultivation-service.js';
import {
  getCultivationConfig,
  settleRisk,
  weightedPickFrom,
} from '../actions/npc-action-utils.js';
import { applyCultivationExperience } from '../cultivation-experience.js';

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
    const insightMin = exploreCfg.insightMin ?? 0.01;
    const insightMax = exploreCfg.insightMax ?? 0.03;
    const qiMin = exploreCfg.fortuneQiMin ?? 5;
    const qiMax = exploreCfg.fortuneQiMax ?? 20;
    const events = exploreCfg.fortuneEvents || [];
    const event = weightedPickFrom(events, worldContext.rng)
      || { id: 'normal', name: '游历归来', insightMultiplier: 1.0, qiMultiplier: 1.0 };

    const baseInsight = insightMin + worldContext.rng.next() * (insightMax - insightMin);
    const insightGain = baseInsight * (event.insightMultiplier ?? 1.0);
    const currentInsight = entity.state.get('insight') || 0;
    const minCultivationRatio = cult.minCultivationRatio ?? 0.3;
    const insightCap = 1 - minCultivationRatio;
    const newInsight = Math.min(currentInsight + insightGain, insightCap);
    const appliedInsightGain = newInsight - currentInsight;
    entity.state.set('insight', newInsight);

    const baseQi = qiMin + Math.floor(worldContext.rng.next() * (qiMax - qiMin + 1));
    const qiGain = Math.round(baseQi * (event.qiMultiplier ?? 1.0));
    if (qiGain > 0) entity.state.set('qi', (entity.state.get('qi') || 0) + qiGain);

    const risk = settleRisk(entity, worldContext, 'explore');
    const cultivationExperience = applyCultivationExperience(entity, worldContext, {
      sourceKind: 'explore',
      value: toil?.params?.value ?? 500,
      riskScore: risk.totalRiskPct ?? 1,
      durationDays: toil?.params?.duration ?? 1,
      outcome: risk.died ? 'failure' : 'success',
    });

    if (risk.died) {
      return {
        status: ToilResultStatus.FAILED,
        reason: 'explore_death',
        contextPatch: { fortuneEvent: event.id, riskTriggered: risk.triggered, cultivationExperience },
      };
    }

    return {
      status: ToilResultStatus.SUCCESS,
      reason: 'explored',
      contextPatch: {
        success: true,
        fortuneEvent: event.id,
        fortuneEventName: event.name,
        insightGain: Number(appliedInsightGain.toFixed(4)),
        qiGain,
        riskTriggered: risk.triggered,
        cultivationExperience,
        description: `${entity.staticData?.name || entity.name || entity.id} 游历归来：${event.name}，感悟+${appliedInsightGain.toFixed(3)}、真气+${qiGain}`,
      },
    };
  }
}
