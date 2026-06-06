import { ToilPool } from '../../pools/toil-pool.js';
import {
  NPCMoveToTargetToilExecutor,
  NPCResolveTargetToilExecutor,
  NPCSetStateToilExecutor,
  NPCWaitDaysToilExecutor,
} from './core-toils.js';
import {
  NPCBindDynamicEventToilExecutor,
  NPCMarkDynamicEventParticipantToilExecutor,
  NPCMarkDynamicEventPreparedToilExecutor,
  NPCValidateDynamicEventPhaseToilExecutor,
  NPCWaitUntilEventPhaseToilExecutor,
} from './dynamic-event-toils.js';
import {
  NPCBuyItemToilExecutor,
  NPCCheckCurrencyToilExecutor,
  NPCCheckEquippedArtifactToilExecutor,
  NPCCheckInventoryItemToilExecutor,
  NPCEnsureArtifactToilExecutor,
  NPCEnsureItemToilExecutor,
  NPCEquipArtifactToilExecutor,
  NPCExchangeFactionItemToilExecutor,
  NPCRedeemQiPillToilExecutor,
  NPCUseQiPillToilExecutor,
} from './economy-toils.js';
import {
  NPCTeachDiscipleToilExecutor,
  NPCVisitMasterToilExecutor,
  NPCRequestCompanionToilExecutor,
  NPCSelectCompanionToilExecutor,
  NPCWaitForHuntCompanionToilExecutor,
} from './social-toils.js';
import {
  NPCAcceptQuestToilExecutor,
  NPCAssessMonsterHuntRiskToilExecutor,
  NPCBindMonsterHuntQuestToilExecutor,
  NPCHuntMonsterTargetToilExecutor,
  NPCMoveToQuestTargetToilExecutor,
  NPCPlanSafeHuntRouteToilExecutor,
  NPCPrepareMonsterHuntToilExecutor,
  NPCTurnInQuestToilExecutor,
  NPCUpdateQuestProgressToilExecutor,
} from './quest-toils.js';
import {
  NPCCultivateToilExecutor,
  NPCExploreToilExecutor,
  NPCHealToilExecutor,
  NPCTrainChamberToilExecutor,
} from './cultivation-toils.js';
import {
  NPCAbortOverdangerousTargetToilExecutor,
  NPCAssessCombatRiskToilExecutor,
  NPCHuntEnemyToilExecutor,
  NPCKillEnemyToilExecutor,
  NPCPrepareCombatSupplyToilExecutor,
  NPCRetreatToSafePlaceToilExecutor,
  NPCUseHealItemToilExecutor,
} from './combat-toils.js';

export function registerNPCToilExecutors() {
  ToilPool.registerExecutor('toil_resolve_target', new NPCResolveTargetToilExecutor());
  ToilPool.registerExecutor('toil_move_to_target', new NPCMoveToTargetToilExecutor());
  ToilPool.registerExecutor('toil_wait_days', new NPCWaitDaysToilExecutor());
  ToilPool.registerExecutor('toil_set_state', new NPCSetStateToilExecutor());
  ToilPool.registerExecutor('toil_bind_dynamic_event', new NPCBindDynamicEventToilExecutor());
  ToilPool.registerExecutor('toil_validate_dynamic_event_phase', new NPCValidateDynamicEventPhaseToilExecutor());
  ToilPool.registerExecutor('toil_wait_until_event_phase', new NPCWaitUntilEventPhaseToilExecutor());
  ToilPool.registerExecutor('toil_mark_dynamic_event_prepared', new NPCMarkDynamicEventPreparedToilExecutor());
  ToilPool.registerExecutor('toil_mark_dynamic_event_participant', new NPCMarkDynamicEventParticipantToilExecutor());
  ToilPool.registerExecutor('toil_check_inventory_item', new NPCCheckInventoryItemToilExecutor());
  ToilPool.registerExecutor('toil_ensure_item', new NPCEnsureItemToilExecutor());
  ToilPool.registerExecutor('toil_check_currency', new NPCCheckCurrencyToilExecutor());
  ToilPool.registerExecutor('toil_buy_item', new NPCBuyItemToilExecutor());
  ToilPool.registerExecutor('toil_exchange_faction_item', new NPCExchangeFactionItemToilExecutor());
  ToilPool.registerExecutor('toil_redeem_qi_pill', new NPCRedeemQiPillToilExecutor());
  ToilPool.registerExecutor('toil_use_qi_pill', new NPCUseQiPillToilExecutor());
  ToilPool.registerExecutor('toil_ensure_artifact', new NPCEnsureArtifactToilExecutor());
  ToilPool.registerExecutor('toil_check_equipped_artifact', new NPCCheckEquippedArtifactToilExecutor());
  ToilPool.registerExecutor('toil_equip_artifact', new NPCEquipArtifactToilExecutor());
  ToilPool.registerExecutor('toil_select_companion', new NPCSelectCompanionToilExecutor());
  ToilPool.registerExecutor('toil_request_companion', new NPCRequestCompanionToilExecutor());
  ToilPool.registerExecutor('toil_wait_for_hunt_companion', new NPCWaitForHuntCompanionToilExecutor());
  ToilPool.registerExecutor('toil_teach_disciple', new NPCTeachDiscipleToilExecutor());
  ToilPool.registerExecutor('toil_visit_master', new NPCVisitMasterToilExecutor());
  ToilPool.registerExecutor('toil_accept_quest', new NPCAcceptQuestToilExecutor());
  ToilPool.registerExecutor('toil_bind_monster_hunt_quest', new NPCBindMonsterHuntQuestToilExecutor());
  ToilPool.registerExecutor('toil_assess_monster_hunt_risk', new NPCAssessMonsterHuntRiskToilExecutor());
  ToilPool.registerExecutor('toil_prepare_monster_hunt', new NPCPrepareMonsterHuntToilExecutor());
  ToilPool.registerExecutor('toil_plan_safe_hunt_route', new NPCPlanSafeHuntRouteToilExecutor());
  ToilPool.registerExecutor('toil_move_to_quest_target', new NPCMoveToQuestTargetToilExecutor());
  ToilPool.registerExecutor('toil_hunt_monster_target', new NPCHuntMonsterTargetToilExecutor());
  ToilPool.registerExecutor('toil_update_quest_progress', new NPCUpdateQuestProgressToilExecutor());
  ToilPool.registerExecutor('toil_turn_in_quest', new NPCTurnInQuestToilExecutor());
  ToilPool.registerExecutor('toil_cultivate', new NPCCultivateToilExecutor());
  ToilPool.registerExecutor('toil_train_chamber', new NPCTrainChamberToilExecutor());
  ToilPool.registerExecutor('toil_heal', new NPCHealToilExecutor());
  ToilPool.registerExecutor('toil_explore', new NPCExploreToilExecutor());
  ToilPool.registerExecutor('toil_assess_combat_risk', new NPCAssessCombatRiskToilExecutor());
  ToilPool.registerExecutor('toil_prepare_combat_supply', new NPCPrepareCombatSupplyToilExecutor());
  ToilPool.registerExecutor('toil_retreat_to_safe_place', new NPCRetreatToSafePlaceToilExecutor());
  ToilPool.registerExecutor('toil_use_heal_item', new NPCUseHealItemToilExecutor());
  ToilPool.registerExecutor('toil_abort_overdangerous_target', new NPCAbortOverdangerousTargetToilExecutor());
  ToilPool.registerExecutor('toil_hunt_enemy', new NPCHuntEnemyToilExecutor());
  ToilPool.registerExecutor('toil_kill_enemy', new NPCKillEnemyToilExecutor());
}
