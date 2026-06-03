/**
 * cultivation-actions —— 修炼域行为执行器（从 npc-actions.js 拆分）。
 *
 * 含闭关修炼 / 修炼场加速 / 寻丹续命 / 挑战上位 / 疗伤：
 *   Cultivate / TrainChamber / SeekElixir / Challenge / Heal
 * 共享工具（配置读取等）统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { getCultivationConfig } from './npc-action-utils.js';
import { readTraitSpeedMult } from '../npc-traits.js';

export class NPCCultivateExecutor extends ActionExecutor {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.extraSpeedMultiplier=1.0] 额外修炼速度倍率（如修炼场加成）
   * @param {string} [opts.descriptionPrefix='闭关修炼'] 描述前缀
   */
  run(entity, worldContext, action, opts = {}) {
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

    // 功法加成：读取 techniqueId → 查 techniqueRegistry → 应用 cultivationSpeedMultiplier
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

    // 先天资质加成：灵根+体质 speedMultiplier 连乘进修炼速度（ADR-012/042）。
    // 经 AttributeSet traitSpeedMult 生效（开关关则回退直接读 config）。
    speedMultiplier *= readTraitSpeedMult(entity);

    // duration 代表本次闭关天数：进度/真气按天累计（speed 为"每天"语义）
    const days = Math.max(1, action?.duration ?? 1);
    const speed = baseSpeed * speedMultiplier;
    const progressGain = speed * days;

    // 闭关进度边际递减但可到顶（ADR-017）：
    //   有效增量 = 基础增量 × e^(-k × current/cap)。越接近 cap 增量越小，但永不为 0，
    //   故能缓慢逼近/到顶；仍夹 cap 防数值溢出。撞顶后剩余进度靠游历感悟(insight)补足。
    const capMap = cult.cultivationCap || {};
    const cap = capMap[rankId] ?? 1.0;
    const decayK = cult.cultivationDecayK ?? 2.5;
    const current = entity.state.get('cultivationProgress') || 0;
    const decayFactor = Math.exp(-decayK * Math.min(1, current / Math.max(cap, 1e-6)));
    const effectiveGain = progressGain * decayFactor;
    const newProgress = Math.min(current + effectiveGain, cap);
    // 真气随进度同步增长：按【实际进度增量】（已含天赋倍率与边际递减、夹 cap）折算真气。
    // 这样天赋加速进度的同时也加速真气线，弟子修满进度时真气≈下一境界门槛，得以突破（ADR-039）。
    const qiPerProgressMap = cult.qiPerProgress || {};
    let progressQi = (qiPerProgressMap[rankId] ?? 0) * (newProgress - current);
    entity.state.set('cultivationProgress', newProgress);

    // 功法寿元影响（负值为消耗，正值为延长，每次修炼小幅触发）
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

    // 灵石消耗按天累计（闭关 N 天消耗 N 天的灵石）
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
        // 道侣双修叠加功法的 dual_cultivation_bonus
        let dualBonus = progressBonus;
        if (techniqueId && worldContext.techniqueRegistry) {
          const technique = worldContext.techniqueRegistry.get(techniqueId);
          const dualEffect = technique?.effects?.specialEffects?.find(
            e => e.type === 'dual_cultivation_bonus'
          );
          if (dualEffect) dualBonus *= dualEffect.value;
        }
        // 道侣双修额外进度同样走边际递减：以当前(已含本次基础增量)进度计算衰减。
        const curWithBase = entity.state.get('cultivationProgress') || 0;
        const dualDecay = Math.exp(-decayK * Math.min(1, curWithBase / Math.max(cap, 1e-6)));
        const dualProgress = Math.min(curWithBase + speed * days * dualBonus * dualDecay, cap);
        // 双修额外进度同样按 qiPerProgress 折算真气，保持真气与进度一致（叠加双修 qi 倍率）。
        qiGain += (qiPerProgressMap[rankId] ?? 0) * (dualProgress - curWithBase) * qiMultiplier;
        entity.state.set('cultivationProgress', dualProgress);
        companionBonusApplied = true;
      }
    }

    const currentQi = entity.state.get('qi') || 0;
    entity.state.set('qi', currentQi + qiGain);

    // 将功法突破加成写入 state，供 _tryBreakthrough 使用
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
      description: `${entity.staticData.name} ${descriptionPrefix}，消耗${consumed}灵石，真气+${qiGain.toFixed(1)}`,
    };
  }
}

/**
 * 赴修炼场修炼：消耗门派贡献点，换取修炼速度加成。
 * 复用 NPCCultivateExecutor 的核心修炼逻辑（单一职责 + 开闭），仅注入速度倍率并扣减贡献。
 * 贡献不足由行为 preconditions 拦截（GOAP 不会规划本行为），此处兜底再校验一次。
 */
export class NPCTrainChamberExecutor extends NPCCultivateExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const chamberCfg = cult.actions?.trainChamber || {};
    const contributionCost = chamberCfg.contributionCost ?? 10;
    const speedBonus = chamberCfg.speedBonusMultiplier ?? 1.25;

    const contribution = entity.state.get('contribution') || 0;
    if (contribution < contributionCost) {
      // 贡献不足：兜底回退为普通闭关（不扣贡献、无加成）
      return super.run(entity, worldContext, action);
    }

    entity.state.set('contribution', contribution - contributionCost);

    const result = super.run(entity, worldContext, action, {
      extraSpeedMultiplier: speedBonus,
      descriptionPrefix: `入修炼场加速修炼（消耗${contributionCost}贡献）`,
    });
    return {
      ...result,
      contributionSpent: contributionCost,
      speedBonusMultiplier: speedBonus,
    };
  }
}

export class NPCSeekElixirExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const elixirCfg = cult.actions?.seekElixir || {};
    const successRate = elixirCfg.successRate ?? 0.1;
    const extensionRatio = elixirCfg.lifespanExtensionRatio ?? 0.1;

    const success = worldContext.rng.next() < successRate;
    if (success) {
      const maxAgeDays = entity.state.get('maxAgeDays') || 1;
      const extension = Math.floor(maxAgeDays * extensionRatio);
      entity.state.set('maxAgeDays', maxAgeDays + extension);
      const ageDays = entity.state.get('ageDays') || 0;
      entity.state.set('lifeRatio', ageDays / (maxAgeDays + extension));
      return { success: true, description: `${entity.staticData.name} 找到了续命丹药，寿元延长` };
    }
    return { success: false, description: `${entity.staticData.name} 寻找续命丹药失败` };
  }
}

export class NPCChallengeExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const cult = getCultivationConfig(worldContext);
    const challengeCfg = cult.actions?.challenge || {};
    const successRate = challengeCfg.successRate ?? 0.2;

    const success = worldContext.rng.next() < successRate;
    if (success) {
      // 挑战上位 = 弹性晋升通道：沿职位阶梯实际晋升一级。晋入稀缺顶层（elder/heir）时由引擎按
      // "有空缺直接补位 / 满员挑战现任、成功现任降一级"结算（见 TickManager.promoteByLadder）。
      if (typeof worldContext.promoteByLadder === 'function') {
        const r = worldContext.promoteByLadder(entity.id);
        if (r && r.promoted) {
          const via = r.viaChallenge ? '击败现任' : '补位';
          return {
            success: true, fromRole: r.fromRole, toRole: r.promoted, viaChallenge: r.viaChallenge,
            description: `${entity.staticData.name} 挑战上位成功（${via}），晋升为 ${r.promoted}`,
          };
        }
        return { success: false, description: `${entity.staticData.name} 挑战未果（顶端/满员且不敌现任）` };
      }
      return { success: false, description: `${entity.staticData.name} 挑战上位失败（缺少世界上下文）` };
    }
    return { success: false, description: `${entity.staticData.name} 挑战上位失败` };
  }
}

export class NPCHealExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
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
}
