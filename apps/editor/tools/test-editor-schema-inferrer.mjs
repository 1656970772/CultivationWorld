#!/usr/bin/env node
/**
 * test-editor-schema-inferrer.mjs —— 验证 schema-inferrer
 *
 * 覆盖：
 * 1. 简单类型（string/number/boolean）
 * 2. 字符串 + 候选 ≤ 20 → select；> 20 → text
 * 3. 数字 min/max
 * 4. 嵌套 object
 * 5. 对象数组 union
 * 6. 字符串数组 → tags
 * 7. 多类型 → json
 * 8. 超深嵌套 → json
 * 9. 用真实 game/data 文件跑出非空 schema
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferSchema } from '../js/editor/schema-inferrer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const gameData = join(repoRoot, 'apps', 'game', 'data');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: expected ${b}, got ${a}`); }

console.log('=== schema-inferrer tests ===');

// ── 1. 简单类型 ──
console.log('\n[1] simple types');
test('string → text (single sample)', () => {
  const s = inferSchema({ name: 'foo' });
  const f = s.rootFields.find(x => x.path === 'name');
  assertEq(f.type, 'text');
});
test('boolean → boolean', () => {
  const s = inferSchema({ alive: true });
  const f = s.rootFields.find(x => x.path === 'alive');
  assertEq(f.type, 'boolean');
});
test('number → number with min/max', () => {
  // 用数组样本让同一字段出现多个值
  const s = inferSchema([{ value: 5 }, { value: 10 }, { value: 3 }]);
  const v = s.itemFields.find(x => x.path === 'value');
  assertEq(v.type, 'number');
  assertEq(v.min, 3);
  assertEq(v.max, 10);
});
test('0-1 范围 → range', () => {
  const s = inferSchema([{ ratio: 0.1 }, { ratio: 0.9 }]);
  const r = s.itemFields.find(x => x.path === 'ratio');
  assertEq(r.type, 'range');
});

// ── 2. select 推断 ──
console.log('\n[2] select inference');
test('2-20 候选 → select', () => {
  const s = inferSchema([{ type: 'revenge' }, { type: 'plunder' }, { type: 'power' }]);
  const f = s.itemFields.find(x => x.path === 'type');
  assertEq(f.type, 'select');
  assert(f.options.some(o => o.value === 'revenge'));
});
test('单候选 → text (select 无意义)', () => {
  const s = inferSchema({ name: 'foo' });
  const f = s.rootFields.find(x => x.path === 'name');
  assertEq(f.type, 'text');
});

// ── 3. 嵌套对象 ──
console.log('\n[3] nested object');
test('object → object with fields', () => {
  const s = inferSchema({
    meta: { name: 'foo', version: 1 },
  });
  const m = s.rootFields.find(x => x.path === 'meta');
  assertEq(m.type, 'object');
  assert(Array.isArray(m.fields));
  assert(m.fields.length === 2);
});

// ── 4. 对象数组 ──
console.log('\n[4] object array union');
test('objects[] 字段 union', () => {
  const s = inferSchema({
    obsessions: [
      { type: 'revenge', intensity: 80 },
      { type: 'plunder', intensity: 60, targetId: 'foo' },
    ],
  });
  const f = s.rootFields.find(x => x.path === 'obsessions');
  assertEq(f.type, 'objectArray');
  const keys = f.itemFields.map(x => x.path);
  assert(keys.includes('type'));
  assert(keys.includes('intensity'));
  assert(keys.includes('targetId'));
});

// ── 5. tags ──
console.log('\n[5] tags / arrays');
test('string[] → tags', () => {
  const s = inferSchema({ tags: ['a', 'b'] });
  const f = s.rootFields.find(x => x.path === 'tags');
  assertEq(f.type, 'tags');
});

// ── 6. 多类型 → json ──
console.log('\n[6] mixed types');
test('array 元素 number+string → json', () => {
  const s = inferSchema({ list: [1, 'a'] });
  const lf = s.rootFields[0];
  assertEq(lf.type, 'json');
});

// ── 7. 超深嵌套 → json ──
console.log('\n[7] deep nesting');
test('depth>5 → json', () => {
  // 7 层嵌套：a/b/c/d/e/f 全 object，最内 g 是 number。
  // depth 0→a, 1→b, 2→c, 3→d, 4→e, 5→f(应 json 因为 depth>=5), 6→g
  const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  const s = inferSchema(deep);
  let cur = s.rootFields[0];
  assertEq(cur.path, 'a');
  for (let i = 0; i < 4; i++) {
    cur = cur.fields[0];
    assertEq(cur.type, 'object', `level ${i + 1} (${cur.path}) should be object`);
  }
  // cur 现在是 e, e.fields[0]=f, f 应为 json（depth>=5 触发降级）
  const f = cur.fields[0];
  assertEq(f.path, 'f');
  assertEq(f.type, 'json');
});

// ── 8. 顶层数组 → objectArray ──
console.log('\n[8] top-level array');
test('顶层 array → objectArray', () => {
  const s = inferSchema([
    { id: 'a', name: 'foo' },
    { id: 'b', name: 'bar', x: 1 },
  ]);
  assertEq(s.rootType, 'objectArray');
  const keys = s.itemFields.map(x => x.path);
  assert(keys.includes('id'));
  assert(keys.includes('name'));
  assert(keys.includes('x'));
});

// ── 9. 真实 game/data 文件 ──
console.log('\n[9] real game/data files');
const realFiles = [
  'balance/obsession.json',
  'balance/utility.json',
  'balance/cultivation.json',
  'actions/npc-actions.json',
  'config/ai-config.json',
  'entities/factions.json',
  'world/modifiers.json',
  'behavior-trees/npc-default.json',
];
for (const rel of realFiles) {
  const abs = join(gameData, rel);
  if (!existsSync(abs)) {
    test(`real: ${rel} exists`, () => { throw new Error('file missing'); });
    continue;
  }
  test(`real: ${rel} → non-empty schema`, () => {
    const data = JSON.parse(readFileSync(abs, 'utf-8'));
    const s = inferSchema(data);
    if (s.rootType === 'object') {
      assert(s.rootFields.length > 0, 'expected >0 root fields');
    } else if (s.rootType === 'objectArray') {
      assert(s.itemFields.length > 0, 'expected >0 item fields');
    } else {
      assert(false, `rootType=json unexpected for ${rel}`);
    }
    console.log(`      rootType=${s.rootType} rootFields=${s.rootFields?.length || 0} itemFields=${s.itemFields?.length || 0}`);
  });
}

// ── 10. 顶层扫一遍 game/data 所有 json，确保都不抛错 ──
console.log('\n[10] all game/data files infer cleanly');
test('all *.json under game/data infer without throw', () => {
  const files = [];
  function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'desktop-dist' || e.name === '__pycache__' || e.name === '.snapshots' || e.name === 'node_modules') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) files.push(full);
    }
  }
  walk(gameData);
  let count = 0;
  for (const f of files) {
    const data = JSON.parse(readFileSync(f, 'utf-8'));
    const s = inferSchema(data);
    assert(s.rootType === 'object' || s.rootType === 'objectArray' || s.rootType === 'json');
    count++;
  }
  console.log(`      inferred ${count} files ok`);
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
