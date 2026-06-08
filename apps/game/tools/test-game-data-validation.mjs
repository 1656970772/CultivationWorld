#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(GAME_ROOT, path)).href);

let failures = 0;
function ok(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failures++;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasError(result, fragment) {
  return result.errors.some((error) => error.includes(fragment));
}

const {
  loadGameDataManifest,
  loadGameConfigsFromManifest,
} = await imp('js/core/data-manifest-loader.js');
const { validateGameData } = await imp('js/core/game-data-validator.js');

const manifest = await loadGameDataManifest({ basePath: GAME_ROOT, loadJson: load });
const configs = await loadGameConfigsFromManifest(manifest, { basePath: GAME_ROOT, loadJson: load });

console.log('1) current game data passes strict validation');
const validResult = validateGameData(configs, { strict: false });
ok(validResult.valid, `current configs are valid: ${validResult.errors.join('; ') || 'no errors'}`);
ok(validResult.errors.length === 0, 'current configs have no validation errors');
ok(validateGameData(configs, { strict: true }).valid, 'strict validation returns valid result for current configs');

console.log('2) manifest-backed required groups are enforced');
const missingGroupConfigs = clone(configs);
delete missingGroupConfigs.effects;
const missingGroupResult = validateGameData(missingGroupConfigs, { strict: false });
ok(hasError(missingGroupResult, 'effects'), 'validator reports missing required effects group');

console.log('3) GE and GA prefixes are enforced');
const badEffectConfigs = clone(configs);
badEffectConfigs.effects.effects.push({ id: 'bad_effect', modifiers: [] });
ok(hasError(validateGameData(badEffectConfigs, { strict: false }), 'ge_'), 'validator reports non-ge_ effect id');

const badAbilityConfigs = clone(configs);
badAbilityConfigs.abilities.abilities.push({ id: 'bad_ability', grantsEffects: [] });
ok(hasError(validateGameData(badAbilityConfigs, { strict: false }), 'ga_'), 'validator reports non-ga_ ability id');

console.log('4) GE references from abilities and items must exist');
const badAbilityRefConfigs = clone(configs);
badAbilityRefConfigs.abilities.abilities.push({ id: 'ga_test_missing_effect', grantsEffects: ['ge_missing_from_ability'] });
ok(hasError(validateGameData(badAbilityRefConfigs, { strict: false }), 'ge_missing_from_ability'), 'validator reports missing ability grantsEffects reference');

const badItemRefConfigs = clone(configs);
badItemRefConfigs.itemDefs.items.push({ id: 'item_test_bad_effect', name: '测试坏物品', category: 'pill', effects: [{ effect: 'ge_missing_from_item' }] });
ok(hasError(validateGameData(badItemRefConfigs, { strict: false }), 'ge_missing_from_item'), 'validator reports missing item effect reference');

console.log('5) GameplayTag and GA/item cross references are validated');
const badAbilityTagConfigs = clone(configs);
badAbilityTagConfigs.abilities.abilities.push({
  id: 'ga_test_bad_tag',
  abilityTag: 'Ability.MissingForValidation',
  triggerTags: ['Trigger.MissingForValidation'],
  blockedByTags: ['Immune.MissingForValidation'],
  requiredItems: [],
  grantsEffects: [],
});
ok(hasError(validateGameData(badAbilityTagConfigs, { strict: false }), 'Ability.MissingForValidation'), 'validator reports missing GA gameplay tag');

const badEffectTagConfigs = clone(configs);
badEffectTagConfigs.effects.effects.push({
  id: 'ge_test_bad_tag',
  assetTags: ['Effect.MissingForValidation'],
  durationType: 'instant',
  modifiers: [],
  grantsTags: ['State.MissingForValidation'],
});
ok(hasError(validateGameData(badEffectTagConfigs, { strict: false }), 'Effect.MissingForValidation'), 'validator reports missing GE gameplay tag');

const badRequiredItemConfigs = clone(configs);
badRequiredItemConfigs.abilities.abilities.push({
  id: 'ga_test_missing_required_item',
  requiredItems: [{ itemId: 'item_missing_for_ability', amount: 1 }],
  grantsEffects: [],
});
ok(hasError(validateGameData(badRequiredItemConfigs, { strict: false }), 'item_missing_for_ability'), 'validator reports missing GA requiredItems itemId');

const badRequiredSelectorConfigs = clone(configs);
badRequiredSelectorConfigs.abilities.abilities.push({
  id: 'ga_test_missing_required_selector',
  requiredItems: [{ selector: { category: 'talisman', subCategory: 'missing_selector_target' }, quantity: 1 }],
  grantsEffects: [],
});
ok(hasError(validateGameData(badRequiredSelectorConfigs, { strict: false }), 'missing_selector_target'), 'validator reports GA requiredItems selector with no matching item');

const badRequiredAnyOfConfigs = clone(configs);
badRequiredAnyOfConfigs.abilities.abilities.push({
  id: 'ga_test_missing_required_any_of',
  requiredItems: [{
    anyOf: [
      { itemId: 'item_missing_any_of_a', amount: 1 },
      { selector: { category: 'talisman', subCategory: 'missing_any_of_selector' }, amount: 1 },
    ],
  }],
  grantsEffects: [],
});
ok(hasError(validateGameData(badRequiredAnyOfConfigs, { strict: false }), 'item_missing_any_of_a'), 'validator reports GA requiredItems anyOf when no option is valid');

const badItemAbilityRefConfigs = clone(configs);
badItemAbilityRefConfigs.itemDefs.items.push({
  id: 'item_test_bad_ability',
  name: '测试坏能力物品',
  category: 'talisman',
  value: 1,
  grantsAbilities: ['ga_missing_from_item'],
});
ok(hasError(validateGameData(badItemAbilityRefConfigs, { strict: false }), 'ga_missing_from_item'), 'validator reports item grantsAbilities missing GA reference');

console.log('6) behavior tree references and macro resources are validated');
const badBtConfigs = clone(configs);
badBtConfigs.aiConfig.npc.behaviorTreeId = 'bt_missing_tree';
ok(hasError(validateGameData(badBtConfigs, { strict: false }), 'bt_missing_tree'), 'validator reports missing referenced behavior tree');

const badResourceConfigs = clone(configs);
delete badResourceConfigs.items[0].category;
ok(hasError(validateGameData(badResourceConfigs, { strict: false }), 'macro resource'), 'validator reports invalid macro resource basic fields');

console.log('7) sect config references and numeric ranges are validated');
const badSectSettlementConfigs = clone(configs);
badSectSettlementConfigs.balanceSectOperation.stockPressure[0].settlement.stateResources[0].resourceId = 'missing_state_resource';
ok(
  hasError(validateGameData(badSectSettlementConfigs, { strict: false }), 'missing_state_resource'),
  'validator reports missing sect settlement faction state resource',
);

const badSectNumberConfigs = clone(configs);
badSectNumberConfigs.balanceSectOperation.monthlyIntervalDays = 0;
badSectNumberConfigs.balanceSectOperation.stockPressure[0].safeStock = -1;
badSectNumberConfigs.balanceSectOperation.stockPressure[1].settlement.restockEffects[0].ratio = 2;
const badSectNumberResult = validateGameData(badSectNumberConfigs, { strict: false });
ok(hasError(badSectNumberResult, 'monthlyIntervalDays'), 'validator reports invalid sect monthly interval');
ok(hasError(badSectNumberResult, 'safeStock'), 'validator reports invalid sect stock pressure range');
ok(hasError(badSectNumberResult, 'ratio'), 'validator reports invalid sect restock ratio');

const badStockDedupeConfigs = clone(configs);
delete badStockDedupeConfigs.balanceSectOperation.stockPressure[0].dedupeKey;
ok(hasError(validateGameData(badStockDedupeConfigs, { strict: false }), 'dedupeKey'), 'validator reports missing sect stock pressure dedupeKey');

const badSectEntityConfigs = clone(configs);
delete badSectEntityConfigs.factions.find(faction => !faction.subtype).isSect;
ok(hasError(validateGameData(badSectEntityConfigs, { strict: false }), 'explicitly declare isSect'), 'validator reports core faction missing explicit isSect');

const badSectScaleConfigs = clone(configs);
const scaledSect = badSectScaleConfigs.factions.find(faction => faction.isSect === true && faction.sectScale);
scaledSect.sectSeedProfileId = scaledSect.sectScale === 'large' ? 'sect_small' : 'sect_large';
ok(hasError(validateGameData(badSectScaleConfigs, { strict: false }), 'sectScale'), 'validator reports sectScale and seed profile mismatch');

const badBountyRewardKindConfigs = clone(configs);
badBountyRewardKindConfigs.balanceSectOperation.personalBounty.allowedRewardKinds = ['item', 'faction_state_resource'];
ok(hasError(validateGameData(badBountyRewardKindConfigs, { strict: false }), 'allowedRewardKinds'), 'validator reports invalid personal bounty reward kind');

const badQuestHallHintConfigs = clone(configs);
badQuestHallHintConfigs.questTemplates.questTypes.find(quest => Array.isArray(quest.sectIssuerHints)).sectIssuerHints = ['missing_hall_for_quest'];
ok(hasError(validateGameData(badQuestHallHintConfigs, { strict: false }), 'missing_hall_for_quest'), 'validator reports missing quest sectIssuerHints hall');

const badStockQuestMetadataConfigs = clone(configs);
const stockQuestId = badStockQuestMetadataConfigs.balanceSectOperation.stockPressure[0].questTemplateId;
const stockQuest = badStockQuestMetadataConfigs.questTemplates.questTypes.find(quest => quest.id === stockQuestId);
delete stockQuest.tags;
delete stockQuest.resourceDemandTags;
ok(hasError(validateGameData(badStockQuestMetadataConfigs, { strict: false }), 'resourceDemandTags'), 'validator reports stock pressure quest template without tags/resourceDemandTags');

console.log('8) strict mode throws with collected validation errors');
let strictError = null;
try {
  validateGameData(badAbilityRefConfigs, { strict: true });
} catch (err) {
  strictError = err;
}
ok(strictError && strictError.message.includes('ge_missing_from_ability'), 'strict mode throws with missing GE reference');

if (failures > 0) {
  console.error(`\nGame data validation tests failed: ${failures}`);
  process.exit(1);
}

console.log('\nGame data validation tests passed');
