#!/usr/bin/env node
/**
 * 通用 Effect 多来源复用验证（ADR-042 阶段2 增强）。
 *
 * 证明：同一批通用 Effect 原语（ge_add_qi / ge_add_hp / ge_add_progress）被【不同来源】
 * （聚气丹 / 灵果 / 强者精血）复用，且各自数值【从各自 items.json 的 effects 字段读取】，
 * 而非写死在 Effect 里。用真实 WorldEngine 引导（真实 NPC、真实配置），纯观察，无作弊。
 *
 * 用法：node tools/verify-effect-reuse.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const { loadGameConfigsFromManifest } = await import(
  pathToFileURL(resolve(GAME_ROOT, 'js/core/data-manifest-loader.js')).href
);
const { WorldEngine } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/world-engine.js')).href);
const { applyItemEffects } = await import(pathToFileURL(resolve(GAME_ROOT, 'js/engine/npc/npc-economy.js')).href);

let failed = 0;
const assert = (cond, msg) => { if (!cond) { console.error('  FAIL:', msg); failed++; } else { console.log('  OK:', msg); } };
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const engine = new WorldEngine();
engine.init({
  ...(await loadGameConfigsFromManifest(load('data/config/data-manifest.json'), { loadJson: load })),
  seed: 12345,
});

// 取一个真实凡人 NPC 作为试验对象（凡人 → rankDecay step=0，聚气丹 qi 增量应=120）。
const npc = engine.entityRegistry.getAliveByType('npc').find(n => (n.state.get('rankId') || 'mortal') === 'mortal');
if (!npc) { console.error('找不到凡人 NPC，无法验证'); process.exit(1); }

console.log(`[verify-effect-reuse] 试验对象=${npc.id} 境界=${npc.state.get('rankId')}`);

// 1) 聚气丹：ge_add_qi(120, rankDecay base=qi_refining) + ge_add_progress(0.01×nextCultivationRequired)
{
  const qi0 = npc.state.get('qi') || 0;
  const cultivation0 = npc.state.get('cultivation') || 0;
  const { applied, deltas } = applyItemEffects(npc, 'item_qi_pill');
  assert(applied, '聚气丹 effects 成功施加');
  // 凡人 order < qi_refining order，rankDecay step 夹 0（max(0,负)=0）→ 120
  assert(approx(deltas.qi, 120), `聚气丹 ge_add_qi 增量=120（实得 ${deltas.qi}，凡人 step=0）`);
  assert(approx(deltas.cultivation ?? 0, 0.5), `聚气丹 ge_add_progress 修为增量=0.5（实得 ${deltas.cultivation}）`);
  assert(approx((npc.state.get('qi') || 0) - qi0, deltas.qi), '聚气丹真气真实落地到 state');
  assert(approx((npc.state.get('cultivation') || 0) - cultivation0, deltas.cultivation), '聚气丹修为真实落地到 state');
}

// 2) 灵果：ge_add_qi(40) + ge_add_hp(0.3 ratioOfMaxHp，夹 maxHp)
{
  const maxHp = npc.state.get('maxHp') || 0;
  npc.state.set('hp', Math.max(1, Math.floor(maxHp * 0.5)));  // 先压到半血，便于观察加血
  const hp0 = npc.state.get('hp') || 0;
  const { deltas } = applyItemEffects(npc, 'item_spirit_fruit');
  assert(approx(deltas.qi, 40), `灵果 ge_add_qi 增量=40（复用同一 Effect，数值取自灵果配置；实得 ${deltas.qi}）`);
  const expectHpDelta = Math.min(maxHp, hp0 + maxHp * 0.3) - hp0;
  assert(approx(deltas.hp, expectHpDelta), `灵果 ge_add_hp 增量=${expectHpDelta.toFixed(2)}（0.3×maxHp，夹 maxHp；实得 ${deltas.hp}）`);
}

// 3) 灵果加血夹 maxHp：满血时再吃灵果，hp 不应超 maxHp（clamp "maxHp" 生效）
{
  const maxHp = npc.state.get('maxHp') || 0;
  npc.state.set('hp', maxHp);
  const { deltas } = applyItemEffects(npc, 'item_spirit_fruit');
  assert(approx(deltas.hp, 0), `满血吃灵果 hp 增量=0（clamp 上限 maxHp 生效；实得 ${deltas.hp}）`);
  assert((npc.state.get('hp') || 0) === maxHp, '满血吃灵果 hp 仍=maxHp（未溢出）');
}

// 4) 强者精血：ge_add_qi(500) + ge_add_progress(0.05×nextCultivationRequired) —— 同一 ge_add_qi，数值=500（远高于丹药）
{
  const { deltas } = applyItemEffects(npc, 'item_strong_blood');
  assert(approx(deltas.qi, 500), `强者精血 ge_add_qi 增量=500（同一 Effect 复用，来源参数化；实得 ${deltas.qi}）`);
}

// 5) 灵石（货币）服用吸纳真气（ADR-043）：灵石既是货币又复用 ge_add_qi，数值=各自 qiValue。
{
  const lowRes = applyItemEffects(npc, 'low_spirit_stone');
  assert(lowRes.applied && approx(lowRes.deltas.qi, 1), `低级灵石服用 ge_add_qi 增量=1（=qiValue；实得 ${lowRes.deltas.qi}）`);
  const midRes = applyItemEffects(npc, 'mid_spirit_stone');
  assert(midRes.applied && approx(midRes.deltas.qi, 120), `中级灵石服用 ge_add_qi 增量=120（=qiValue，同一 Effect 复用；实得 ${midRes.deltas.qi}）`);
}

console.log('\n========== 多来源复用验证 ==========');
console.log('同一 ge_add_qi 被 聚气丹(120) / 灵果(40) / 强者精血(500) / 灵石(low=1,mid=120) 复用，各自数值取自各自 items.json effects。');
if (failed === 0) console.log('\n通用 Effect 多来源复用验证通过');
else { console.error(`\n验证失败：${failed} 项`); process.exit(1); }
