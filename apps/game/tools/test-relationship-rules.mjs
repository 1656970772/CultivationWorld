#!/usr/bin/env node
/**
 * 关系规则解释器补充测试。
 *
 * 覆盖：
 *   1) selector 返回数组时，impact pipeline 展开为多条账本写入。
 *   2) signal facts 合并遵循 true 优先，后续 false 不覆盖已成立事实。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { RelationshipSystem } = await imp('js/engine/world/relationship-system.js');

function platform(overrides = {}) {
  return {
    schemas: { ledgers: load('data/relationships/schemas/ledgers.json') },
    dictionaries: {
      marks: load('data/relationships/dictionaries/marks.json'),
      tags: load('data/relationships/dictionaries/tags.json'),
      signals: load('data/relationships/dictionaries/signal-keys.json'),
      eventTypes: load('data/relationships/dictionaries/relation-event-types.json'),
      groupTypes: load('data/relationships/dictionaries/group-types.json'),
    },
    eventHooks: [],
    impactRules: [],
    signalRules: [],
    groups: load('data/relationships/groups/groups.json'),
    ...overrides,
  };
}

let failed = 0;
const assert = (condition, message) => {
  if (!condition) { console.error('  FAIL:', message); failed++; }
  else console.log('  OK:', message);
};

console.log('1) selector 数组展开为多条账本写入');
{
  const rs = new RelationshipSystem({
    enabled: true,
    platform: platform({
      impactRules: [{
        rules: [{
          id: 'test_witnesses_gain_favor_debt',
          match: { eventType: 'test.witnesses' },
          effects: [{
            layer: 'individual',
            subject: '$event.witnesses',
            object: '$actor.id',
            changes: {
              marks: [{ type: 'favorDebt', weight: 10 }],
            },
          }],
        }],
      }],
    }),
  });

  rs.handleEvent({
    id: 'evt_witnesses',
    type: 'test.witnesses',
    actor: { id: 'npc_actor' },
    witnesses: ['npc_w1', 'npc_w2'],
    day: 3,
  });

  assert(rs.getIndividualRelation('npc_w1', 'npc_actor').marks.some(m => m.type === 'favorDebt'), 'w1 写入 favorDebt');
  assert(rs.getIndividualRelation('npc_w2', 'npc_actor').marks.some(m => m.type === 'favorDebt'), 'w2 写入 favorDebt');
  assert(rs.stats().byLayer.individual === 2, '数组 selector 展开为 2 条 individual ledger');
}

console.log('2) signal facts 合并 true 优先');
{
  const rs = new RelationshipSystem({
    enabled: true,
    platform: platform({
      signalRules: [{
        rules: [
          {
            id: 'fact_true_first',
            appliesTo: { contextType: 'action', actionId: 'act_npc_job_hunt_enemy' },
            outputs: { facts: { isWantedByFaction: true } },
          },
          {
            id: 'fact_false_later',
            appliesTo: { contextType: 'action', actionId: 'act_npc_job_hunt_enemy' },
            outputs: { facts: { isWantedByFaction: false } },
          },
        ],
      }],
    }),
  });

  const signals = rs.getSignals({
    contextType: 'action',
    actionId: 'act_npc_job_hunt_enemy',
    actor: { id: 'npc_hunter' },
    target: { id: 'npc_target' },
  });

  assert(signals.facts.isWantedByFaction === true, '后续 false 不覆盖已成立 fact=true');
}

if (failed === 0) {
  console.log('\n关系规则解释器补充测试全部通过');
  process.exit(0);
}
console.error(`\n关系规则解释器补充测试失败：${failed} 项`);
process.exit(1);
