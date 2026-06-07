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

console.log('1) NPC detailed grouped status is Chinese and bounded');
{
  const npc = {
    name: '鬼面',
    alive: true,
    rankName: '元婴',
    rankId: 'nascent_soul',
    factionId: 'sect_001',
    ageYears: 128,
    maxAgeYears: 800,
    hp: 60,
    maxHp: 120,
    injuryLevel: 2,
    actionStatus: 'executing',
    spatial: { tileX: 22, tileY: 147 },
    qi: 25000,
    nextQiRequired: 50000,
    cultivation: 35000,
    experienceCultivation: 22000,
    totalCultivation: 57000,
    nextCultivationRequired: 100000,
    retreatCultivationCap: 40000,
    role: 'elder',
    gender: 'male',
    contribution: 39,
    totalQuestsCompleted: 6,
  };
  assert.deepEqual(getLifeStatus(npc, 'npc'), { label: '存活', tone: 'alive' });
  assert.deepEqual(getActionStatus(npc, 'npc'), { label: '执行中', tone: 'busy' });

  const model = buildTrackedStatusModel(npc, 'npc', {
    factions: { sect_001: { name: '青云宗' } },
    day: 1738,
  });
  assert.equal(model.title, '鬼面');
  assert.equal(model.subtitle, '人物 · 元婴 · 青云宗');
  assert.ok(model.sections.length >= 6);

  const html = statusModelToHtml(model);
  hasText(html, '<details');
  hasText(html, '生命与寿元');
  hasText(html, '气血');
  hasText(html, '60/120（50% · 受伤）');
  hasText(html, '真气与修炼');
  hasText(html, '25000/50000（50% · 积累中）');
  hasText(html, '总修为');
  hasText(html, '57000/100000（57% · 积累中）');
  hasText(html, '闭关修为');
  hasText(html, '35000/40000（88% · 接近上限）');
  hasText(html, '历练修为');
  hasText(html, '22000/100000（22% · 不足）');
  hasText(html, '执行中');
  hasText(html, '长老');
  assert.ok(!html.includes('NPC ·'), 'subtitle avoids visible English NPC');
  assert.ok(!html.includes('>executing<'), 'action status is localized');
  assert.ok(!html.includes('>elder<'), 'role is localized');
}

console.log('2) dead NPC shows dead and no action');
{
  const npc = { name: '赵信', alive: false, rankName: '金丹', actionStatus: 'executing' };
  assert.deepEqual(getLifeStatus(npc, 'npc'), { label: '死亡', tone: 'dead' });
  assert.deepEqual(getActionStatus(npc, 'npc'), { label: '无行动', tone: 'idle' });
}

console.log('3) monster and faction status is localized');
{
  const monster = {
    name: '赤鳞兽',
    alive: true,
    gradeName: '三阶',
    family: '鳞兽',
    behaviorState: 'hunt',
    spatial: { tileX: 9, tileY: 12 },
  };
  assert.deepEqual(getActionStatus(monster, 'monster'), { label: '狩猎', tone: 'busy' });
  const faction = { name: '血河门', alive: false, isDestroyed: true, type: 'evil', resources: { disciples: 0 } };
  assert.deepEqual(getLifeStatus(faction, 'faction'), { label: '覆灭', tone: 'dead' });
  assert.deepEqual(getActionStatus(faction, 'faction'), { label: '无行动', tone: 'idle' });
}

console.log('4) empty model is safe');
{
  const model = buildTrackedStatusModel(null, 'npc', {});
  assert.equal(model.title, '未跟随');
  assert.equal(model.subtitle, '选择人物、妖兽或势力后显示状态');
  hasText(statusModelToHtml(model), '未跟随');
}

console.log('5) entity list status uses life and action together');
{
  const npc = { name: '李妙真', alive: true, actionStatus: 'idle' };
  assert.deepEqual(getLifeStatus(npc, 'npc'), { label: '存活', tone: 'alive' });
  assert.deepEqual(getActionStatus(npc, 'npc'), { label: '空闲', tone: 'idle' });
  const deadNpc = { name: '李妙真', alive: false, actionStatus: 'executing' };
  assert.deepEqual(getLifeStatus(deadNpc, 'npc'), { label: '死亡', tone: 'dead' });
  assert.deepEqual(getActionStatus(deadNpc, 'npc'), { label: '无行动', tone: 'idle' });
}

console.log('6) status html escapes model strings by default');
{
  const npc = {
    name: '<img src=x onerror=1>',
    alive: true,
    rankName: '<script>alert(1)</script>',
    actionStatus: '<run>',
    spatial: { tileX: 1, tileY: 2 },
  };
  const html = statusModelToHtml(buildTrackedStatusModel(npc, 'npc', {}));
  assert.ok(html.includes('&lt;img src=x onerror=1&gt;'), 'name is escaped');
  assert.ok(!html.includes('<img src=x onerror=1>'), 'raw image tag is not emitted');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'rank is escaped');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag is not emitted');
  assert.ok(html.includes('未知行为'), 'unknown action status is localized');
  assert.ok(!html.includes('&lt;run&gt;'), 'raw action status is not emitted');
}

console.log('7) missing upper bounds degrade to Chinese unknown state');
{
  const npc = {
    name: '沧牙',
    alive: true,
    rankName: '筑基',
    actionStatus: 'unknown_state',
    qi: 1110,
    cultivation: 170,
    spatial: { tileX: 84, tileY: 23 },
  };
  const html = statusModelToHtml(buildTrackedStatusModel(npc, 'npc', {}));
  hasText(html, '未知行为');
  hasText(html, '1110');
  hasText(html, '上限未知');
  assert.ok(!html.includes('>unknown_state<'), 'unknown raw action is not shown');
}

console.log('Follow entity status UI tests passed');
