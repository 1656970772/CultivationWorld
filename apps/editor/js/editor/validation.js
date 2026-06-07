import { DATASET_REFERENCES, DATASET_SCHEMAS } from './schema-registry.js';

export function validateAllData(datasets, schemas = DATASET_SCHEMAS) {
  const issues = [];

  for (const [datasetKey, schema] of Object.entries(schemas)) {
    validateDatasetShape(datasetKey, datasets[datasetKey], schema, issues);
    validateDuplicateKeys(datasetKey, datasets[datasetKey], schema, issues);
    validateFieldRules(datasetKey, datasets[datasetKey], schema, issues);
  }

  validateSchemaReferences(datasets, schemas, issues);
  validateKnownCollectionRules(datasets, issues);

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
  const reference = DATASET_REFERENCES[targetKey] || {};
  const schema = DATASET_SCHEMAS[targetKey];
  const collection = datasets[targetKey];
  if (!schema || !Array.isArray(collection)) return [];
  const keyField = targetField || reference.keyField || schema.keyField;
  const labelField = reference.labelField || 'name';
  return collection.map((item) => ({
    value: item[keyField],
    label: item[labelField] ? `${item[labelField]} (${item[keyField]})` : item[keyField],
  })).filter((option) => option.value != null && option.value !== '');
}

function validateDatasetShape(datasetKey, data, schema, issues) {
  if (data == null) return;

  if (schema.collection === 'array' && !Array.isArray(data)) {
    issues.push(createIssue(
      'error',
      'dataset_shape',
      datasetKey,
      `${schema.label} 应该是数组。`
    ));
  }

  if (schema.collection === 'object' && (Array.isArray(data) || typeof data !== 'object')) {
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

function validateSchemaReferences(datasets, schemas, issues) {
  for (const [datasetKey, schema] of Object.entries(schemas)) {
    const data = datasets[datasetKey];
    if (schema.collection === 'array' && Array.isArray(data)) {
      data.forEach((item, index) => validateReferenceFields(
        item,
        schema.fields || [],
        `${datasetKey}[${index}]`,
        datasets,
        issues
      ));
    } else if (schema.collection === 'object' && data && typeof data === 'object') {
      validateReferenceFields(data, schema.fields || [], datasetKey, datasets, issues);
    }
  }
}

function validateReferenceFields(item, fields, basePath, datasets, issues) {
  for (const field of fields) {
    if (field.type === 'reference') {
      validateSingleReference(item, field, `${basePath}.${field.path}`, datasets, issues);
    }
    if (field.type === 'relations') {
      validateRelations(item, field, `${basePath}.${field.path}`, datasets, issues);
    }
    if (Array.isArray(field.fields)) {
      validateReferenceFields(item, field.fields, basePath, datasets, issues);
    }
  }
}

function validateSingleReference(item, field, path, datasets, issues) {
  const value = getValueAtPath(item, field.path);
  if (value == null || value === '') return;
  if (!referenceContains(datasets, field.target, field.targetKey, value)) {
    issues.push(createIssue(
      'error',
      'invalid_reference',
      path,
      `引用目标不存在：${value}。`,
      { value, target: field.target }
    ));
  }
}

function validateRelations(item, field, path, datasets, issues) {
  const relations = getValueAtPath(item, field.path) || {};
  for (const [targetId, value] of Object.entries(relations)) {
    const itemPath = `${path}.${targetId}`;
    if (!referenceContains(datasets, field.target, null, targetId)) {
      issues.push(createIssue('error', 'invalid_reference', itemPath, `关系目标不存在：${targetId}。`));
    }
    if (typeof value !== 'number' || value < field.min || value > field.max) {
      issues.push(createIssue(
        'error',
        'number_range',
        itemPath,
        `关系值必须在 ${field.min} 到 ${field.max} 之间。`,
        { value, min: field.min, max: field.max }
      ));
    }
  }
}

function referenceContains(datasets, targetKey, targetField, value) {
  const collection = datasets[targetKey];
  if (!Array.isArray(collection)) return false;
  const reference = DATASET_REFERENCES[targetKey] || {};
  const schema = DATASET_SCHEMAS[targetKey] || {};
  const keyField = targetField || reference.keyField || schema.keyField || 'id';
  return collection.some((item) => item?.[keyField] === value);
}

function validateKnownCollectionRules(datasets, issues) {
  validateModifierConsistency(datasets['world/modifiers'] || [], issues);
  validateModifierConsistency(datasets.modifiers || [], issues);
  const factionIds = collectKeys(datasets['entities/factions'] || datasets.factions, 'id');
  const terrainTypes = collectKeys(datasets['definitions/terrains'] || datasets.terrains, 'type');
  validateMapReferences(
    datasets['world/map'] || {},
    factionIds,
    terrainTypes,
    issues
  );
  validateMapReferences(datasets.map || {}, factionIds, terrainTypes, issues);
}

function validateModifierConsistency(modifiers, issues) {
  if (!Array.isArray(modifiers)) return;
  modifiers.forEach((modifier, index) => {
    if (typeof modifier.minDuration === 'number' &&
      typeof modifier.maxDuration === 'number' &&
      modifier.minDuration > modifier.maxDuration) {
      issues.push(createIssue(
        'error',
        'duration_order',
        `world/modifiers[${index}].maxDuration`,
        `世界状态 ${modifier.name || modifier.id} 的最长持续天数不能小于最短持续天数。`
      ));
    }

    for (const [key, value] of Object.entries(modifier.effects || {})) {
      if (typeof value !== 'number') {
        issues.push(createIssue(
          'error',
          'number_type',
          `world/modifiers[${index}].effects.${key}`,
          `世界状态效果值必须是数字。`
        ));
      }
    }
  });
}

function validateMapReferences(map, factionIds, terrainTypes, issues) {
  if (!map || typeof map !== 'object') return;
  if (!Array.isArray(map.tiles)) {
    issues.push(createIssue('error', 'dataset_shape', 'world/map.tiles', '地图 tiles 必须是数组。'));
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
        `world/map.tiles[${index}]`,
        `地图格子坐标重复：${coordKey}。`
      ));
    }
    seenCoords.add(coordKey);

    if (tile.terrain && !terrainTypes.has(tile.terrain)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `world/map.tiles[${index}].terrain`,
        `地图格子的地形不存在：${tile.terrain}。`
      ));
    }

    if (tile.ownerId && !factionIds.has(tile.ownerId)) {
      issues.push(createIssue(
        'error',
        'invalid_reference',
        `world/map.tiles[${index}].ownerId`,
        `地图格子的所属势力不存在：${tile.ownerId}。`
      ));
    }

    if (typeof tile.x !== 'number' || typeof tile.y !== 'number' ||
      tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      issues.push(createIssue(
        'error',
        'number_range',
        `world/map.tiles[${index}]`,
        `地图格子坐标超出地图范围。`,
        { x: tile.x, y: tile.y, width, height }
      ));
    }
  });
}

function collectKeys(value, keyField) {
  return new Set((Array.isArray(value) ? value : [])
    .map((item) => item?.[keyField])
    .filter((value) => value != null && value !== ''));
}
