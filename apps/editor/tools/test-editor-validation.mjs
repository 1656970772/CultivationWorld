import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { DATASET_SCHEMAS } from '../js/editor/schema-registry.js';
import { validateAllData } from '../js/editor/validation.js';

const loadJSON = (path) => JSON.parse(readFileSync(path, 'utf-8'));

const loadProjectData = () => {
  const datasets = {};
  for (const [key, schema] of Object.entries(DATASET_SCHEMAS)) {
    datasets[key] = loadJSON(schema.file);
  }
  return datasets;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const errorsOnly = (issues) => issues.filter((issue) => issue.severity === 'error');

const hasIssue = (issues, code, pathPart) =>
  issues.some((issue) => issue.code === code && issue.path.includes(pathPart));

const projectData = loadProjectData();

{
  const issues = validateAllData(projectData, DATASET_SCHEMAS);
  assert.equal(
    errorsOnly(issues).length,
    0,
    `现有 data/*.json 不应产生错误级校验问题：${JSON.stringify(errorsOnly(issues), null, 2)}`
  );
}

{
  const data = clone(projectData);
  data.factions.push(clone(data.factions[0]));

  const issues = validateAllData(data, DATASET_SCHEMAS);
  assert.ok(
    hasIssue(issues, 'duplicate_key', 'factions'),
    `重复势力 ID 应产生 duplicate_key：${JSON.stringify(issues, null, 2)}`
  );
}

{
  const data = clone(projectData);
  data.factions[0].leader = 'npc_missing';

  const issues = validateAllData(data, DATASET_SCHEMAS);
  assert.ok(
    hasIssue(issues, 'invalid_reference', 'factions[0].leader'),
    `断裂的 leader 引用应产生 invalid_reference：${JSON.stringify(issues, null, 2)}`
  );
}

{
  const data = clone(projectData);
  data.factions[0].relations.sect_002 = 150;

  const issues = validateAllData(data, DATASET_SCHEMAS);
  assert.ok(
    hasIssue(issues, 'number_range', 'factions[0].relations.sect_002'),
    `超出范围的势力关系应产生 number_range：${JSON.stringify(issues, null, 2)}`
  );
}

{
  const data = clone(projectData);
  data.npcs[0].personality.ambition = -1;

  const issues = validateAllData(data, DATASET_SCHEMAS);
  assert.ok(
    hasIssue(issues, 'number_range', 'npcs[0].personality.ambition'),
    `超出范围的 NPC 性格值应产生 number_range：${JSON.stringify(issues, null, 2)}`
  );
}

{
  const data = clone(projectData);
  data.map.tiles[0].terrain = 'missing_terrain';

  const issues = validateAllData(data, DATASET_SCHEMAS);
  assert.ok(
    hasIssue(issues, 'invalid_reference', 'map.tiles[0].terrain'),
    `断裂的地图地形引用应产生 invalid_reference：${JSON.stringify(issues, null, 2)}`
  );
}

console.log('editor validation tests passed');

