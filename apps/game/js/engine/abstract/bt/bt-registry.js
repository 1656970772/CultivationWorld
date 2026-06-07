/**
 * BehaviorTreeRegistry - 行为树定义注册表（GOBT 数据驱动）。
 *
 * 注册表只管理 data/behavior-trees/*.json 形态的定义；实体构造时通过
 * ai-config 的 tier 映射拿到行为树 id，再从注册表取 root 交给 BTLoader 构建。
 */

let nodeReadFileSync = null;
let nodeResolve = null;
let nodeDirname = null;
let nodeFileURLToPath = null;
let defaultMonsterAIConfig = null;
let defaultMonsterRegistry = null;

if (typeof process !== 'undefined' && process.versions?.node) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  nodeReadFileSync = fs.readFileSync;
  nodeResolve = path.resolve;
  nodeDirname = path.dirname;
  nodeFileURLToPath = url.fileURLToPath;
}

function cloneTree(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class BehaviorTreeRegistry {
  constructor() {
    /** @type {Map<string, Object>} */
    this._trees = new Map();
  }

  register(config) {
    if (!config || !config.id) {
      throw new Error('BehaviorTreeRegistry.register: behavior tree 缺少 id');
    }
    if (!config.root || typeof config.root !== 'object') {
      throw new Error(`BehaviorTreeRegistry.register: "${config.id}" 缺少 root`);
    }
    this._trees.set(config.id, cloneTree(config));
    return config.id;
  }

  loadFromConfig(data) {
    const list = Array.isArray(data)
      ? data
      : (data?.behaviorTrees || data?.trees || []);
    for (const cfg of list) this.register(cfg);
  }

  has(id) { return this._trees.has(id); }
  get(id) {
    const tree = this._trees.get(id);
    return tree ? cloneTree(tree) : null;
  }
  getRoot(id) {
    const tree = this._trees.get(id);
    return tree?.root ? cloneTree(tree.root) : null;
  }
  get count() { return this._trees.size; }
  clear() { this._trees.clear(); }
}

function normalizeDataPath(path) {
  const p = String(path || '').replaceAll('\\', '/');
  return p.startsWith('data/') ? p : `data/${p}`;
}

function readGameDataJSON(path) {
  const normalized = normalizeDataPath(path);
  if (nodeReadFileSync) {
    const moduleDir = nodeDirname(nodeFileURLToPath(import.meta.url));
    const absolute = nodeResolve(moduleDir, '../../../../', normalized);
    return JSON.parse(nodeReadFileSync(absolute, 'utf-8'));
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    const url = new URL(`../../../../${normalized}`, import.meta.url);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url.href, false);
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(`BehaviorTreeRegistry: 加载 ${normalized} 失败，HTTP ${xhr.status}`);
    }
    return JSON.parse(xhr.responseText);
  }
  throw new Error(`BehaviorTreeRegistry: 当前环境无法同步加载 ${normalized}`);
}

export function loadDefaultMonsterAIConfig() {
  if (defaultMonsterAIConfig) return defaultMonsterAIConfig;
  const aiConfig = readGameDataJSON('data/config/ai-config.json');
  defaultMonsterAIConfig = aiConfig.monster || {};
  return defaultMonsterAIConfig;
}

export function createDefaultMonsterBehaviorTreeRegistry(monsterAIConfig = loadDefaultMonsterAIConfig()) {
  const registry = new BehaviorTreeRegistry();
  const filesConfig = monsterAIConfig.behaviorTreeFiles || {};
  const files = Array.isArray(filesConfig) ? filesConfig : Object.values(filesConfig);
  if (files.length === 0) {
    throw new Error('createDefaultMonsterBehaviorTreeRegistry: ai-config.monster.behaviorTreeFiles 为空');
  }
  for (const file of files) registry.register(readGameDataJSON(file));
  return registry;
}

export function getDefaultMonsterBehaviorTreeRegistry() {
  if (!defaultMonsterRegistry) {
    defaultMonsterRegistry = createDefaultMonsterBehaviorTreeRegistry(loadDefaultMonsterAIConfig());
  }
  return defaultMonsterRegistry;
}

/**
 * 按 ai-config.monster.tierGradeMap 解析妖兽行为树档位。
 * @param {number} grade 妖兽阶位
 * @param {Object} monsterAIConfig ai-config.json 的 monster 段
 * @returns {string} tier id，如 tier1/tier2/tier3
 */
export function resolveMonsterBTTier(grade, monsterAIConfig = {}) {
  const gradeMap = monsterAIConfig.tierGradeMap || {};
  for (const [tier, grades] of Object.entries(gradeMap)) {
    if (Array.isArray(grades) && grades.includes(grade)) return tier;
    if (grades && Array.isArray(grades.grades) && grades.grades.includes(grade)) return tier;
  }
  throw new Error(`resolveMonsterBTTier: grade ${grade} 未配置行为树 tier`);
}

/**
 * 按 ai-config.monster.tierBehaviorTreeMap 解析档位对应的行为树 id。
 * @param {string} tier
 * @param {Object} monsterAIConfig
 * @returns {string}
 */
export function resolveMonsterBehaviorTreeId(tier, monsterAIConfig = {}) {
  const treeMap = monsterAIConfig.tierBehaviorTreeMap || monsterAIConfig.behaviorTreeByTier || {};
  const id = treeMap[tier];
  if (!id) throw new Error(`resolveMonsterBehaviorTreeId: tier "${tier}" 未配置行为树 id`);
  return id;
}

/**
 * 按 ai-config.monster.orderEquivalentMap 解析妖兽阶位对应的修炼 order。
 * @param {number} grade 妖兽阶位
 * @param {Object} monsterAIConfig ai-config.json 的 monster 段
 * @returns {number}
 */
export function resolveMonsterOrderEquivalent(grade, monsterAIConfig = {}) {
  const map = monsterAIConfig.orderEquivalentMap || {};
  const value = map[String(grade)] ?? map[grade];
  const order = Number(value);
  if (!Number.isFinite(order)) {
    throw new Error(`resolveMonsterOrderEquivalent: grade ${grade} 未配置 order 等价值`);
  }
  return order;
}
