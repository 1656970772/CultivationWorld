import { ResourceRegistry } from '../economy/resource-registry.js';

const QUEST_BOARD_STATES = new Set([
  'draft',
  'available',
  'accepted',
  'in_progress',
  'completed',
  'turned_in',
  'failed',
  'expired',
]);
const QUEST_DEDUPE_POLICIES = new Set(['by_dedupe_key', 'none']);
const PERSONAL_BOUNTY_REWARD_KINDS = new Set(['item']);

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target || {}, key);
}

function isNonEmptyObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function listAt(configs, key, property) {
  const value = configs?.[key];
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[property])) return value[property];
  return [];
}

function collectIds(list) {
  return new Set(asList(list).map((item) => item?.id).filter(Boolean));
}

function collectPhysicalItems(configs) {
  const byId = new Map();
  for (const item of listAt(configs, 'itemDefs', 'items')) {
    if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function buildTemplateMap(templates) {
  const map = new Map();
  if (Array.isArray(templates)) {
    for (const template of templates) {
      if (template?.id) map.set(template.id, template);
    }
    return map;
  }

  for (const [key, template] of Object.entries(asObject(templates))) {
    const id = template?.id || key;
    map.set(id, { id, ...template });
  }
  return map;
}

function buildHallMap(organization) {
  return new Map(asList(organization?.halls).map((hall) => [hall?.id, hall]).filter(([id]) => id));
}

function collectSeedProfileIds(seedProfiles) {
  const ids = new Set();
  for (const key of Object.keys(asObject(seedProfiles?.resourceProfiles))) ids.add(key);
  for (const key of Object.keys(asObject(seedProfiles?.inventoryProfiles))) ids.add(key);

  const seedProfileList = seedProfiles?.seedProfiles;
  if (Array.isArray(seedProfileList)) {
    for (const profile of seedProfileList) {
      if (profile?.id) ids.add(profile.id);
    }
  } else {
    for (const key of Object.keys(asObject(seedProfileList))) ids.add(key);
  }
  return ids;
}

function collectHallProfileIds(seedProfiles) {
  const ids = new Set(Object.keys(asObject(seedProfiles?.hallAssignmentProfiles)));
  const hallProfiles = seedProfiles?.hallProfiles;
  if (Array.isArray(hallProfiles)) {
    for (const profile of hallProfiles) {
      if (profile?.id) ids.add(profile.id);
    }
  } else {
    for (const key of Object.keys(asObject(hallProfiles))) ids.add(key);
  }
  return ids;
}

function getQuestTypes(questTemplates) {
  if (Array.isArray(questTemplates)) return questTemplates;
  return asList(questTemplates?.questTypes || questTemplates?.templates);
}

function buildQuestMatchKeys(questTemplates) {
  const keys = new Set();
  for (const template of getQuestTypes(questTemplates)) {
    if (template?.category) keys.add(template.category);
    for (const tag of asList(template?.tags)) keys.add(tag);
  }
  return keys;
}

function getResourceRegistry(configs) {
  if (configs?.resourceRegistry && typeof configs.resourceRegistry.isFactionStateResource === 'function') {
    return configs.resourceRegistry;
  }
  return ResourceRegistry.fromDefinitions({
    macroResources: listAt(configs, 'items', 'items'),
    itemDefs: configs?.itemDefs || {},
    organizationPointKeys: configs?.economicTransactionConfig?.assets?.organizationPointKeys || [],
  });
}

function addRef(refs, value, path) {
  if (typeof value === 'string') {
    refs.push({ id: value, path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => addRef(refs, entry, `${path}.${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) addRef(refs, child, `${path}.${key}`);
  }
}

function collectRefsByKeys(value, keys, path = 'config', refs = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectRefsByKeys(entry, keys, `${path}.${index}`, refs));
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (keys.has(key)) addRef(refs, child, childPath);
    collectRefsByKeys(child, keys, childPath, refs);
  }
  return refs;
}

function collectScenarioRefs(value, path = 'config', refs = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectScenarioRefs(entry, `${path}.${index}`, refs));
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key.endsWith('ScenarioId')) addRef(refs, child, childPath);
    collectScenarioRefs(child, childPath, refs);
  }
  return refs;
}

function validateIdRefs(refs, ids, label, errors) {
  for (const ref of refs) {
    if (ref.id && !ids.has(ref.id)) errors.push(`${label} ${ref.path} references missing id ${ref.id}`);
  }
}

function validateItemMap(value, label, itemIds, errors) {
  if (!isNonEmptyObject(value)) return;
  for (const itemId of Object.keys(value)) {
    if (itemId.startsWith('_')) continue;
    if (!itemIds.has(itemId)) errors.push(`${label} references missing item ${itemId}`);
  }
}

function validateNpcItems(npcs, itemIds, errors) {
  for (const npc of asList(npcs)) {
    const items = npc?.items;
    if (!items) continue;
    if (Array.isArray(items)) {
      for (const entry of items) {
        const itemId = typeof entry === 'string' ? entry : entry?.itemId;
        if (itemId && !itemIds.has(itemId)) {
          errors.push(`NPC ${npc?.id || '<missing>'}.items references missing item ${itemId}`);
        }
      }
      continue;
    }
    validateItemMap(items, `NPC ${npc?.id || '<missing>'}.items`, itemIds, errors);
  }
}

function validateRole(role, roleIds, label, errors) {
  if (role && !roleIds.has(role)) errors.push(`${label} references missing role ${role}`);
}

function validateNumberRange(value, label, errors, { min = null, max = null, required = true } = {}) {
  if (value == null) {
    if (required) errors.push(`${label} is required`);
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push(`${label} must be a finite number`);
    return;
  }
  if (min != null && number < min) errors.push(`${label} must be >= ${min}`);
  if (max != null && number > max) errors.push(`${label} must be <= ${max}`);
}

function buildRoleIds(configs, organization) {
  const promotion = configs?.balanceCultivation?.promotion
    || configs?.cultivationConfig?.promotion
    || {};
  const socialRoles = configs?.balanceSocial?.roles?.rankMap || {};
  return new Set([
    ...Object.keys(asObject(promotion.roleRankByStep)),
    ...asList(promotion.ladder),
    ...Object.keys(asObject(socialRoles)),
    ...asList(organization?.identityRoles),
  ]);
}

function validateFactionSectReferences(configs, ids, errors) {
  const factions = asList(configs?.factions);
  for (const faction of factions) {
    const isFunctionalOrganization = !!faction?.subtype;
    if (!isFunctionalOrganization && typeof faction?.isSect !== 'boolean') {
      errors.push(`Faction ${faction?.id || '<missing>'} core faction must explicitly declare isSect`);
    }

    const hasSectFields = [
      'isSect',
      'isPublic',
      'sectTemplateId',
      'sectSeedProfileId',
      'hallAssignmentProfileId',
      'seedProfileId',
      'hallProfileId',
      'inventoryOverrides',
    ].some((field) => hasOwn(faction, field));

    if (!hasSectFields && !isFunctionalOrganization) continue;

    if (hasOwn(faction, 'isSect') && typeof faction.isSect !== 'boolean') {
      errors.push(`Faction ${faction?.id || '<missing>'}.isSect must be boolean when declared`);
    }
    if (hasOwn(faction, 'isPublic') && typeof faction.isPublic !== 'boolean') {
      errors.push(`Faction ${faction?.id || '<missing>'}.isPublic must be boolean when declared`);
    }

    if (isFunctionalOrganization && faction.isPublic !== true && faction.isSect !== false) {
      errors.push(`Faction ${faction?.id || '<missing>'} functional organization must declare isPublic=true or isSect=false`);
    }
    if (faction.isPublic === true && hasOwn(faction, 'isSect') && faction.isSect !== false) {
      errors.push(`Faction ${faction?.id || '<missing>'} public organization must not declare isSect=true`);
    }

    const templateId = faction.sectTemplateId;
    const sectScale = faction.sectScale;
    const seedProfileId = faction.sectSeedProfileId || faction.seedProfileId;
    const hallProfileId = faction.hallAssignmentProfileId || faction.hallProfileId;
    const hasSectRefs = Boolean(templateId || seedProfileId || hallProfileId);
    if (hasSectRefs && faction.isSect !== true) {
      errors.push(`Faction ${faction?.id || '<missing>'} has sect profile fields but isSect is not true`);
    }

    if (faction.isSect === true) {
      if (!templateId) errors.push(`Faction ${faction?.id || '<missing>'} isSect=true requires sectTemplateId`);
      if (!seedProfileId) errors.push(`Faction ${faction?.id || '<missing>'} isSect=true requires sectSeedProfileId`);
      if (!hallProfileId) errors.push(`Faction ${faction?.id || '<missing>'} isSect=true requires hallAssignmentProfileId`);
    }

    if (templateId && !ids.templateIds.has(templateId)) {
      errors.push(`Faction ${faction?.id || '<missing>'}.sectTemplateId references missing template ${templateId}`);
    }
    if (seedProfileId && !ids.seedProfileIds.has(seedProfileId)) {
      errors.push(`Faction ${faction?.id || '<missing>'}.sectSeedProfileId references missing seed profile ${seedProfileId}`);
    }
    if (sectScale) {
      const expectedProfileId = configs?.sectSeedProfiles?.scaleToProfile?.[sectScale]
        || configs?.seedProfiles?.scaleToProfile?.[sectScale];
      if (!expectedProfileId) {
        errors.push(`Faction ${faction?.id || '<missing>'}.sectScale references missing scale ${sectScale}`);
      } else if (seedProfileId && seedProfileId !== expectedProfileId) {
        errors.push(`Faction ${faction?.id || '<missing>'}.sectScale ${sectScale} requires sectSeedProfileId ${expectedProfileId}`);
      }
    }
    if (hallProfileId && !ids.hallProfileIds.has(hallProfileId)) {
      errors.push(`Faction ${faction?.id || '<missing>'}.hallAssignmentProfileId references missing hall assignment profile ${hallProfileId}`);
    }
  }
}

function validateStockPressure(operation, itemIds, resourceRegistry, errors) {
  for (const rule of asList(operation?.stockPressure)) {
    const label = `stockPressure ${rule?.dedupeKey || rule?.resourceId || '<missing>'}`;
    if (typeof rule?.dedupeKey !== 'string' || rule.dedupeKey.trim() === '') {
      errors.push(`${label}.dedupeKey is required`);
    }
    if (rule?.kind === 'item') {
      if (!itemIds.has(rule.resourceId)) errors.push(`${label}.resourceId references missing item ${rule.resourceId}`);
    } else if (rule?.kind === 'faction_state_resource') {
      if (!resourceRegistry.isFactionStateResource(rule.resourceId)) {
        errors.push(`${label}.resourceId references missing faction state resource ${rule.resourceId}`);
      }
    }

    validateNumberRange(rule?.safeStock, `${label}.safeStock`, errors, { min: 0 });
    validateNumberRange(rule?.criticalStock, `${label}.criticalStock`, errors, { min: 0 });
    if (Number.isFinite(Number(rule?.safeStock)) && Number.isFinite(Number(rule?.criticalStock)) && Number(rule.criticalStock) > Number(rule.safeStock)) {
      errors.push(`${label}.criticalStock must be <= safeStock`);
    }

    for (const entry of asList(rule?.settlement?.stateResources)) {
      if (!resourceRegistry.isFactionStateResource(entry?.resourceId)) {
        errors.push(`${label}.settlement.stateResources references missing faction state resource ${entry?.resourceId}`);
      }
      if (entry && hasOwn(entry, 'quantity')) {
        validateNumberRange(entry.quantity, `${label}.settlement.stateResources.${entry.resourceId || '<missing>'}.quantity`, errors, { min: 0 });
      }
    }

    for (const entry of asList(rule?.settlement?.items)) {
      if (entry && hasOwn(entry, 'quantity')) {
        validateNumberRange(entry.quantity, `${label}.settlement.items.${entry.itemId || '<missing>'}.quantity`, errors, { min: 0 });
      }
    }

    for (const effect of asList(rule?.settlement?.restockEffects)) {
      if (effect && hasOwn(effect, 'ratio')) {
        validateNumberRange(effect.ratio, `${label}.settlement.restockEffects.${effect.itemId || '<missing>'}.ratio`, errors, { min: 0, max: 1 });
      }
    }
  }
}

function validateSectOperationNumbers(operation, errors) {
  validateNumberRange(operation?.monthlyIntervalDays, 'balanceSectOperation.monthlyIntervalDays', errors, { min: 1 });
  for (const [role, value] of Object.entries(asObject(operation?.stipends?.roleStones))) {
    validateNumberRange(value, `balanceSectOperation.stipends.roleStones.${role}`, errors, { min: 0 });
  }
  for (const [rankId, rule] of Object.entries(asObject(operation?.stipends?.rankPills))) {
    validateNumberRange(rule?.quantity, `balanceSectOperation.stipends.rankPills.${rankId}.quantity`, errors, { min: 0 });
  }
  validateNumberRange(operation?.stipends?.hallExtraStones?.member, 'balanceSectOperation.stipends.hallExtraStones.member', errors, { min: 0 });
  validateNumberRange(operation?.stipends?.hallExtraStones?.chief, 'balanceSectOperation.stipends.hallExtraStones.chief', errors, { min: 0 });
  validateNumberRange(operation?.maintenance?.baseStones, 'balanceSectOperation.maintenance.baseStones', errors, { min: 0 });
  validateNumberRange(operation?.maintenance?.perTerritoryStones, 'balanceSectOperation.maintenance.perTerritoryStones', errors, { min: 0 });
  validateNumberRange(operation?.decline?.shortfallStreakForDeparture, 'balanceSectOperation.decline.shortfallStreakForDeparture', errors, { min: 0 });
  validateNumberRange(operation?.decline?.stabilityForDeparture, 'balanceSectOperation.decline.stabilityForDeparture', errors, { min: 0, max: 100 });
  validateNumberRange(operation?.decline?.leaveChanceBase, 'balanceSectOperation.decline.leaveChanceBase', errors, { min: 0, max: 1 });
  validateNumberRange(operation?.decline?.leaveChancePerShortfallStreak, 'balanceSectOperation.decline.leaveChancePerShortfallStreak', errors, { min: 0, max: 1 });
  validateNumberRange(operation?.decline?.stabilityPenaltyPerMonth, 'balanceSectOperation.decline.stabilityPenaltyPerMonth', errors, { min: 0 });
  validateNumberRange(operation?.personalBounty?.minRankOrder, 'balanceSectOperation.personalBounty.minRankOrder', errors, { min: 0 });
  validateNumberRange(operation?.personalBounty?.feeAmount, 'balanceSectOperation.personalBounty.feeAmount', errors, { min: 0 });
  validateNumberRange(operation?.personalBounty?.defaultPriority, 'balanceSectOperation.personalBounty.defaultPriority', errors, { min: 0 });
  validateNumberRange(operation?.personalBounty?.defaultDifficulty, 'balanceSectOperation.personalBounty.defaultDifficulty', errors, { min: 1 });
}

function validateSectOperationStructure(operation, errors) {
  const questBoard = asObject(operation?.questBoard);
  const stateMachine = questBoard.stateMachine;
  const states = Array.isArray(stateMachine)
    ? stateMachine
    : asList(stateMachine?.states || stateMachine?.allowed);
  if (states.length === 0) {
    errors.push('balanceSectOperation.questBoard.stateMachine must declare states');
  }
  for (const state of states) {
    if (!QUEST_BOARD_STATES.has(state)) {
      errors.push(`balanceSectOperation.questBoard.stateMachine references invalid state ${state}`);
    }
  }

  const dedupePolicy = questBoard.dedupePolicy || 'by_dedupe_key';
  if (!QUEST_DEDUPE_POLICIES.has(dedupePolicy)) {
    errors.push(`balanceSectOperation.questBoard.dedupePolicy references invalid policy ${dedupePolicy}`);
  }

  for (const board of asList(questBoard.visibilityPolicy?.publicBoards)) {
    if (typeof board !== 'string' || board.trim() === '') {
      errors.push('balanceSectOperation.questBoard.visibilityPolicy.publicBoards must contain non-empty strings');
    }
  }

  const personalBounty = asObject(operation?.personalBounty);
  if (typeof personalBounty.escrowHolderType !== 'string' || personalBounty.escrowHolderType.trim() === '') {
    errors.push('balanceSectOperation.personalBounty.escrowHolderType must be a non-empty string');
  }
  const rewardKinds = asList(personalBounty.allowedRewardKinds);
  if (rewardKinds.length === 0) {
    errors.push('balanceSectOperation.personalBounty.allowedRewardKinds must not be empty');
  }
  for (const kind of rewardKinds) {
    if (!PERSONAL_BOUNTY_REWARD_KINDS.has(kind)) {
      errors.push(`balanceSectOperation.personalBounty.allowedRewardKinds cannot include ${kind}`);
    }
  }
}

export function collectSectConfigErrors(configs = {}) {
  const errors = [];
  const manifest = configs?.dataManifest || null;
  const organization = configs?.sectOrganization || configs?.organization || {};
  const seedProfiles = configs?.sectSeedProfiles || configs?.seedProfiles || {};
  const operation = configs?.balanceSectOperation || configs?.operation || {};

  for (const key of ['sectOrganization', 'sectSeedProfiles', 'balanceSectOperation']) {
    if (manifest && !manifest.singletons?.[key]) {
      errors.push(`manifest singleton ${key} is missing`);
    }
    if (!isNonEmptyObject(configs?.[key]) && !isNonEmptyObject(configs?.[key === 'sectOrganization' ? 'organization' : key === 'sectSeedProfiles' ? 'seedProfiles' : 'operation'])) {
      errors.push(`config ${key} is missing or empty`);
    }
  }

  const templateById = buildTemplateMap(organization.templates);
  const hallById = buildHallMap(organization);
  const seedProfileIds = collectSeedProfileIds(seedProfiles);
  const hallProfileIds = collectHallProfileIds(seedProfiles);
  const itemIds = collectIds(collectPhysicalItems(configs));
  const rankIds = collectIds(configs.ranksData || configs.ranks || []);
  const questIds = collectIds(getQuestTypes(configs.questTemplates));
  const scenarioIds = new Set(Object.keys(asObject(configs.economicTransactionConfig?.scenarios)));
  const resourceRegistry = getResourceRegistry(configs);
  const roleIds = buildRoleIds(configs, organization);
  validateSectOperationNumbers(operation, errors);
  validateSectOperationStructure(operation, errors);

  for (const [scale, profileId] of Object.entries(asObject(seedProfiles.scaleToProfile))) {
    if (profileId && !seedProfileIds.has(profileId)) {
      errors.push(`sectSeedProfiles.scaleToProfile.${scale} references missing seed profile ${profileId}`);
    }
  }

  validateFactionSectReferences(configs, {
    templateIds: new Set(templateById.keys()),
    seedProfileIds,
    hallProfileIds,
  }, errors);

  for (const [profileId, profile] of Object.entries(asObject(seedProfiles.resourceProfiles))) {
    for (const resourceId of Object.keys(asObject(profile))) {
      if (!resourceRegistry.isFactionStateResource(resourceId)) {
        errors.push(`resourceProfiles.${profileId} references missing faction state resource ${resourceId}`);
      }
    }
  }

  for (const [profileId, profile] of Object.entries(asObject(seedProfiles.inventoryProfiles))) {
    validateItemMap(profile, `inventoryProfiles.${profileId}`, itemIds, errors);
  }
  for (const [kitId, kit] of Object.entries(asObject(seedProfiles.npcStarterKits))) {
    validateItemMap(kit, `npcStarterKits.${kitId}`, itemIds, errors);
  }
  const starterKitIds = new Set(Object.keys(asObject(seedProfiles.npcStarterKits)));
  for (const field of ['memberStarterKitId', 'chiefStarterKitId']) {
    const kitId = organization?.hallMembership?.[field];
    if (kitId && !starterKitIds.has(kitId)) {
      errors.push(`sectOrganization.hallMembership.${field} references missing starter kit ${kitId}`);
    }
  }
  for (const faction of asList(configs.factions)) {
    validateItemMap(faction?.inventoryOverrides, `Faction ${faction?.id || '<missing>'}.inventoryOverrides`, itemIds, errors);
  }
  validateNpcItems(configs.npcs, itemIds, errors);

  validateIdRefs(
    [
      ...collectRefsByKeys(organization?.templates, new Set(['hallId', 'hallIds']), 'sectOrganization.templates'),
      ...collectRefsByKeys(seedProfiles?.hallAssignmentProfiles, new Set(['hallId', 'hallIds']), 'sectSeedProfiles.hallAssignmentProfiles'),
      ...collectRefsByKeys(operation, new Set(['hallId', 'hallIds', 'issuerHall', 'sectIssuerHints']), 'balanceSectOperation'),
    ],
    new Set(hallById.keys()),
    'Hall',
    errors,
  );

  validateIdRefs(
    [
      ...collectRefsByKeys(organization?.halls, new Set(['questTemplateId', 'questTemplateIds']), 'sectOrganization.halls'),
      ...collectRefsByKeys(operation, new Set(['questTemplateId', 'questTemplateIds', 'allowedQuestTemplateIds']), 'balanceSectOperation'),
    ],
    questIds,
    'QuestTemplate',
    errors,
  );

  validateIdRefs(collectScenarioRefs(operation, 'balanceSectOperation'), scenarioIds, 'TransactionScenario', errors);

  for (const role of asList(organization?.managementRoles)) {
    validateRole(role, roleIds, 'sectOrganization.managementRoles', errors);
  }
  for (const role of Object.keys(asObject(operation?.stipends?.roleStones))) {
    validateRole(role, roleIds, 'balanceSectOperation.stipends.roleStones', errors);
  }
  for (const role of asList(operation?.decline?.exemptRoles)) {
    validateRole(role, roleIds, 'balanceSectOperation.decline.exemptRoles', errors);
  }
  for (const [profileId, profile] of Object.entries(asObject(seedProfiles?.hallAssignmentProfiles))) {
    for (const rule of asList(profile?.rules)) {
      validateRole(rule?.chiefRole, roleIds, `hallAssignmentProfiles.${profileId}.chiefRole`, errors);
    }
  }

  for (const rankId of Object.keys(asObject(operation?.stipends?.rankPills))) {
    if (!rankIds.has(rankId)) errors.push(`balanceSectOperation.stipends.rankPills references missing rank ${rankId}`);
  }

  validateIdRefs(collectRefsByKeys(operation, new Set(['itemId', 'feeItemId', 'perInputItemId']), 'balanceSectOperation'), itemIds, 'Item', errors);
  if (operation?.treasury?.stoneResourceId && !resourceRegistry.isFactionStateResource(operation.treasury.stoneResourceId)) {
    errors.push(`balanceSectOperation.treasury.stoneResourceId references missing faction state resource ${operation.treasury.stoneResourceId}`);
  }
  validateStockPressure(operation, itemIds, resourceRegistry, errors);

  const questMatchKeys = buildQuestMatchKeys(configs.questTemplates);
  for (const tag of asList(operation?.questSelection?.monsterHuntTags)) {
    if (!questMatchKeys.has(tag)) {
      errors.push(`balanceSectOperation.questSelection.monsterHuntTags references missing quest category/tag ${tag}`);
    }
  }

  return errors;
}

function normalizeInput(input = {}) {
  const organization = input.organization || input.sectOrganization || {};
  const seedProfiles = input.seedProfiles || input.sectSeedProfiles || {};
  const operation = input.operation || input.balanceSectOperation || {};
  return {
    ...input,
    sectOrganization: organization,
    sectSeedProfiles: seedProfiles,
    balanceSectOperation: operation,
    ranksData: input.ranksData || input.ranks || [],
    balanceCultivation: input.cultivationConfig || input.balanceCultivation || {},
  };
}

export class SectConfigRegistry {
  constructor(configs = {}) {
    this._configs = normalizeInput(configs);
    this.organization = this._configs.sectOrganization;
    this.seedProfiles = this._configs.sectSeedProfiles;
    this.operation = this._configs.balanceSectOperation;
    this.hallById = buildHallMap(this.organization);
    this.templateById = buildTemplateMap(this.organization?.templates);
    this.seedProfileIds = collectSeedProfileIds(this.seedProfiles);
    this.hallProfileIds = collectHallProfileIds(this.seedProfiles);
    this.roleRanks = this._configs.balanceCultivation?.promotion?.roleRankByStep || {};
  }

  assertValid() {
    const errors = collectSectConfigErrors(this._configs);
    if (errors.length > 0) {
      const error = new Error(`[SectConfigRegistry] ${errors.join('; ')}`);
      error.errors = errors;
      throw error;
    }
    return true;
  }

  getHall(id) {
    return this.hallById.get(id) || null;
  }

  getTemplate(id) {
    return this.templateById.get(id) || null;
  }

  hasSeedProfile(id) {
    return this.seedProfileIds.has(id);
  }

  isSectFactionConfig(config = {}) {
    return config?.isSect === true
      && Boolean(config.sectTemplateId)
      && Boolean(config.sectSeedProfileId);
  }

  resolveFactionResources(config = {}) {
    if (!this.isSectFactionConfig(config)) return asObject(config.resources);
    const profileId = config.sectSeedProfileId;
    const profile = asObject(this.seedProfiles?.resourceProfiles?.[profileId]);
    if (!isNonEmptyObject(profile)) throw new Error(`未知 sect resource profile: ${profileId}`);
    return {
      ...profile,
      ...asObject(config.resources),
    };
  }

  resolveFactionInventory(config = {}) {
    if (!this.isSectFactionConfig(config)) return asObject(config.inventoryOverrides);
    const profileId = config.sectSeedProfileId;
    const profile = asObject(this.seedProfiles?.inventoryProfiles?.[profileId]);
    if (!isNonEmptyObject(profile)) throw new Error(`未知 sect inventory profile: ${profileId}`);
    return {
      ...profile,
      ...asObject(config.inventoryOverrides),
    };
  }

  resolveNpcStarterItems(config = {}) {
    const starterKitProfileId = config?.starterKitProfileId;
    const profile = starterKitProfileId
      ? this.seedProfiles?.npcStarterKits?.[starterKitProfileId]
      : null;
    if (starterKitProfileId && !profile) {
      throw new Error(`未知 npc starter kit: ${starterKitProfileId}`);
    }
    return {
      ...asObject(profile),
      ...asObject(config.items),
    };
  }

  roleRankOf(role, fallback = 1) {
    if (hasOwn(this.roleRanks, role)) return Number(this.roleRanks[role]);
    return fallback;
  }
}
