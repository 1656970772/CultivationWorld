#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function readRecordLines(recordsPath) {
  const raw = existsSync(recordsPath) ? readFileSync(recordsPath, 'utf-8') : '';
  return raw.split(/\r?\n/).filter(Boolean);
}

export function queryNpcProfile({
  profileDir,
  npcId,
  day = null,
} = {}) {
  if (!profileDir) throw new Error('profileDir is required');
  if (!npcId) throw new Error('npcId is required');

  const resolvedProfileDir = resolve(profileDir);
  const index = readJsonIfExists(resolve(resolvedProfileDir, 'index.json'));
  const recordsFile = index?.recordsFile || 'records.jsonl';
  const recordsPath = resolve(resolvedProfileDir, recordsFile);
  const lines = readRecordLines(recordsPath);

  const candidateLines = candidateLineNumbers(index, npcId, day);
  const selectedLines = candidateLines.length > 0
    ? candidateLines.map(line => lines[line - 1]).filter(Boolean)
    : lines;

  return selectedLines
    .map(line => JSON.parse(line))
    .filter(record => record?.npc?.id === npcId)
    .filter(record => day == null || Number(record.day) === Number(day));
}

export function summarizeNpcRecord(record) {
  const blockers = record?.needs?.blockersAboveCultivation || [];
  return {
    day: record?.day ?? null,
    npcId: record?.npc?.id ?? null,
    npcName: record?.npc?.name ?? null,
    selectedNeed: record?.decision?.selected?.name ?? null,
    selectedPriority: record?.decision?.selected?.priority ?? null,
    action: record?.execution?.action?.name ?? null,
    cultivationRank: record?.needs?.cultivationRank ?? null,
    blockersAboveCultivation: blockers.map(item => `${item.name || item.id}(${item.priority})`),
    result: record?.execution?.result?.description
      || record?.execution?.result?.reason
      || record?.execution?.status
      || null,
  };
}

function candidateLineNumbers(index, npcId, day) {
  const byDay = index?.byNpc?.[npcId];
  if (!byDay) return [];
  if (day != null) {
    return (byDay[String(day)] || []).map(entry => Number(entry.line)).filter(Number.isFinite);
  }
  return Object.values(byDay)
    .flat()
    .map(entry => Number(entry.line))
    .filter(Number.isFinite);
}

function main() {
  const profileDir = argValue('profile', null);
  const npcId = argValue('id', null);
  const dayArg = argValue('day', null);
  const day = dayArg == null ? null : Number(dayArg);
  const summary = hasFlag('summary');
  const records = queryNpcProfile({ profileDir, npcId, day });
  const output = summary ? records.map(summarizeNpcRecord) : records;
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
