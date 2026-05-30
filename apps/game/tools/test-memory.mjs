#!/usr/bin/env node
/**
 * 记忆系统单元测试（GOBT 长期心智，ADR-019）。
 * 用法：node tools/test-memory.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const imp = (p) => import(pathToFileURL(resolve(GAME_ROOT, p)).href);

const { MemorySystem, MemoryType } = await imp('js/engine/abstract/memory-system.js');
const { RelationshipGraph } = await imp('js/engine/npc/relationship.js');

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('  FAIL:', m); failed++; } };

// 环形队列容量
{
  const mem = new MemorySystem({ capacity: 3 });
  for (let i = 0; i < 5; i++) mem.add({ type: MemoryType.ATTACKED, tick: i, intensity: 50, decay: 0 });
  assert(mem.size() === 3, '环形队列超容丢弃最旧');
  assert(mem.records[0].tick === 2, '保留最近 3 条 (tick 2,3,4)');
}

// 衰减与清理
{
  const mem = new MemorySystem({ capacity: 8 });
  mem.add({ type: MemoryType.DEMOTED, tick: 0, intensity: 10, decay: 3 });
  mem.add({ type: MemoryType.SECT_DESTROYED, tick: 0, intensity: 100, decay: 0.02 });
  mem.decayTick(1); // demoted 10-3=7
  assert(mem.getStrongest(MemoryType.DEMOTED).intensity === 7, '衰减后强度正确');
  mem.decayTick(10); // demoted 7-30<0 清理
  assert(mem.getByType(MemoryType.DEMOTED).length === 0, '强度归零被清理');
  assert(mem.getByType(MemoryType.SECT_DESTROYED).length === 1, '低衰减记忆保留');
}

// 最强记忆 / 总强度
{
  const mem = new MemorySystem();
  mem.add({ type: MemoryType.BETRAYED, actorId: 'a', intensity: 30, decay: 0 });
  mem.add({ type: MemoryType.BETRAYED, actorId: 'b', intensity: 80, decay: 0 });
  assert(mem.getStrongest(MemoryType.BETRAYED).actorId === 'b', '最强记忆取强度最高');
  assert(mem.totalIntensity(MemoryType.BETRAYED) === 110, '总强度累加');
}

// 恩怨图
{
  const rel = new RelationshipGraph();
  rel.addGrudge('enemy1', 50);
  rel.addGrudge('enemy1', 30);
  rel.addGrudge('enemy2', 20);
  rel.addGratitude('savior', 70);
  assert(rel.getGrudge('enemy1') === 80, '仇恨累加');
  assert(rel.topGrudge().actorId === 'enemy1', '最深仇恨对象');
  assert(rel.topGratitude().actorId === 'savior', '最重恩义对象');
}

// 快照往返
{
  const mem = new MemorySystem({ capacity: 4 });
  mem.add({ type: MemoryType.INHERITANCE, intensity: 70, decay: 0.1, tick: 5 });
  const mem2 = new MemorySystem();
  mem2.loadFrom(mem.snapshot());
  assert(mem2.size() === 1 && mem2.getByType(MemoryType.INHERITANCE).length === 1, '记忆快照往返一致');
}

if (failed === 0) { console.log('记忆系统单元测试全部通过'); process.exit(0); }
else { console.error(`记忆系统单元测试失败：${failed} 项`); process.exit(1); }
