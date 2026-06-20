#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpcExecutionProfile } from './profile-npc-execution.mjs';
import { PROFILE_SCHEMA_VERSION } from './profiler/npc-execution-profiler-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GAME_ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(GAME_ROOT, 'tools/.tmp-profiler-cli-test');

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log('1) profile CLI 生成 meta / records / index');
{
  const result = await runNpcExecutionProfile({
    gameRoot: GAME_ROOT,
    days: 1,
    seed: 20260619,
    targetIds: ['npc_001'],
    outDir: OUT_DIR,
    quiet: true,
  });

  assert.equal(result.recordCount, 1);
  assert.equal(existsSync(resolve(OUT_DIR, 'meta.json')), true);
  assert.equal(existsSync(resolve(OUT_DIR, 'records.jsonl')), true);
  assert.equal(existsSync(resolve(OUT_DIR, 'index.json')), true);

  const meta = JSON.parse(readFileSync(resolve(OUT_DIR, 'meta.json'), 'utf-8'));
  assert.equal(meta.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(meta.seed, 20260619);
  assert.deepEqual(meta.targets.ids, ['npc_001']);
  assert.equal(meta.recordCount, 1);

  const lines = readFileSync(resolve(OUT_DIR, 'records.jsonl'), 'utf-8').trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.npc.id, 'npc_001');
  assert.equal(record.day, 1);
  assert.equal(record.needs.results.length > 0, true, '记录 Need 全量评估');
  assert.equal(typeof record.decision.selected.id === 'string' || record.decision.selected.id === null, true);

  const index = JSON.parse(readFileSync(resolve(OUT_DIR, 'index.json'), 'utf-8'));
  assert.equal(index.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(index.byNpc.npc_001['1'][0].line, 1);
}

rmSync(OUT_DIR, { recursive: true, force: true });

console.log('NPC execution profiler CLI tests passed');
