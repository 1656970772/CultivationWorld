#!/usr/bin/env node
/**
 * test-editor-snapshot.mjs —— 验证 snapshot-store 备份/列表/恢复
 *
 * 关键测试：
 * 1. 路径生成：<editorRoot>/.snapshots/<keyDir>/<ts>-<rand6>.json
 * 2. backup 写盘，字节级一致
 * 3. list 按 ts 倒序
 * 4. read 字节级一致
 * 5. prune / pruneOlderThan
 * 6. 用真实 game/data 文件做备份-修改-恢复 round-trip
 *    (备份 obsession.json → 改值 → 恢复 → 字节级等于原文件)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backup,
  list,
  read,
  prune,
  pruneOlderThan,
  keyToDirName,
  dirNameToKey,
  generateSnapshotName,
  parseSnapshotName,
  byteHash,
} from '../js/editor/snapshot-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const gameData = join(repoRoot, 'apps', 'game', 'data');
const editorRoot = join(repoRoot, 'apps', 'editor');
const tmpRoot = join(editorRoot, '.test-snapshots-tmp');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// 准备临时目录
mkdirSync(tmpRoot, { recursive: true });
function reset() {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
}

console.log('=== snapshot-store tests ===');
console.log(`tmp: ${tmpRoot}`);

// ── 1. 路径/命名 ──
console.log('\n[1] path & naming');
test('keyToDirName: / → __', () => {
  assertEq(keyToDirName('balance/obsession'), 'balance__obsession');
  assertEq(keyToDirName('a/b/c'), 'a__b__c');
  assertEq(keyToDirName('single'), 'single');
});
test('dirNameToKey: 逆向', () => {
  assertEq(dirNameToKey('balance__obsession'), 'balance/obsession');
});
test('generateSnapshotName: 格式', () => {
  const n = generateSnapshotName(new Date(2026, 5, 1, 18, 45, 23));
  assert(/^\d{8}-\d{6}-[a-z0-9]{6}\.json$/.test(n), `bad format: ${n}`);
  assert(n.startsWith('20260601-184523-'));
});
test('parseSnapshotName', () => {
  const p = parseSnapshotName('20260601-184523-a8c2f1.json');
  assert(p && p.ts.getFullYear() === 2026);
  assert(p && p.ts.getMonth() === 5); // 0-indexed
  assertEq(p && p.rand, 'a8c2f1');
});
test('parseSnapshotName: 无效返回 null', () => {
  assert(parseSnapshotName('foo.json') === null);
});
test('byteHash 稳定', () => {
  const a = byteHash(Buffer.from('hello'));
  const b = byteHash(Buffer.from('hello'));
  assertEq(a, b);
  assert(a.length === 12);
});

// ── 2. backup 写盘 ──
console.log('\n[2] backup');
test('backup 写到正确路径', () => {
  reset();
  const info = backup(tmpRoot, 'balance/obsession', '{"a":1}');
  assert(existsSync(info.path));
  // Windows 路径分隔符兼容
  const norm = info.path.replace(/\\/g, '/');
  assert(norm.includes('.snapshots/balance__obsession/'), `bad path: ${info.path}`);
  assert(info.size > 0);
});
test('backup 字节级一致', () => {
  reset();
  const content = Buffer.from('测试 + 😀 + {"x":1}', 'utf-8');
  const info = backup(tmpRoot, 'config/ai-config', content);
  const readBack = readFileSync(info.path);
  assert(Buffer.compare(readBack, content) === 0);
});
test('多次 backup 时间递增', async () => {
  reset();
  const a = backup(tmpRoot, 'k', '{"v":1}');
  await new Promise(r => setTimeout(r, 1100));
  const b = backup(tmpRoot, 'k', '{"v":2}');
  assert(b.ts.getTime() > a.ts.getTime(), 'b should be later than a');
});

// ── 3. list ──
console.log('\n[3] list');
test('list 倒序', async () => {
  reset();
  backup(tmpRoot, 'k', '1');
  await new Promise(r => setTimeout(r, 1100));
  backup(tmpRoot, 'k', '2');
  await new Promise(r => setTimeout(r, 1100));
  backup(tmpRoot, 'k', '3');
  const all = list(tmpRoot, 'k');
  assertEq(all.length, 3);
  // 最新在最前
  assert(all[0].name > all[1].name, `not desc: ${all[0].name} should be > ${all[1].name}`);
});
test('list 区分 dataset', () => {
  reset();
  backup(tmpRoot, 'a/b', 'x');
  backup(tmpRoot, 'c/d', 'y');
  const a = list(tmpRoot, 'a/b');
  const c = list(tmpRoot, 'c/d');
  assertEq(a.length, 1);
  assertEq(c.length, 1);
  assert(a[0].path.includes('a__b'));
  assert(c[0].path.includes('c__d'));
});
test('list 空 dataset 返回 []', () => {
  reset();
  assertEq(list(tmpRoot, 'never/created').length, 0);
});

// ── 4. read / prune ──
console.log('\n[4] read / prune');
test('read 字节一致', () => {
  reset();
  const buf = Buffer.from('测试 byte read');
  const info = backup(tmpRoot, 'k', buf);
  const back = read(tmpRoot, 'k', info.name);
  assert(back && Buffer.compare(back, buf) === 0);
});
test('read 不存在的快照 → null', () => {
  reset();
  assert(read(tmpRoot, 'k', 'nope.json') === null);
});
test('prune 单个', () => {
  reset();
  const a = backup(tmpRoot, 'k', '1');
  const b = backup(tmpRoot, 'k', '2');
  prune(tmpRoot, 'k', a.name);
  const all = list(tmpRoot, 'k');
  assertEq(all.length, 1);
  assertEq(all[0].name, b.name);
});
test('prune all', () => {
  reset();
  backup(tmpRoot, 'k', '1');
  backup(tmpRoot, 'k', '2');
  prune(tmpRoot, 'k', 'all');
  assertEq(list(tmpRoot, 'k').length, 0);
});

// ── 5. 真实 game/data round-trip ──
console.log('\n[5] real game/data round-trip');
test('备份 obsession.json → 改值 → 字节级恢复', () => {
  reset();
  const key = 'balance/obsession';
  const abs = join(gameData, key + '.json');
  const original = readFileSync(abs);
  // 备份
  const info = backup(tmpRoot, key, original);
  assert(info.size === original.length, `backup size ${info.size} != orig ${original.length}`);
  // 改值
  const data = JSON.parse(original.toString('utf-8'));
  const origValue = data.enabled;
  data.enabled = !origValue;
  writeFileSync(abs, JSON.stringify(data, null, 2));
  // 恢复
  const snap = read(tmpRoot, key, info.name);
  writeFileSync(abs, snap);
  // 字节级比较
  const after = readFileSync(abs);
  assert(Buffer.compare(after, original) === 0, 'after restore, byte mismatch');
  // 验证
  const parsed = JSON.parse(after.toString('utf-8'));
  assertEq(parsed.enabled, origValue);
});
test('备份 npc-actions.json（24K 大文件）字节级恢复', () => {
  reset();
  const key = 'actions/npc-actions';
  const abs = join(gameData, key + '.json');
  const original = readFileSync(abs);
  const info = backup(tmpRoot, key, original);
  assert(info.size === original.length);
  const snap = read(tmpRoot, key, info.name);
  assert(Buffer.compare(snap, original) === 0, '24k snap byte mismatch');
});
test('pruneOlderThan: 把 mtime 改成旧，验证被删', async () => {
  reset();
  const a = backup(tmpRoot, 'k', '1');
  // 强制把 mtime 改到 100 天前
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const fs = req('node:fs');
  const old = Date.now() - 100 * 86400_000;
  fs.utimesSync(a.path, new Date(old), new Date(old));
  backup(tmpRoot, 'k', '2'); // 新的留下
  const removed = pruneOlderThan(tmpRoot, 'k', 30);
  assertEq(removed, 1, `expected 1 removed, got ${removed}`);
  const all = list(tmpRoot, 'k');
  assertEq(all.length, 1);
});

// ── 6. 清理 ──
rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
