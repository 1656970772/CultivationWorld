#!/usr/bin/env node
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PROFILE_SCHEMA_VERSION,
  buildNpcExecutionRecord,
  buildProfilerIndexEntry,
  buildProfilerMeta,
} from './profiler/npc-execution-profiler-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_GAME_ROOT = resolve(__dirname, '..');

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function numberArg(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function splitIds(value) {
  if (!value) return [];
  return value.split(',').map(id => id.trim()).filter(Boolean);
}

function defaultOutDir(gameRoot, { seed, days, targetIds, includeAllNpcs }) {
  const target = includeAllNpcs ? 'all-npcs' : targetIds.join('_') || 'all-npcs';
  const safeTarget = target.replace(/[^\w.-]+/g, '_').slice(0, 80);
  return resolve(gameRoot, `tools/profiles/${seed}-${days}-${safeTarget}`);
}

export async function runNpcExecutionProfile({
  gameRoot = DEFAULT_GAME_ROOT,
  days = 1000,
  seed = 20260619,
  targetIds = [],
  includeAllNpcs = targetIds.length === 0,
  outDir = null,
  quiet = false,
} = {}) {
  const resolvedGameRoot = resolve(gameRoot);
  const resolvedOutDir = outDir
    ? resolve(outDir)
    : defaultOutDir(resolvedGameRoot, { seed, days, targetIds, includeAllNpcs });
  mkdirSync(resolvedOutDir, { recursive: true });

  const { loadGameConfigsFromManifest } = await import(
    pathToFileURL(resolve(resolvedGameRoot, 'js/core/data-manifest-loader.js')).href
  );
  const { WorldEngine } = await import(
    pathToFileURL(resolve(resolvedGameRoot, 'js/engine/world-engine.js')).href
  );

  const loadJson = relativePath => readJson(resolve(resolvedGameRoot, relativePath));
  const configs = await loadGameConfigsFromManifest(loadJson('data/config/data-manifest.json'), { loadJson });
  configs.seed = seed >>> 0;

  const engine = new WorldEngine();
  const initResult = engine.init(configs);
  const recordsPath = resolve(resolvedOutDir, 'records.jsonl');
  const writer = createWriteStream(recordsPath, { encoding: 'utf-8' });
  const index = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    recordsFile: 'records.jsonl',
    lineBase: 1,
    byNpc: {},
  };

  let line = 0;
  let recordCount = 0;
  const targetSet = new Set(targetIds);

  if (!quiet) {
    console.log(`NPC Profiler 初始化: ${initResult.totalFactions} 势力, ${initResult.totalNPCs} NPC`);
    console.log(`模拟种子: ${engine.seed}`);
    console.log(`输出目录: ${resolvedOutDir}`);
  }

  for (let day = 1; day <= days; day++) {
    const tickLog = engine.tick();
    const npcLogsById = new Map((tickLog.npcUpdates || []).map(update => [update.entityId, update]));
    const npcs = includeAllNpcs
      ? engine.entityRegistry.getByType('npc')
      : targetIds.map(id => engine.entityRegistry.getById(id)).filter(Boolean);

    for (const npc of npcs) {
      if (!npc || npc.type !== 'npc') continue;
      const npcId = npc.id;
      if (!includeAllNpcs && !targetSet.has(npcId)) continue;
      const npcLog = npcLogsById.get(npcId) || npc._tickLog || null;
      const record = buildNpcExecutionRecord({
        day,
        seed: engine.seed,
        npc,
        npcLog,
        tickLog,
        configs,
      });
      line += 1;
      recordCount += 1;
      writer.write(`${JSON.stringify(record)}\n`);

      const entry = buildProfilerIndexEntry({
        npcId,
        day,
        line,
        actionId: record.execution?.action?.id || record.execution?.result?.actionId || null,
        needId: record.decision?.selected?.id || null,
      });
      if (!index.byNpc[npcId]) index.byNpc[npcId] = {};
      if (!index.byNpc[npcId][String(day)]) index.byNpc[npcId][String(day)] = [];
      index.byNpc[npcId][String(day)].push(entry);
    }

    if (!quiet && day % 100 === 0) {
      console.log(`  进度: ${day}/${days}，records=${recordCount}`);
    }
  }

  writer.end();
  await once(writer, 'finish');

  const meta = buildProfilerMeta({
    seed: engine.seed,
    days,
    targetIds,
    includeAllNpcs,
    recordCount,
  });
  writeFileSync(resolve(resolvedOutDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
  writeFileSync(resolve(resolvedOutDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf-8');

  if (!quiet) {
    console.log(`完成: ${days} 天, records=${recordCount}`);
    console.log(`meta: ${resolve(resolvedOutDir, 'meta.json')}`);
    console.log(`records: ${recordsPath}`);
    console.log(`index: ${resolve(resolvedOutDir, 'index.json')}`);
  }

  return {
    outDir: resolvedOutDir,
    recordCount,
    recordsPath,
    metaPath: resolve(resolvedOutDir, 'meta.json'),
    indexPath: resolve(resolvedOutDir, 'index.json'),
  };
}

async function main() {
  const gameRoot = resolve(argValue('gameRoot', DEFAULT_GAME_ROOT));
  const days = numberArg(argValue('days', '1000'), 1000);
  const seed = numberArg(argValue('seed', '20260619'), 20260619);
  const idArg = argValue('id', null);
  const targetIds = splitIds(idArg);
  const includeAllNpcs = hasFlag('all') || targetIds.length === 0;
  const outDir = argValue('out', null);

  await runNpcExecutionProfile({
    gameRoot,
    days,
    seed,
    targetIds,
    includeAllNpcs,
    outDir,
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
