#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { NeedPool } = await imp('js/engine/pools/need-pool.js');
const { NPCEntity } = await imp('js/engine/npc/npc-entity.js');

NeedPool.clear();
NeedPool.loadFromArray(load('data/needs/npc-needs.json'));

const ranks = load('data/definitions/ranks.json');
const gameConfig = load('data/config/game-config.json');
const cultivationConfig = load('data/balance/cultivation.json');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('  FAIL:', msg);
    failed++;
  } else {
    console.log('  OK:', msg);
  }
}

function makeNpc(id, factionId = null) {
  return new NPCEntity(
    {
      id,
      name: id,
      role: 'disciple',
      rankId: 'mortal',
      factionId,
    },
    ranks,
    {
      gameConfig,
      cultivationConfig,
      aiConfig: { maxDepth: 2, maxIterations: 20 },
      rng: { next: () => 0 },
    },
  );
}

function hasDutyNeed(npc) {
  return !!npc.needSystem.getNeed('need_npc_loyalty_duty');
}

function runPreTick(npc, day = 1) {
  npc.onPreTick({ currentDay: day, day });
}

console.log('1) 散修初始化后不拥有职责 Need，且仍可接悬赏任务');
{
  const npc = makeNpc('npc_wanderer_duty_need', null);
  assert(hasDutyNeed(npc) === false, '散修没有 need_npc_loyalty_duty');
  assert(!!npc.needSystem.getNeed('need_npc_survival'), '散修仍拥有其他默认 Need');
  assert(!!npc.needSystem.getNeed('need_npc_wanderer_subsistence'), '散修仍拥有散修生计 Need');
  assert(npc.state.get('canTakeQuest') === true, '散修仍可接悬赏任务');
}

console.log('2) 有宗门 NPC 初始化后拥有职责 Need');
{
  const npc = makeNpc('npc_sect_duty_need', 'sect_test');
  assert(hasDutyNeed(npc) === true, '宗门 NPC 拥有 need_npc_loyalty_duty');
  assert(!!npc.needSystem.getNeed('need_npc_survival'), '宗门 NPC 仍拥有其他默认 Need');
}

console.log('3) 宗门归属变化后同步职责 Need');
{
  const npc = makeNpc('npc_sync_duty_need', null);
  npc.state.set('factionId', 'sect_test');
  npc.state.set('hasFaction', true);
  npc.state.set('isWanderer', false);
  runPreTick(npc);
  assert(hasDutyNeed(npc) === true, '加入宗门后获得 need_npc_loyalty_duty');

  npc.state.set('factionId', null);
  npc.state.set('hasFaction', false);
  npc.state.set('isWanderer', true);
  runPreTick(npc, 2);
  assert(hasDutyNeed(npc) === false, '离开宗门后移除 need_npc_loyalty_duty');
  assert(npc.state.get('canTakeQuest') === true, '离开宗门后仍可接悬赏任务');
}

console.log('4) factionId 残留但已无宗门身份时不拥有职责 Need');
{
  const npc = makeNpc('npc_destroyed_sect_duty_need', 'sect_test');
  assert(hasDutyNeed(npc) === true, '初始宗门 NPC 拥有职责 Need');
  npc.state.set('hasFaction', false);
  npc.state.set('isWanderer', true);
  runPreTick(npc);
  assert(hasDutyNeed(npc) === false, '宗门身份失效后即使 factionId 残留也移除职责 Need');
  assert(npc.state.get('factionId') === 'sect_test', '测试保留 factionId 作为覆灭/记忆上下文');
}

if (failed > 0) {
  console.error(`\nNPC 职责 Need 赋予测试失败：${failed} 项`);
  process.exit(1);
}

console.log('\nNPC 职责 Need 赋予测试通过');
