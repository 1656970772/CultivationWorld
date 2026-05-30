import { DATASET_SCHEMAS } from './schema-registry.js';

export function validateAllData(datasets, schemas = DATASET_SCHEMAS) {
  const issues = [];

  for (const [datasetKey, schema] of Object.entries(schemas)) {
    validateDatasetShape(datasetKey, datasets[datasetKey], schema, issues);
    validateDuplicateKeys(datasetKey, datasets[datasetKey], schema, issues);
    validateFieldRules(datasetKey, datasets[datasetKey], schema, issues);
  }

  validateCrossReferences(datasets, issues);

  return issues;
}

export function createIssue(severity, code, path, message, detail = null) {
  return { severity, code, path, message, detail };
}

export function getValueAtPath(target, path) {
  if (!path) return target;
  return path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    return value[key];
  }, target);
}

export function setValueAtPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cursor[key] == null || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

export function getReferenceOptions(datasets, targetKey, targetField = null) {
  const schema = DATASET_SCHEMAS[targetKey];
  const collection = datasets[targetKey];
  if (!schema || !Array.isArray(collection)) return [];
  const keyField = targetField || schema.keyField;
  return collection.map((item) => ({
    value: item[keyField],
    label: item.name ? `${item.name} (${item[keyField]})` : item[keyField]
  })).filter((option) => option.value != null && option.value !== '');
}

function validateDatasetShape(datasetKey, data, schema, issues) {
  if (schema.collection === 'array' && !Array.isArray(data)) {
    issues.push(createIssue(
      'error',
      'dataset_shape',
      datasetKey,
      `${schema.label} 应该是数组。`
    ));
  }

  if (schema.collection === 'object' && (data == null || Array.isArray(data) || typeof data !== 'object')) {
    issues.push(createIssue(
      'error',
      'dataset_shape',
      datasetKey,
      `${schema.label} 应该是对象。`
    ));
  }
}

function validateDuplicateKeys(datasetKey, data, schema, issues) {
  if (!Array.isArray(data) || !schema.keyField) return;

  const seen = new Map();
  data.forEach((item, index) => {
    const key = item?.[schema.keyField];
    const path = `${datasetKey}[${index}].${schema.keyField}`;

    if (key == null || key === '') {
      issues.push(createIssue('error', 'missing_key', path, `${schema.label} 缺少主键 ${schema.keyField}。`));
      return;
    }

    if (seen.has(key)) {
      issues.push(createIssue(
        'error',
        'duplicate_key',
        path,
        `${schema.label} 主键重复：${key}。`,
        { firstIndex: seen.get(key), duplicateIndex: index }
      ));
      return;
    }

    seen.set(key, index);
  });
}

function validateFieldRules(datasetKey, data, schema, issues) {
  if (schema.collection === 'array') {
    if (!Array.isArray(data)) return;
    data.forEach((item, index) => {
      validateFields(item, schema.fields || [], `${datasetKey}[${index}]`, issues);
    });
    return;
  }

  if (schema.collection === 'object' && data && typeof data === 'object') {
    validateFields(data, schema.fields || [], datasetKey, issues);
  }
}

function validateFields(item, fields, basePath, issues) {
  for (const field of fields) {
    const value = getValueAtPath(item, field.path);
    const path = `${basePath}.${field.path}`;

    if (field.required && (value == null || value === '')) {
      issues.push(createIssue('error', 'required', path, `${field.label} 为必填。`));
      continue;
    }

    if ((value == null || value === '') && field.optional) continue;
    if (value == null || value === '') continue;

    if (['number', 'range'].includes(field.type)) {
      validateNumberRange(value, field, path, issues);
    }
  }
}

function validateNumberRange(value, field, path, issues) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    issues.push(createIssue('error', 'number_type', path, `${field.label} 必须是数字。`));
    return;
  }

  if (field.min != null && value < field.min) {
    issues.push(createIssue(
      'error',
      'number_range',
      path,
      `${field.label} 不能小于 ${field.min}。`,
      { value, min: field.min, max: field.max ?? null }
    ));
  }

  if (field.max != null && value > field.max) {
    issues.push(createIssue(
      'error',
      'number_range',
      path,
      `${field.label} 不能大于 ${field.max}。`,
      { value, min: field.min ?? null, max: field.max }
    ));
  }
}

function validateCrossReferences(datasets, issues) {
  const factionIds = new Set((datasets.factions || []).map((item) => item.id));
  const npcIds = new Set((datasets.npcs || []).map((item) => item.id));
  const terrainTypes = new Set((datasets.terrains || []).map((item) => item.type));
  const eventTypes = new Set((datasets.events || []).map((item) => item.type));

  validateFactionReferences(datasets.factions || [], factionIds, npcIds, issues);
  validateNpcReferences(datasets.npcs || [], factionIds, issues);
  validateModifierConsistency(datasets.modifiers || [], issues);
  validateRuleReferences(datasets.rules || [], eventTypes, issues);
  validateEventOptions(datasets.events || [], issues);
  validateMapReferences(datasets.map || {}, factionIds, terrainTypes, issues);
}

function validateFactionReferences(factions, factionIds, npcIds, issues) {
  factions.forEach((faction, index) => {
    if (faction.leader && !npcIds.has(faction.leader)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `factions[${index}].leader`,
        `势力 ${faction.name || faction.id} 的掌门引用不存在：${faction.leader}。`
      ));
    }

    const relations = faction.relations || {};
    for (const [targetId, value] of Object.entries(relations)) {
      const path = `factions[${index}].relations.${targetId}`;
      if (!factionIds.has(targetId)) {
        issues.push(createIssue(
          'error',
          'invalid_reference',
          path,
          `关系目标势力不存在：${targetId}。`
        ));
      }
      if (typeof value !== 'number' || value < -100 || value > 100) {
        issues.push(createIssue(
          'error',
          'number_range',
          path,
          `势力关系值必须在 -100 到 100 之间。`,
          { value, min: -100, max: 100 }
        ));
      }
    }
  });
}

function validateNpcReferences(npcs, factionIds, issues) {
  npcs.forEach((npc, index) => {
    if (npc.factionId && !factionIds.has(npc.factionId)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `npcs[${index}].factionId`,
        `NPC ${npc.name || npc.id} 的所属势力不存在：${npc.factionId}。`
      ));
    }

    for (const [key, value] of Object.entries(npc.personality || {})) {
      if (typeof value !== 'number' || value < 0 || value > 100) {
        issues.push(createIssue(
          'error',
          'number_range',
          `npcs[${index}].personality.${key}`,
          `NPC 性格值必须在 0 到 100 之间。`,
          { value, min: 0, max: 100 }
        ));
      }
    }
  });
}

function validateModifierConsistency(modifiers, issues) {
  modifiers.forEach((modifier, index) => {
    if (typeof modifier.minDuration === 'number' &&
      typeof modifier.maxDuration === 'number' &&
      modifier.minDuration > modifier.maxDuration) {
      issues.push(createIssue(
        'error',
        'duration_order',
        `modifiers[${index}].maxDuration`,
        `世界状态 ${modifier.name || modifier.type} 的最长持续天数不能小于最短持续天数。`
      ));
    }

    for (const [key, value] of Object.entries(modifier.effects || {})) {
      if (typeof value !== 'number') {
        issues.push(createIssue(
          'error',
          'number_type',
          `modifiers[${index}].effects.${key}`,
          `世界状态效果值必须是数字。`
        ));
      }
    }
  });
}

function validateRuleReferences(rules, eventTypes, issues) {
  rules.forEach((rule, index) => {
    if (rule.event_type && !eventTypes.has(rule.event_type)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `rules[${index}].event_type`,
        `规则 ${rule.name || rule.id} 生成的事件类型不存在：${rule.event_type}。`
      ));
    }
  });
}

function validateEventOptions(events, issues) {
  events.forEach((event, eventIndex) => {
    if (typeof event.info_reliability === 'number' &&
      (event.info_reliability < 0 || event.info_reliability > 1)) {
      issues.push(createIssue(
        'error',
        'number_range',
        `events[${eventIndex}].info_reliability`,
        `事件基础可信度必须在 0 到 1 之间。`
      ));
    }

    if (!Array.isArray(event.player_options)) {
      issues.push(createIssue(
        'error',
        'dataset_shape',
        `events[${eventIndex}].player_options`,
        `事件 ${event.name || event.type} 的玩家选项必须是数组。`
      ));
      return;
    }

    event.player_options.forEach((option, optionIndex) => {
      const basePath = `events[${eventIndex}].player_options[${optionIndex}]`;
      for (const key of ['id', 'text', 'effect']) {
        if (!option[key]) {
          issues.push(createIssue('error', 'required', `${basePath}.${key}`, `玩家选项缺少 ${key}。`));
        }
      }
      if (typeof option.cost !== 'number' || option.cost < 0) {
        issues.push(createIssue(
          'error',
          'number_range',
          `${basePath}.cost`,
          `玩家选项消耗必须是大于等于 0 的数字。`
        ));
      }
    });
  });
}

function validateMapReferences(map, factionIds, terrainTypes, issues) {
  if (!Array.isArray(map.tiles)) {
    issues.push(createIssue('error', 'dataset_shape', 'map.tiles', '地图 tiles 必须是数组。'));
    return;
  }

  const width = map.width;
  const height = map.height;
  const seenCoords = new Set();

  map.tiles.forEach((tile, index) => {
    const coordKey = `${tile.x}_${tile.y}`;
    if (seenCoords.has(coordKey)) {
      issues.push(createIssue(
        'error',
        'duplicate_tile',
        `map.tiles[${index}]`,
        `地图格子坐标重复：${coordKey}。`
      ));
    }
    seenCoords.add(coordKey);

    if (!terrainTypes.has(tile.terrain)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `map.tiles[${index}].terrain`,
        `地图格子的地形不存在：${tile.terrain}。`
      ));
    }

    if (tile.ownerId && !factionIds.has(tile.ownerId)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `map.tiles[${index}].ownerId`,
        `地图格子的所属势力不存在：${tile.ownerId}。`
      ));
    }

    if (typeof tile.x !== 'number' || typeof tile.y !== 'number' ||
      tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      issues.push(createIssue(
        'error',
        'number_range',
        `map.tiles[${index}]`,
        `地图格子坐标超出地图范围。`,
        { x: tile.x, y: tile.y, width, height }
      ));
    }
  });
}

