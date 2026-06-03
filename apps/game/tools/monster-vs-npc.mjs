#!/usr/bin/env node
/**
 * 凡人/低阶修士 vs 妖兽 血量·攻击对比 —— 用于判断妖兽伤害是否过高。
 * 纯数据计算（不跑模拟），复用 combat.json / monsters.json / ranks.json 的真实公式。
 *
 * 公式（取自 monster-entity._attack + combat-pipeline.applyDamage）：
 *   妖兽 power = strength + speed*0.5 + defense + grade*30
 *   单击伤害   = power × (1 - npcDef) × dmgRoll(0.8~1.2)   // 这里取均值 1.0 与最大 1.2
 *   orderGap   = 妖兽等效order(GRADE_TO_ORDER) - npcOrder
 *   碾压       = orderGap ≥ crushOrderGap 或 单击 ≥ maxHp × crushHpMultiple
 *   一击必杀   = 单击 ≥ maxHp（凡人无锁血道具时致死即死）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf-8'));

const monsters = J('data/definitions/monsters.json');
const combat = J('data/balance/combat.json');
const ranks = J('data/definitions/ranks.json');

const GRADE_TO_ORDER = { 1: 20, 2: 35, 3: 45, 4: 60, 5: 65, 6: 70, 7: 75, 8: 80, 9: 85 };
const baseHp = combat.npcHp.baseHp;
const baseDef = combat.npcCombat.baseDef;
const crushOrderGap = combat.lockHp.crushOrderGap;
const crushHpMultiple = combat.lockHp.crushHpMultiple;

const orderOf = {};
for (const r of ranks) orderOf[r.id] = r.order;

const monsterPower = (m) => {
  const a = m.attributes || {};
  return (a.strength || 0) + (a.speed || 0) * 0.5 + (a.defense || 0) + m.grade * 30;
};

// 对比的修士境界
const realms = ['mortal', 'qi_refining', 'foundation_building'];
const realmName = { mortal: '凡人', qi_refining: '炼气', foundation_building: '筑基' };

console.log('========== 碾压/锁血阈值 ==========');
console.log(`  crushOrderGap=${crushOrderGap}（order差≥此值即碾压，锁血/遁地失效）`);
console.log(`  crushHpMultiple=${crushHpMultiple}（单击≥maxHp×此值即碾压）`);
console.log('');

for (const realm of realms) {
  const maxHp = baseHp[realm];
  const def = baseDef[realm];
  const npcOrder = orderOf[realm] ?? 0;
  console.log(`========== ${realmName[realm]}（order=${npcOrder}, maxHp=${maxHp}, 减伤=${(def * 100).toFixed(0)}%）受击对比 ==========`);
  console.log('  妖兽(grade)           power  期望单击  最大单击  占血%   orderGap  碾压?  几击毙命');

  // 只看 grade 1-3（低阶在安全带能遇到的）
  const lowMonsters = monsters.filter(m => m.grade <= 3).sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id));
  for (const m of lowMonsters) {
    const power = monsterPower(m);
    const avgDmg = power * (1 - def) * 1.0;
    const maxDmg = power * (1 - def) * 1.2;
    const orderGap = (GRADE_TO_ORDER[m.grade] ?? 0) - npcOrder;
    const crushByOrder = orderGap >= crushOrderGap;
    const crushByHp = maxDmg >= maxHp * crushHpMultiple;
    const crush = crushByOrder || crushByHp;
    const hitsToKill = Math.max(1, Math.ceil(maxHp / Math.max(1, avgDmg)));
    const pct = ((avgDmg / maxHp) * 100).toFixed(0);
    const crushTag = crush ? (crushByOrder ? '碾压(阶差)' : '碾压(伤害)') : '-';
    const name = `${m.name}(g${m.grade})`.padEnd(18, '　');
    console.log(`  ${name} ${String(Math.round(power)).padStart(5)} ${String(Math.round(avgDmg)).padStart(8)} ${String(Math.round(maxDmg)).padStart(8)} ${(pct + '%').padStart(6)} ${String(orderGap).padStart(8)}  ${crushTag.padEnd(10)} ${hitsToKill}击`);
  }
  console.log('');
}

console.log('========== 解读 ==========');
console.log('  · "占血%">=100% 或 "几击毙命"=1 → 一击即死（凡人无锁血道具时直接陨落）');
console.log('  · 碾压(阶差) → 即使持遁地/锁血符也失效，必死');
console.log('  · 凡人 order=0、maxHp=30、0 减伤，是全局最脆者；安全带仍刷 grade1-2，对凡人即越级威胁');
