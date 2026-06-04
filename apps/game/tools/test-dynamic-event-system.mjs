#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { WorldEventSystem, WorldEventPhase } = await imp('js/engine/world/world-event.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); failed++; }
  else console.log('  OK:', msg);
}

const cfg = {
  enabled: true,
  events: [
    {
      id: 'evt_secret_realm_test',
      type: 'secret_realm',
      name: '青冥秘境',
      announceDay: 10,
      startDay: 20,
      endDay: 25,
      value: 1000,
      riskKey: 'plunder',
      scope: 'public',
      pos: { x: 50, y: 60 }
    }
  ]
};

const system = new WorldEventSystem(cfg);
system.seedScheduledEvents(0);

system.tick(9);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.SCHEDULED, '预告日前仍为 scheduled');

system.tick(10);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.ANNOUNCED, 'announceDay 进入 announced');

system.tick(20);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.ACTIVE, 'startDay 进入 active');

system.markPrepared('evt_secret_realm_test', 'npc_1');
system.markParticipant('evt_secret_realm_test', 'npc_1');
const snap = system.snapshot().events.find(e => e.id === 'evt_secret_realm_test');
assert(snap.preparedBy.includes('npc_1'), '准备记录进入 snapshot');
assert(snap.participants.includes('npc_1'), '参与记录进入 snapshot');

system.tick(26);
assert(system.getById('evt_secret_realm_test').phase === WorldEventPhase.RESOLVED, 'endDay 后进入 resolved');

if (failed === 0) {
  console.log('动态事件系统单测全部通过');
  process.exit(0);
}
console.error(`动态事件系统单测失败：${failed} 项`);
process.exit(1);
