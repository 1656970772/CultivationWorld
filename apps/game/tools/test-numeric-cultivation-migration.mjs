#!/usr/bin/env node

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

const mod = await import(new URL('../js/engine/npc/numeric-cultivation.js', import.meta.url).href);
const ranks = [
  { id: 'mortal', order: 0 },
  { id: 'qi_refining', order: 20, category: 'cultivation', cultivationRequired: 100, qiRequired: 50 },
  { id: 'foundation_building', order: 40, category: 'cultivation', cultivationRequired: 1000, qiRequired: 500 },
];
const data = new Map([
  ['rankId', 'mortal'],
  ['cultivationProgress', 0.3],
  ['insight', 0.2],
  ['qi', 50],
]);
const entity = {
  state: {
    get: (k) => data.get(k),
    set: (k, v) => data.set(k, v),
  },
};

mod.migrateProgressToNumericCultivation(entity, ranks);
assert(data.get('cultivation') === 30, 'cultivation converts from progress ratio');
assert(data.get('experienceCultivation') === 20, 'experienceCultivation converts from insight ratio');
assert(data.get('totalCultivation') === 50, 'totalCultivation is numeric sum');
assert(mod.canAttemptBreakthrough(entity, ranks, { minCultivationRatio: 0.3 }) === false, 'breakthrough requires total cultivation threshold');

data.set('experienceCultivation', 70);
data.set('totalCultivation', 100);
assert(mod.canAttemptBreakthrough(entity, ranks, { minCultivationRatio: 0.3 }) === true, 'breakthrough succeeds with cultivation and qi thresholds');

if (failed > 0) {
  console.error(`\nNumeric cultivation tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nNumeric cultivation tests passed');
