#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (path) => JSON.parse(readFileSync(resolve(GAME_ROOT, path), 'utf-8'));
const imp = (path) => import(pathToFileURL(resolve(GAME_ROOT, path)).href);

let failed = 0;
function assert(condition, message) {
  console.log(`  ${condition ? 'OK' : 'FAIL'}: ${message}`);
  if (!condition) failed++;
}

const aiConfig = load('data/config/ai-config.json');
const treeDefs = [
  load('data/behavior-trees/monster-tier1.json'),
  load('data/behavior-trees/monster-tier2.json'),
  load('data/behavior-trees/monster-tier3.json'),
];

const {
  BehaviorTreeRegistry,
  resolveMonsterOrderEquivalent,
  resolveMonsterBTTier,
} = await imp('js/engine/abstract/bt/bt-registry.js');
const { MonsterEntity } = await imp('js/engine/monster/monster-entity.js');

console.log('1) ai-config 显式登记妖兽 BT tier 到行为树 id 的映射');
assert(aiConfig.monster?.tierGradeMap?.tier1?.includes(1), 'tierGradeMap 保留 grade→tier 配置');
assert(aiConfig.monster?.tierBehaviorTreeMap?.tier1 === 'bt_monster_tier1', 'tier1 映射到 bt_monster_tier1');
assert(aiConfig.monster?.tierBehaviorTreeMap?.tier2 === 'bt_monster_tier2', 'tier2 映射到 bt_monster_tier2');
assert(aiConfig.monster?.tierBehaviorTreeMap?.tier3 === 'bt_monster_tier3', 'tier3 映射到 bt_monster_tier3');
assert(aiConfig.monster?.orderEquivalentMap?.['4'] === 60, 'orderEquivalentMap 配置妖兽阶位到修炼 order');

console.log('2) BehaviorTreeRegistry 从数据定义加载并按 id 返回 root');
const registry = new BehaviorTreeRegistry();
registry.loadFromConfig({ behaviorTrees: treeDefs });
for (const id of ['bt_monster_tier1', 'bt_monster_tier2', 'bt_monster_tier3']) {
  const tree = registry.getRoot(id);
  assert(tree?.type === 'sequence', `${id} 返回可构建的 root 节点`);
}

console.log('3) resolveMonsterBTTier 使用配置而非内置 grade 分支');
assert(resolveMonsterBTTier(1, aiConfig.monster) === 'tier1', 'grade 1 解析为 tier1');
assert(resolveMonsterBTTier(4, aiConfig.monster) === 'tier2', 'grade 4 解析为 tier2');
assert(resolveMonsterBTTier(9, aiConfig.monster) === 'tier3', 'grade 9 解析为 tier3');
let missingTierThrows = false;
try {
  resolveMonsterBTTier(99, { tierGradeMap: { tier1: [1] } });
} catch (err) {
  missingTierThrows = String(err?.message || '').includes('99');
}
assert(missingTierThrows, '没有配置的 grade 会显式失败，不回退硬编码规则');
assert(resolveMonsterOrderEquivalent(4, aiConfig.monster) === 60, 'grade 4 的 order 等价值来自配置');

console.log('4) MonsterEntity 从注册表解析行为树');
const rng = { next: () => 0.5 };
const monster = new MonsterEntity({
  id: 'beast_registry_test',
  name: '注册表测试妖兽',
  grade: 4,
  attributes: { hp: 100, attack: 10, defense: 5, speed: 4, qi: 0, spirit: 0 },
}, {
  id: 'monster_registry_test',
  name: '注册表测试妖兽',
  x: 0,
  y: 0,
  rng,
  aiConfig: aiConfig.monster,
  behaviorTreeRegistry: registry,
});
assert(monster._btTier === 'tier2', 'MonsterEntity 保存配置解析出的 tier2');
assert(monster._behaviorTreeId === 'bt_monster_tier2', 'MonsterEntity 保存配置映射出的行为树 id');
assert(!!monster.btRunner, 'MonsterEntity 安装了注册表行为树');

let missingRegistryThrows = false;
try {
  new MonsterEntity({
    id: 'beast_missing_registry',
    name: '缺注册表妖兽',
    grade: 1,
    attributes: { hp: 100, attack: 10, defense: 5, speed: 4, qi: 0, spirit: 0 },
  }, {
    id: 'monster_missing_registry',
    name: '缺注册表妖兽',
    x: 0,
    y: 0,
    rng,
    aiConfig: aiConfig.monster,
    behaviorTreeRegistry: new BehaviorTreeRegistry(),
  });
} catch (err) {
  missingRegistryThrows = String(err?.message || '').includes('bt_monster_tier1');
}
assert(missingRegistryThrows, '注册表缺少行为树时显式失败，不回退内置 preset');

if (failed > 0) {
  console.error(`\nBT registry tests failed: ${failed}`);
  process.exit(1);
}

console.log('\nBT registry tests passed');
