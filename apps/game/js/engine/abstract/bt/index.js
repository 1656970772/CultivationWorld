/**
 * BT 模块统一导出 + 预设构建器（GOBT，ADR-018）。
 *
 * 提供一个已注册 PlannerNode 的 BTLoader，以及 NPC/势力默认树的内置预设
 * （与 data/behavior-trees/*.json 同构，作为代码侧默认值；configs 传入时可覆盖）。
 */
import { BTLoader } from './bt-loader.js';
import { PlannerNode } from './planner-node.js';

export { BTStatus, BTNode } from './bt-node.js';
export { SelectorNode, SequenceNode, ParallelNode } from './composites.js';
export { InverterNode, SucceederNode, CooldownNode } from './decorators.js';
export { ConditionNode, HookNode, AlwaysNode } from './leaves.js';
export { PlannerNode } from './planner-node.js';
export { BTRunner } from './bt-runner.js';
export { BTLoader } from './bt-loader.js';

/** 创建一个已注册 GOBT planner 节点的 BTLoader。 */
export function createBTLoader(extraRegistry = {}) {
  return new BTLoader({
    planner: (cfg) => new PlannerNode(cfg),
    ...extraRegistry,
  });
}

/**
 * NPC 默认行为树（与 data/behavior-trees/npc-default.json 的 root 同构）。
 * 等价旧四段式：onPreTick → (反应 | 评估需求+规划执行)。
 */
export const NPC_DEFAULT_BT = {
  type: 'sequence',
  name: 'npc-root',
  children: [
    { type: 'hook', name: 'pre-tick', hook: 'onPreTick' },
    {
      type: 'selector',
      name: 'npc-behavior',
      children: [
        {
          type: 'selector',
          name: 'reactions',
          children: [
            // 心魔反噬：心魔过高时强制静心闭关压制。阈值由 emotion.json 经 BT 配置覆盖；
            // 默认 101（不可达），保证未调参时不改变既有世界平衡。
            { type: 'emotion_reaction', name: 'suppress-inner-demon', emotion: 'inner_demon', threshold: 101, actionId: 'act_npc_cultivate' },
          ],
        },
        {
          type: 'sequence',
          name: 'deliberate',
          children: [
            { type: 'hook', name: 'evaluate-needs', hook: 'btEvaluateNeeds' },
            { type: 'planner', name: 'npc-planner', realtimeReselect: false },
          ],
        },
      ],
    },
  ],
};

/** 势力默认行为树（与 data/behavior-trees/faction-default.json 的 root 同构）。 */
export const FACTION_DEFAULT_BT = {
  type: 'sequence',
  name: 'faction-root',
  children: [
    { type: 'hook', name: 'pre-tick', hook: 'onPreTick' },
    { type: 'hook', name: 'evaluate-needs', hook: 'btEvaluateNeeds' },
    { type: 'planner', name: 'faction-planner', realtimeReselect: false },
  ],
};
