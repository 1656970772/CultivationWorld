/**
 * economy-actions —— 经济域行为执行器（从 npc-actions.js 拆分）。
 *
 * 含捐献材料换贡献 / 兑换与服用丹药 / 兑换法宝：
 *   DonateMaterials / RedeemQiPill / UseQiPill / RedeemBreakthroughPill / UseBreakthroughPill / RedeemArtifact
 * 全部委托 ../npc-economy.js 的领域函数完成具体逻辑。
 */
import { ActionExecutor } from '../../abstract/action.js';
import {
  donateMaterials,
  redeemExchangeItem,
  useQiPill,
  useBreakthroughPill,
} from '../npc-economy.js';

export class NPCDonateMaterialsExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return donateMaterials(entity, worldContext);
  }
}

export class NPCRedeemQiPillExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return redeemExchangeItem(entity, worldContext, 'qi_pill');
  }
}

export class NPCUseQiPillExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return useQiPill(entity, worldContext);
  }
}

export class NPCRedeemBreakthroughPillExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return redeemExchangeItem(entity, worldContext, 'breakthrough_pill');
  }
}

export class NPCUseBreakthroughPillExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return useBreakthroughPill(entity, worldContext);
  }
}

export class NPCRedeemArtifactExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return redeemExchangeItem(entity, worldContext, 'artifact_low');
  }
}
