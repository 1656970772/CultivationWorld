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
} from './economy-toils.js';
import {
  NPCRequestCompanionToilExecutor,
  NPCSelectCompanionToilExecutor,
} from './social-toils.js';

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
  ToilPool.registerExecutor('toil_ensure_artifact', new NPCEnsureArtifactToilExecutor());
  ToilPool.registerExecutor('toil_check_equipped_artifact', new NPCCheckEquippedArtifactToilExecutor());
  ToilPool.registerExecutor('toil_equip_artifact', new NPCEquipArtifactToilExecutor());
  ToilPool.registerExecutor('toil_select_companion', new NPCSelectCompanionToilExecutor());
  ToilPool.registerExecutor('toil_request_companion', new NPCRequestCompanionToilExecutor());
}
