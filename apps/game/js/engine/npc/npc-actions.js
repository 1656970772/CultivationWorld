/**
 * npc-actions —— NPC 行为执行器统一注册入口与 re-export 门面。
 *
 * 历史上本文件聚合了全部 ~30 个 ActionExecutor 与共享 helper（1500+ 行）。
 * 现已按业务域拆分到 actions/ 子目录（见各文件头部说明），本文件退化为：
 *   1) 统一注册入口 registerNPCExecutors()（world-engine.js 依赖此路径不变）；
 *   2) 向后兼容的 re-export 门面（npc-entity / npc-utility / info-actions / 单测仍从此导入）。
 *
 * 拆分边界与接口契约见 docs/decisions/adr-030-core-class-refactor.md。
 */
import { ActionPool } from '../pools/action-pool.js';

import {
  NPCCultivateExecutor,
  NPCTrainChamberExecutor,
  NPCSeekElixirExecutor,
  NPCChallengeExecutor,
  NPCHealExecutor,
} from './actions/cultivation-actions.js';
import {
  NPCServeFactionExecutor,
  NPCAssistFactionExecutor,
  NPCExploreExecutor,
  NPCHuntEnemyExecutor,
  NPCKillEnemyExecutor,
  NPCRaidTreasureExecutor,
} from './actions/combat-actions.js';
import {
  NPCAcceptQuestExecutor,
  NPCDoQuestExecutor,
  NPCTurnInQuestExecutor,
} from './actions/quest-actions.js';
import {
  NPCDonateMaterialsExecutor,
  NPCRedeemQiPillExecutor,
  NPCUseQiPillExecutor,
  NPCRedeemBreakthroughPillExecutor,
  NPCUseBreakthroughPillExecutor,
  NPCRedeemArtifactExecutor,
} from './actions/economy-actions.js';
import {
  NPCGotoOpportunityExecutor,
  NPCAssistAllyExecutor,
  NPCVisitBenefactorExecutor,
  NPCTeachDiscipleExecutor,
  NPCProtectDiscipleExecutor,
  NPCVisitMasterExecutor,
} from './actions/relationship-actions.js';
import {
  NPCSecludeExecutor,
  NPCTakeDiscipleExecutor,
  NPCSeizePowerExecutor,
} from './actions/archetype-actions.js';

// 共享工具与执行器一并 re-export，保持历史导入路径（'./npc-actions.js'）可用。
export {
  estimateRiskCost,
  computeActionValue,
  computeDecisionCost,
  killNPCByPvP,
  rollAndGrantReward,
} from './actions/npc-action-utils.js';

export {
  NPCCultivateExecutor,
  NPCTrainChamberExecutor,
  NPCSeekElixirExecutor,
  NPCChallengeExecutor,
  NPCHealExecutor,
} from './actions/cultivation-actions.js';
export {
  NPCServeFactionExecutor,
  NPCAssistFactionExecutor,
  NPCExploreExecutor,
  NPCHuntEnemyExecutor,
  NPCKillEnemyExecutor,
  NPCRaidTreasureExecutor,
} from './actions/combat-actions.js';
export {
  NPCAcceptQuestExecutor,
  NPCDoQuestExecutor,
  NPCTurnInQuestExecutor,
} from './actions/quest-actions.js';
export {
  NPCDonateMaterialsExecutor,
  NPCRedeemQiPillExecutor,
  NPCUseQiPillExecutor,
  NPCRedeemBreakthroughPillExecutor,
  NPCUseBreakthroughPillExecutor,
  NPCRedeemArtifactExecutor,
} from './actions/economy-actions.js';
export {
  NPCGotoOpportunityExecutor,
  NPCAssistAllyExecutor,
  NPCVisitBenefactorExecutor,
  NPCTeachDiscipleExecutor,
  NPCProtectDiscipleExecutor,
  NPCVisitMasterExecutor,
} from './actions/relationship-actions.js';
export {
  NPCSecludeExecutor,
  NPCTakeDiscipleExecutor,
  NPCSeizePowerExecutor,
} from './actions/archetype-actions.js';

/**
 * 注册全部 NPC 行为执行器到 ActionPool（统一入口，顺序与拆分前保持一致）。
 * world-engine.js 在初始化时调用一次。
 */
export function registerNPCExecutors() {
  ActionPool.registerExecutor('npc_cultivate', new NPCCultivateExecutor());
  ActionPool.registerExecutor('npc_train_chamber', new NPCTrainChamberExecutor());
  ActionPool.registerExecutor('npc_heal', new NPCHealExecutor());
  ActionPool.registerExecutor('npc_serve_faction', new NPCServeFactionExecutor());
  ActionPool.registerExecutor('npc_seek_elixir', new NPCSeekElixirExecutor());
  ActionPool.registerExecutor('npc_challenge', new NPCChallengeExecutor());
  ActionPool.registerExecutor('npc_assist_faction', new NPCAssistFactionExecutor());
  ActionPool.registerExecutor('npc_explore', new NPCExploreExecutor());
  ActionPool.registerExecutor('npc_accept_quest', new NPCAcceptQuestExecutor());
  ActionPool.registerExecutor('npc_do_quest', new NPCDoQuestExecutor());
  ActionPool.registerExecutor('npc_turn_in_quest', new NPCTurnInQuestExecutor());
  ActionPool.registerExecutor('npc_donate_materials', new NPCDonateMaterialsExecutor());
  ActionPool.registerExecutor('npc_redeem_qi_pill', new NPCRedeemQiPillExecutor());
  ActionPool.registerExecutor('npc_use_qi_pill', new NPCUseQiPillExecutor());
  ActionPool.registerExecutor('npc_redeem_breakthrough_pill', new NPCRedeemBreakthroughPillExecutor());
  ActionPool.registerExecutor('npc_use_breakthrough_pill', new NPCUseBreakthroughPillExecutor());
  ActionPool.registerExecutor('npc_redeem_artifact', new NPCRedeemArtifactExecutor());
  ActionPool.registerExecutor('npc_hunt_enemy', new NPCHuntEnemyExecutor());
  ActionPool.registerExecutor('npc_kill_enemy', new NPCKillEnemyExecutor());
  // 流派分化行为（ADR-022/ADR-023）：夺宝/养老/传承/夺权。
  ActionPool.registerExecutor('npc_raid_treasure', new NPCRaidTreasureExecutor());
  ActionPool.registerExecutor('npc_seclude', new NPCSecludeExecutor());
  ActionPool.registerExecutor('npc_take_disciple', new NPCTakeDiscipleExecutor());
  ActionPool.registerExecutor('npc_seize_power', new NPCSeizePowerExecutor());
  // 机会点前往（ADR-024）
  ActionPool.registerExecutor('npc_goto_opportunity', new NPCGotoOpportunityExecutor());
  ActionPool.registerExecutor('npc_assist_ally', new NPCAssistAllyExecutor());
  ActionPool.registerExecutor('npc_visit_benefactor', new NPCVisitBenefactorExecutor());
  // 师徒互动行为（ADR-029 第三期）：传功点化 / 护徒驰援 / 探望恩师。
  ActionPool.registerExecutor('npc_teach_disciple', new NPCTeachDiscipleExecutor());
  ActionPool.registerExecutor('npc_protect_disciple', new NPCProtectDiscipleExecutor());
  ActionPool.registerExecutor('npc_visit_master', new NPCVisitMasterExecutor());
}
