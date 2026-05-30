/**
 * 妖兽行为树预设（与 data/behavior-trees/monster-tier*.json 同构的代码侧常量）。
 *
 * 分三档：
 *   tier1（grade 1-2）：纯本能 — 休整 → 重伤逃 → 追杀猎物 → 游荡
 *   tier2（grade 3-4）：领地本能 — 增加呼群、领地巡逻、受伤撤退
 *   tier3（grade 5+）：初级智慧 — 增加情绪驱动（恐惧/狂暴）、仇恨记忆
 *
 * grade 6+（元婴等价）目前使用 tier3，后续迁移到完整 NPC_DEFAULT_BT + 妖兽 Need/Action。
 */

export const MONSTER_TIER1_BT = {
  type: 'sequence',
  name: 'monster-root',
  children: [
    { type: 'hook', name: 'pre-tick', hook: 'monsterPreTick' },
    { type: 'hook', name: 'sense',    hook: 'monsterSense' },
    {
      type: 'selector',
      name: 'behavior',
      children: [
        {
          type: 'sequence', name: 'rest',
          children: [
            { type: 'condition', name: 'is-resting', condition: { key: 'behaviorState', op: 'eq', value: 'rest' } },
            { type: 'hook', name: 'do-rest', hook: 'monsterRest' },
          ],
        },
        {
          type: 'sequence', name: 'flee',
          children: [
            { type: 'condition', name: 'low-hp', condition: { key: 'hpRatio', op: 'lte', value: 0.25 } },
            { type: 'hook', name: 'do-flee', hook: 'monsterFlee' },
          ],
        },
        {
          type: 'sequence', name: 'hunt',
          children: [
            { type: 'condition', name: 'has-target', condition: { key: 'hasTarget', op: 'true' } },
            { type: 'hook', name: 'do-hunt', hook: 'monsterChaseOrAttack' },
          ],
        },
        { type: 'hook', name: 'wander', hook: 'monsterWander' },
      ],
    },
  ],
};

export const MONSTER_TIER2_BT = {
  type: 'sequence',
  name: 'monster-root',
  children: [
    { type: 'hook', name: 'pre-tick', hook: 'monsterPreTick' },
    { type: 'hook', name: 'sense',    hook: 'monsterSense' },
    {
      type: 'selector',
      name: 'behavior',
      children: [
        {
          type: 'sequence', name: 'rest',
          children: [
            { type: 'condition', name: 'is-resting', condition: { key: 'behaviorState', op: 'eq', value: 'rest' } },
            { type: 'hook', name: 'do-rest', hook: 'monsterRest' },
          ],
        },
        {
          type: 'sequence', name: 'flee-critical',
          children: [
            { type: 'condition', name: 'critical-hp', condition: { key: 'hpRatio', op: 'lte', value: 0.15 } },
            { type: 'hook', name: 'do-flee', hook: 'monsterFlee' },
          ],
        },
        {
          type: 'sequence', name: 'defend-territory',
          children: [
            { type: 'condition', name: 'has-target', condition: { key: 'hasTarget', op: 'true' } },
            { type: 'hook', name: 'call-pack',  hook: 'monsterCallPack', defaultStatus: 'success' },
            { type: 'hook', name: 'do-hunt',    hook: 'monsterChaseOrAttack' },
          ],
        },
        {
          type: 'sequence', name: 'retreat-hurt',
          children: [
            { type: 'condition', name: 'hurt', condition: { key: 'hpRatio', op: 'lte', value: 0.45 } },
            { type: 'hook', name: 'return-to-lair', hook: 'monsterReturnToLair' },
          ],
        },
        { type: 'hook', name: 'patrol', hook: 'monsterPatrolTerritory' },
      ],
    },
  ],
};

export const MONSTER_TIER3_BT = {
  type: 'sequence',
  name: 'monster-root',
  children: [
    { type: 'hook', name: 'pre-tick',        hook: 'monsterPreTick' },
    { type: 'hook', name: 'sense',           hook: 'monsterSense' },
    { type: 'hook', name: 'update-instincts', hook: 'monsterUpdateInstincts' },
    {
      type: 'selector',
      name: 'behavior',
      children: [
        {
          type: 'sequence', name: 'rest',
          children: [
            { type: 'condition', name: 'is-resting', condition: { key: 'behaviorState', op: 'eq', value: 'rest' } },
            { type: 'hook', name: 'do-rest', hook: 'monsterRest' },
          ],
        },
        {
          type: 'sequence', name: 'terror-flee',
          children: [
            { type: 'condition', name: 'terrified', condition: { key: 'emotionFear', op: 'gte', value: 75 } },
            { type: 'hook', name: 'do-flee', hook: 'monsterFlee' },
          ],
        },
        {
          type: 'sequence', name: 'berserk',
          children: [
            { type: 'condition', name: 'enraged', condition: { key: 'emotionRage', op: 'gte', value: 80 } },
            { type: 'hook', name: 'do-berserk', hook: 'monsterBerserkAttack' },
          ],
        },
        {
          type: 'sequence', name: 'hunt-grudge',
          children: [
            { type: 'condition', name: 'has-grudge', condition: { key: 'grudgeTargetId', op: 'exists' } },
            { type: 'hook', name: 'do-grudge-hunt', hook: 'monsterHuntGrudge' },
          ],
        },
        {
          type: 'sequence', name: 'retreat',
          children: [
            { type: 'condition', name: 'hurt', condition: { key: 'hpRatio', op: 'lte', value: 0.3 } },
            { type: 'hook', name: 'do-retreat', hook: 'monsterReturnToLair' },
          ],
        },
        {
          type: 'sequence', name: 'hunt',
          children: [
            { type: 'condition', name: 'has-target', condition: { key: 'hasTarget', op: 'true' } },
            { type: 'hook', name: 'call-pack',  hook: 'monsterCallPack', defaultStatus: 'success' },
            { type: 'hook', name: 'do-hunt',    hook: 'monsterChaseOrAttack' },
          ],
        },
        { type: 'hook', name: 'patrol', hook: 'monsterPatrolTerritory' },
      ],
    },
  ],
};
