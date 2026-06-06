#!/usr/bin/env node
/**
 * 一次性标定脚本：以「1 块低级灵石」为基准单位，估算每个 NPC 行为的「灵石等价净收益」。
 * 用于校核 npc-actions.json 的 valueScore 是否合理（量纲一致、相对大小合理）。
 * 基准换算（mortal/disciple 层）：
 *   1 灵石 = 1 真气（执行器 stoneQi=consumed；resources.qiValue=1）
 *   闭关 1 天基础真气产出 = qiBaseGain[rank]（净增，不含灵石转化）
 *   赶路/游历 1 天的机会成本 ≈ 闭关 1 天基础产出（以灵石计）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = resolve(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(resolve(GAME_ROOT, p), 'utf-8'));

const cult = load('data/balance/cultivation.json');
const actions = [
  ...load('data/actions/npc-actions.json'),
  ...load('data/actions/npc-job-actions.json'),
];
const quest = load('data/quests/quest-templates.json');

const RANK = 'mortal';
const QI_PER_STONE = 1;                 // 1 真气 = 1 灵石
const STONE_PER_CONTRIBUTION = 5;       // assistFaction.stoneBonusPerContribution
const qiBase = cult.qiBaseGain[RANK];   // 每天基础真气
const stonePerDay = cult.spiritStoneCost[RANK]; // 每天闭关灵石消耗

// 赶路/原地 1 天的机会成本（灵石）：本可闭关获得 qiBase 真气
const DAY_OPPORTUNITY_STONE = qiBase * QI_PER_STONE;
console.log(`基准：1 灵石=${QI_PER_STONE}真气；闭关1天基础产出=${qiBase}真气；赶路/原地1天机会成本≈${DAY_OPPORTUNITY_STONE}灵石`);
console.log(`闭关1天净耗灵石=${stonePerDay}（但灵石转真气 1:1，故灵石支出≈等价转换，非纯损失）\n`);

// explore 期望真气（按事件表加权 × qi 基准区间中值）
const ev = cult.actions.explore;
const qiMid = (ev.fortuneQiMin + ev.fortuneQiMax) / 2;
let expQiMul = 0, wsum = 0;
for (const e of ev.fortuneEvents) { expQiMul += e.weight * e.qiMultiplier; wsum += e.weight; }
expQiMul /= wsum;
const exploreQi = qiMid * expQiMul; // 期望真气
const exploreInsightMid = (ev.insightMin + ev.insightMax) / 2; // 期望 insight（突破进度）

// 任务奖励（mortal 可接难度<=2，取难度1中值）
const diff1 = quest.difficulties.find(d => d.level === 1) || {};

const estimates = {
  act_npc_job_cultivate: qiBase * QI_PER_STONE,              // 闭关1天≈基础真气价值
  act_npc_job_train_chamber: qiBase * 2 * QI_PER_STONE,       // 修炼场翻倍≈2倍真气价值
  act_npc_job_heal: 5,                                       // 解1级伤，避免后续寿元/战力损失，估5灵石
  act_npc_serve_faction: 2 * STONE_PER_CONTRIBUTION,         // 履职≈数贡献等价
  act_npc_seek_elixir: 30,                                   // 续命（低成功率但价值高），估30灵石
  act_npc_challenge: 5 * STONE_PER_CONTRIBUTION,             // 晋升带来月俸/地位，估25灵石
  act_npc_assist_faction: 1 * STONE_PER_CONTRIBUTION,        // 辅助≈数灵石
  act_npc_job_explore: exploreQi * QI_PER_STONE + exploreInsightMid * 1000, // 真气+感悟(进度极值钱)
  act_npc_accept_quest_job: 2,                                // 仅接取，价值低
  act_npc_execute_quest_job: (diff1.rewardStones || 5) * 0.5, // 执行推进，部分奖励
  act_npc_turn_in_quest_job: (diff1.rewardStones || 5) + (diff1.rewardContribution || 2) * STONE_PER_CONTRIBUTION,
};

console.log('行为 → 灵石等价净收益（估算） vs 当前 valueScore：');
for (const a of actions) {
  const est = estimates[a.id];
  console.log(`  ${a.id.padEnd(24)} 估算≈${String(Math.round(est)).padStart(5)}灵石   当前valueScore=${a.valueScore}`);
}
