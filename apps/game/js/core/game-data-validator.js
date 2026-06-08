/**
 * GameDataValidator - 运行时配置 strict 校验。
 *
 * 校验规则参数来自 configs.dataManifest.validation，必需目录组来自
 * configs.dataManifest.groups[*].required，避免在代码中维护业务数据清单。
 */
import { collectSectConfigErrors } from '../engine/sect/sect-config-registry.js';

function getByPath(target, path) {
  return String(path).split('.').filter(Boolean)
    .reduce((cursor, part) => (cursor == null ? undefined : cursor[part]), target);
}

function listFromGroupValue(value, groupManifest) {
  const output = groupManifest?.output || {};
  if (output.mode === 'mergeArrayProperty') return value?.[output.property];
  if (output.mode === 'documentArray') return output.property ? value?.[output.property] : value;
  return Array.isArray(value) ? value : null;
}

function assertRequiredManifestGroups(configs, manifest, errors) {
  for (const [key, groupManifest] of Object.entries(manifest?.groups || {})) {
    if (groupManifest.required !== true) continue;
    const value = getByPath(configs, groupManifest.outputPath || key);
    if (value == null) {
      errors.push(`manifest required group ${key} is missing from configs`);
      continue;
    }
    const list = listFromGroupValue(value, groupManifest);
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`manifest required group ${key} did not load a non-empty list`);
    }
  }
}

function listAt(configs, key, property) {
  const value = configs[key];
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[property])) return value[property];
  return [];
}

function validateIdPrefix(list, prefix, label, errors) {
  if (!prefix) return;
  for (const item of list) {
    if (!item?.id || !String(item.id).startsWith(prefix)) {
      errors.push(`${label} id ${item?.id || '<missing>'} must start with ${prefix}`);
    }
  }
}

function uniqueById(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

function collectRuntimeItems(configs) {
  return uniqueById([
    listAt(configs, 'items', 'items'),
    listAt(configs, 'itemDefs', 'items'),
  ]);
}

function collectIds(list) {
  return new Set((list || []).map((item) => item?.id).filter(Boolean));
}

function stringifyForError(value) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

function getItemField(item, key) {
  if (!item || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(item, key)) return item[key];
  if (item.properties && Object.prototype.hasOwnProperty.call(item.properties, key)) {
    return item.properties[key];
  }
  return undefined;
}

function selectorMatchesItem(item, selector, controlFields) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) return false;
  for (const [key, expected] of Object.entries(selector)) {
    if (controlFields.has(key)) continue;
    const actual = getItemField(item, key);
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function selectorHasMatch(items, selector, controlFields) {
  return items.some((item) => selectorMatchesItem(item, selector, controlFields));
}

function validateRequiredItemOption(option, ability, itemIds, items, rules) {
  const errors = [];
  const itemIdField = rules.requiredItemReferenceField || 'itemId';
  const selectorField = rules.requiredItemSelectorField || 'selector';
  const controlFields = new Set(rules.requiredItemSelectorControlFields || []);

  const itemId = option?.[itemIdField];
  if (itemId) {
    if (!itemIds.has(itemId)) {
      errors.push(`GameplayAbility ${ability?.id || '<missing>'} requiredItems references missing item ${itemId}`);
    }
    return errors;
  }

  const selector = option?.[selectorField];
  if (selector) {
    if (!selectorHasMatch(items, selector, controlFields)) {
      errors.push(`GameplayAbility ${ability?.id || '<missing>'} requiredItems selector matches no item ${stringifyForError(selector)}`);
    }
    return errors;
  }

  errors.push(`GameplayAbility ${ability?.id || '<missing>'} requiredItems entry must define ${itemIdField}, ${selectorField}, or ${rules.requiredItemAnyOfField || 'anyOf'}`);
  return errors;
}

function validateRequiredItemReferences(configs, rules, errors) {
  const abilities = listAt(configs, 'abilities', 'abilities');
  const items = collectRuntimeItems(configs);
  const itemIds = collectIds(items);
  const requiredItemsField = rules.abilityRequiredItemsField || 'requiredItems';
  const anyOfField = rules.requiredItemAnyOfField || 'anyOf';

  for (const ability of abilities) {
    const refs = ability?.[requiredItemsField] || [];
    if (!Array.isArray(refs)) {
      errors.push(`GameplayAbility ${ability?.id || '<missing>'}.${requiredItemsField} must be an array`);
      continue;
    }

    for (const ref of refs) {
      if (Array.isArray(ref?.[anyOfField])) {
        if (ref[anyOfField].length === 0) {
          errors.push(`GameplayAbility ${ability?.id || '<missing>'} requiredItems.${anyOfField} must not be empty`);
          continue;
        }
        const optionErrors = [];
        let hasValidOption = false;
        for (const option of ref[anyOfField]) {
          const merged = { ...ref, ...option };
          delete merged[anyOfField];
          const problems = validateRequiredItemOption(merged, ability, itemIds, items, rules);
          if (problems.length === 0) hasValidOption = true;
          else optionErrors.push(...problems);
        }
        if (!hasValidOption) errors.push(...optionErrors);
        continue;
      }

      errors.push(...validateRequiredItemOption(ref, ability, itemIds, items, rules));
    }
  }
}

function validateItemAbilityReferences(configs, rules, errors) {
  const abilities = listAt(configs, 'abilities', 'abilities');
  const abilityIds = collectIds(abilities);
  const itemAbilityListField = rules.itemAbilityListField || 'grantsAbilities';

  for (const item of collectRuntimeItems(configs)) {
    const refs = item?.[itemAbilityListField] || item?.properties?.[itemAbilityListField] || [];
    if (!Array.isArray(refs)) continue;
    for (const abilityId of refs) {
      if (abilityId && !abilityIds.has(abilityId)) {
        errors.push(`Item ${item?.id || '<missing>'} references missing ability ${abilityId}`);
      }
    }
  }
}

function collectTagValues(value, out) {
  if (!value) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectTagValues(entry, out);
  }
}

function validateGameplayTagReferences(configs, rules, errors) {
  const tagIds = collectIds(listAt(configs, 'tags', 'tags'));
  if (tagIds.size === 0) return;

  const effectTagFields = rules.effectTagFields || ['assetTags', 'grantsTags', 'removalTags'];
  const abilityTagFields = rules.abilityTagFields || ['abilityTag', 'triggerTags', 'blockedByTags'];
  const refs = [];

  for (const effect of listAt(configs, 'effects', 'effects')) {
    for (const field of effectTagFields) {
      collectTagValues(effect?.[field], refs);
    }
  }

  for (const ability of listAt(configs, 'abilities', 'abilities')) {
    for (const field of abilityTagFields) {
      collectTagValues(ability?.[field], refs);
    }
  }

  for (const tag of new Set(refs)) {
    if (!tagIds.has(tag)) {
      errors.push(`GameplayTag ${tag} is referenced by GE/GA but not registered`);
    }
  }
}

function validateEffectReferences(configs, rules, errors) {
  const effects = listAt(configs, 'effects', 'effects');
  const effectIds = new Set(effects.map((effect) => effect?.id).filter(Boolean));
  const effectPrefix = rules.effectIdPrefix;
  const abilityPrefix = rules.abilityIdPrefix;

  validateIdPrefix(effects, effectPrefix, 'GameplayEffect', errors);

  const abilities = listAt(configs, 'abilities', 'abilities');
  validateIdPrefix(abilities, abilityPrefix, 'GameplayAbility', errors);

  const abilityEffectField = rules.abilityEffectReferenceField;
  const abilityEffectIdField = rules.abilityEffectReferenceIdField;
  if (abilityEffectField) {
    for (const ability of abilities) {
      const refs = ability?.[abilityEffectField] || [];
      if (!Array.isArray(refs)) {
        errors.push(`GameplayAbility ${ability?.id || '<missing>'}.${abilityEffectField} must be an array`);
        continue;
      }
      for (const ref of refs) {
        const effectId = typeof ref === 'string' ? ref : ref?.[abilityEffectIdField];
        if (!effectIds.has(effectId)) {
          errors.push(`GameplayAbility ${ability?.id || '<missing>'} references missing effect ${effectId}`);
        }
      }
    }
  }

  const itemEffectListField = rules.itemEffectListField;
  const itemEffectReferenceField = rules.itemEffectReferenceField;
  if (itemEffectListField && itemEffectReferenceField) {
    for (const item of collectRuntimeItems(configs)) {
      const refs = item?.[itemEffectListField] || [];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        const effectId = ref?.[itemEffectReferenceField];
        if (effectId && !effectIds.has(effectId)) {
          errors.push(`Item ${item?.id || '<missing>'} references missing effect ${effectId}`);
        }
      }
    }
  }
}

function collectBehaviorTreeRefs(value, referenceKeys, refs, path = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectBehaviorTreeRefs(value[i], referenceKeys, refs, path.concat(i));
    }
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const nextPath = path.concat(key);
    if (referenceKeys.includes(key)) {
      if (typeof child === 'string') {
        refs.push({ id: child, path: nextPath.join('.') });
      } else if (Array.isArray(child)) {
        for (const id of child) {
          if (typeof id === 'string') refs.push({ id, path: nextPath.join('.') });
        }
      }
    }
    if (key !== 'dataManifest' && key !== 'behaviorTrees') {
      collectBehaviorTreeRefs(child, referenceKeys, refs, nextPath);
    }
  }
}

function validateBehaviorTreeReferences(configs, rules, errors) {
  const referenceKeys = rules.behaviorTreeReferenceKeys || [];
  if (!Array.isArray(referenceKeys) || referenceKeys.length === 0) return;

  const treeIds = new Set(listAt(configs, 'behaviorTrees', 'trees')
    .map((tree) => tree?.id)
    .filter(Boolean));
  if (treeIds.size === 0) return;

  const refs = [];
  collectBehaviorTreeRefs(configs, referenceKeys, refs);
  for (const ref of refs) {
    if (!treeIds.has(ref.id)) {
      errors.push(`Behavior tree reference ${ref.path} points to missing tree ${ref.id}`);
    }
  }
}

function typeMatches(value, type) {
  if (!type) return true;
  if (type === 'array') return Array.isArray(value);
  return typeof value === type;
}

function validateMacroResources(configs, rules, errors) {
  const requiredFields = rules.macroResourceRequiredFields || [];
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) return;
  const fieldTypes = rules.macroResourceFieldTypes || {};

  for (const resource of listAt(configs, 'items', 'items')) {
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(resource || {}, field)) {
        errors.push(`macro resource ${resource?.id || '<missing>'} missing required field ${field}`);
        continue;
      }
      if (!typeMatches(resource[field], fieldTypes[field])) {
        errors.push(`macro resource ${resource?.id || '<missing>'}.${field} must be ${fieldTypes[field]}`);
      }
    }
  }
}

export function validateSectConfig(configs, _rules, errors) {
  errors.push(...collectSectConfigErrors(configs || {}));
}

/**
 * 校验运行时游戏数据。
 * @param {Object} configs WorldEngine.init 使用的配置对象
 * @param {{ strict?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateGameData(configs, options = {}) {
  const errors = [];
  const manifest = configs?.dataManifest || null;
  const rules = manifest?.validation || {};

  if (manifest) {
    assertRequiredManifestGroups(configs, manifest, errors);
  }
  validateEffectReferences(configs || {}, rules, errors);
  validateRequiredItemReferences(configs || {}, rules, errors);
  validateItemAbilityReferences(configs || {}, rules, errors);
  validateGameplayTagReferences(configs || {}, rules, errors);
  validateBehaviorTreeReferences(configs || {}, rules, errors);
  validateMacroResources(configs || {}, rules, errors);
  validateSectConfig(configs || {}, rules, errors);

  if (errors.length > 0 && options.strict === true) {
    const error = new Error(`[GameDataValidation] ${errors.join('; ')}`);
    error.errors = errors;
    throw error;
  }

  return { valid: errors.length === 0, errors };
}
