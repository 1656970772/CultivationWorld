/**
 * cultivation-actions —— 修炼域行为执行器（从 npc-actions.js 拆分）。
 *
 * 含闭关修炼 / 修炼场加速 / 寻丹续命 / 挑战上位 / 疗伤：
 *   Cultivate / TrainChamber / SeekElixir / Challenge / Heal
 * 共享工具（配置读取等）统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { getCultivationConfig } from './npc-action-utils.js';
import {
  runCultivation,
  runHeal,
  runTrainChamber,
} from '../services/cultivation-service.js';

export class NPCCultivateExecutor extends ActionExecutor {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.extraSpeedMultiplier=1.0] 额外修炼速度倍率（如修炼场加成）
   * @param {string} [opts.descriptionPrefix='闭关修炼'] 描述前缀
   */
  run(entity, worldContext, action, opts = {}) {
    return runCultivation(entity, worldContext, action, opts);
  }
}

/**
 * 赴修炼场修炼：消耗门派贡献点，换取修炼速度加成。
 * 复用 NPCCultivateExecutor 的核心修炼逻辑（单一职责 + 开闭），仅注入速度倍率并扣减贡献。
 * 贡献不足由行为 preconditions 拦截（GOAP 不会规划本行为），此处兜底再校验一次。
 */
export class NPCTrainChamberExecutor extends NPCCultivateExecutor {
  run(entity, worldContext, action) {
    return runTrainChamber(entity, worldContext, action);
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
    return runHeal(entity, worldContext, action);
  }
}
