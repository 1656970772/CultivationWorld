import assert from 'node:assert/strict';
import {
  buildTrackedStatusModel,
  getActionStatus,
  getLifeStatus,
  statusModelToHtml,
} from '../js/ui/follow-entity-status.js';

function hasText(html, text) {
  assert.ok(html.includes(text), `expected html to include ${text}`);
}

console.log('1) NPC life/action status');
{
  const npc = {
    name: '鬼面',
    alive: true,
    rankName: '元婴',
    factionId: 'sect_001',
    ageYears: 128,
    maxAgeYears: 800,
    actionStatus: 'executing',
    spatial: { tileX: 22, tileY: 147 },
    qi: 80,
    cultivationProgress: 42,
  };
  assert.deepEqual(getLifeStatus(npc, 'npc'), { label: '存活', tone: 'alive' });
  assert.deepEqual(getActionStatus(npc, 'npc'), { label: 'executing', tone: 'busy' });
  const model = buildTrackedStatusModel(npc, 'npc', {
    factions: { sect_001: { name: '青云宗' } },
    day: 1738,
  });
  assert.equal(model.title, '鬼面');
  assert.equal(model.subtitle, 'NPC · 元婴 · 青云宗');
  assert.equal(model.sections.length, 4);
  hasText(statusModelToHtml(model), '生命');
  hasText(statusModelToHtml(model), '行为');
  hasText(statusModelToHtml(model), '位置');
}

console.log('2) dead NPC shows dead and no action');
{
  const npc = { name: '赵信', alive: false, rankName: '金丹', actionStatus: 'executing' };
  assert.deepEqual(getLifeStatus(npc, 'npc'), { label: '死亡', tone: 'dead' });
  assert.deepEqual(getActionStatus(npc, 'npc'), { label: '无行动', tone: 'idle' });
}

console.log('3) monster and faction status');
{
  const monster = {
    name: '赤鳞兽',
    alive: true,
    gradeName: '三阶',
    family: '鳞兽',
    behaviorState: 'hunt',
    spatial: { tileX: 9, tileY: 12 },
  };
  assert.deepEqual(getActionStatus(monster, 'monster'), { label: 'hunt', tone: 'busy' });
  const faction = { name: '血河门', alive: false, isDestroyed: true, type: 'evil', resources: { disciples: 0 } };
  assert.deepEqual(getLifeStatus(faction, 'faction'), { label: '覆灭', tone: 'dead' });
  assert.deepEqual(getActionStatus(faction, 'faction'), { label: '无行动', tone: 'idle' });
}

console.log('4) empty model is safe');
{
  const model = buildTrackedStatusModel(null, 'npc', {});
  assert.equal(model.title, '未跟随');
  assert.equal(model.subtitle, '选择 NPC、妖兽或势力后显示状态');
  hasText(statusModelToHtml(model), '未跟随');
}

console.log('5) entity list status uses life and action together');
{
  const npc = { name: '李妙真', alive: true, actionStatus: 'idle' };
  assert.deepEqual(getLifeStatus(npc, 'npc'), { label: '存活', tone: 'alive' });
  assert.deepEqual(getActionStatus(npc, 'npc'), { label: 'idle', tone: 'idle' });
  const deadNpc = { name: '李妙真', alive: false, actionStatus: 'executing' };
  assert.deepEqual(getLifeStatus(deadNpc, 'npc'), { label: '死亡', tone: 'dead' });
  assert.deepEqual(getActionStatus(deadNpc, 'npc'), { label: '无行动', tone: 'idle' });
}

console.log('Follow entity status UI tests passed');
