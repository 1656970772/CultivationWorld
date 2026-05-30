/**
 * BTLoader - 从 JSON 配置构建行为树（GOBT 数据驱动，ADR-018）。
 *
 * 节点类型注册表（开闭原则）：新增节点类型只需 registerNodeType，无需改 loader。
 * JSON 结构：
 *   {
 *     "type": "selector",
 *     "name": "npc-root",
 *     "children": [ { "type": "condition", ... }, { "type": "planner", ... } ]
 *   }
 *
 * 装饰器/复合的子节点写在 children 数组里；叶子节点的参数写在同级字段。
 */
import { SelectorNode, SequenceNode, ParallelNode } from './composites.js';
import { InverterNode, SucceederNode, CooldownNode } from './decorators.js';
import { ConditionNode, HookNode, AlwaysNode } from './leaves.js';
import { EmotionReactionNode } from './reactions.js';

/** 内置节点类型注册表：type 字符串 → (config) => BTNode。 */
const DEFAULT_REGISTRY = {
  selector: (cfg) => new SelectorNode(cfg),
  sequence: (cfg) => new SequenceNode(cfg),
  parallel: (cfg) => new ParallelNode(cfg),
  inverter: (cfg) => new InverterNode(cfg),
  succeeder: (cfg) => new SucceederNode(cfg),
  cooldown: (cfg) => new CooldownNode(cfg),
  condition: (cfg) => new ConditionNode(cfg),
  hook: (cfg) => new HookNode(cfg),
  always: (cfg) => new AlwaysNode(cfg),
  emotion_reaction: (cfg) => new EmotionReactionNode(cfg),
};

export class BTLoader {
  /**
   * @param {Object} [extraRegistry] 额外节点类型（如 { planner: (cfg, ctx) => new PlannerNode(...) }）
   */
  constructor(extraRegistry = {}) {
    this.registry = { ...DEFAULT_REGISTRY, ...extraRegistry };
  }

  /**
   * 注册/覆盖一个节点类型。
   * @param {string} type
   * @param {(config: Object, buildContext: Object) => import('./bt-node.js').BTNode} factory
   */
  registerNodeType(type, factory) {
    this.registry[type] = factory;
  }

  /**
   * 从 JSON 节点描述递归构建 BTNode。
   * @param {Object} nodeJson
   * @param {Object} [buildContext] 透传给工厂的上下文（如 planner 依赖的 needSystem/behaviorSystem 引用）
   * @returns {import('./bt-node.js').BTNode}
   */
  build(nodeJson, buildContext = {}) {
    if (!nodeJson || !nodeJson.type) {
      throw new Error('BTLoader.build: 节点缺少 type 字段');
    }
    const factory = this.registry[nodeJson.type];
    if (!factory) {
      throw new Error(`BTLoader.build: 未注册的节点类型 "${nodeJson.type}"`);
    }
    const node = factory(nodeJson, buildContext);
    const children = nodeJson.children || [];
    for (const childJson of children) {
      node.addChild(this.build(childJson, buildContext));
    }
    return node;
  }
}
