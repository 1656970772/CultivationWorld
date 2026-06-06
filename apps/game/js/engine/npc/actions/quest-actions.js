/**
 * quest-actions —— 任务域行为执行器（从 npc-actions.js 拆分）。
 *
 * 含接取任务 / 执行任务（含猎妖结算）/ 交付任务领赏：
 *   AcceptQuest / DoQuest / TurnInQuest
 * 任务候选筛选、妖兽定位等共享工具统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import {
  acceptQuest,
  executeQuestDay,
  turnInQuest,
} from '../services/quest-service.js';

export class NPCAcceptQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return acceptQuest(entity, worldContext, {
      forceMonsterHunt: action?.id === 'act_npc_accept_hunt_quest'
        || action?.jobInput?.forceMonsterHunt === true,
    });
  }
}

export class NPCDoQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return executeQuestDay(entity, worldContext, action);
  }
}

export class NPCTurnInQuestExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    return turnInQuest(entity, worldContext, action);
  }
}
