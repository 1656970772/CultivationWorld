/**
 * SchemaInferrer —— 从 JSON 样本推断字段类型树（ADR-031）
 *
 * 设计：
 * - 输入：JSON 样本（object / array）
 * - 输出：递归的 FieldDef 树，UI 直接渲染
 * - 推断规则：
 *   string         → text
 *   string + enum  → select（候选 ≤ 20 时）
 *   number         → number（min/max 从同级样本聚合）
 *   boolean        → boolean
 *   string[]       → tags
 *   object[]       → objectArray（itemFields 递归推断）
 *   object         → object（fields 递归推断）
 *   其他/mixed     → json（回退到 JSON 文本编辑）
 * - 数组采样：前 SAMPLE_LIMIT 个元素做字段 union
 * - 深度限制：> MAX_DEPTH 回退为 json
 * - 稳定 key 顺序：第一次见到的 key 顺序优先保留
 */

const SAMPLE_LIMIT = 100;
const MAX_DEPTH = 5;
const ENUM_THRESHOLD = 20; // 字符串候选数 ≤ 20 → select
const NUMBER_SAMPLE_LIMIT = 1000;

/**
 * 推断一个对象数组的元素字段（取所有元素的 key union，按首次出现顺序）。
 * @param {Object[]} samples
 * @returns {FieldDef[]}
 */
function inferObjectArrayItemFields(samples) {
  /** @type {FieldDef[]} */
  const out = [];
  const seen = new Set();
  for (const item of samples) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const key of Object.keys(item)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const values = samples.map(s => s?.[key]).filter(v => v !== undefined);
      out.push(inferFieldFromValues(key, values, 1));
    }
  }
  return out;
}

/**
 * 推断一个对象的所有字段（保留首次见到的 key 顺序）。
 * @param {Object} obj
 * @param {number} depth
 * @returns {FieldDef[]}
 */
function inferObjectFields(obj, depth) {
  /** @type {FieldDef[]} */
  const out = [];
  for (const key of Object.keys(obj)) {
    out.push(inferFieldFromValues(key, [obj[key]], depth));
  }
  return out;
}

/**
 * 从一组值推断字段定义。
 * @param {string} key
 * @param {Array} values
 * @param {number} depth
 * @returns {FieldDef}
 */
function inferFieldFromValues(key, values, depth) {
  // 过滤掉 undefined
  const present = values.filter(v => v !== undefined);
  if (present.length === 0) {
    return { path: key, label: prettifyKey(key), type: 'json' };
  }
  // 统计类型分布
  const kinds = new Set();
  for (const v of present) kinds.add(kindOf(v));

  // 多类型 → json
  if (kinds.size > 1) {
    return { path: key, label: prettifyKey(key), type: 'json' };
  }

  const kind = [...kinds][0];

  if (kind === 'string') {
    return inferStringField(key, present);
  }
  if (kind === 'number') {
    return inferNumberField(key, present);
  }
  if (kind === 'boolean') {
    return { path: key, label: prettifyKey(key), type: 'boolean' };
  }
  if (kind === 'array') {
    return inferArrayField(key, present, depth);
  }
  if (kind === 'object') {
    if (depth >= MAX_DEPTH) {
      return { path: key, label: prettifyKey(key), type: 'json' };
    }
    // 合并所有对象的 key union
    const merged = {};
    for (const o of present) Object.assign(merged, o);
    return {
      path: key,
      label: prettifyKey(key),
      type: 'object',
      fields: inferObjectFields(merged, depth + 1),
    };
  }
  if (kind === 'null') {
    return { path: key, label: prettifyKey(key), type: 'text', nullable: true };
  }
  return { path: key, label: prettifyKey(key), type: 'json' };
}

function kindOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'unknown';
}

function inferStringField(key, values) {
  // 枚举候选：仅在 2-20 个候选时降级为 select；单个候选用 text（select UI 无意义）
  const uniq = [...new Set(values)].filter(v => typeof v === 'string');
  if (uniq.length >= 2 && uniq.length <= ENUM_THRESHOLD && uniq.every(v => v.length < 64)) {
    return {
      path: key,
      label: prettifyKey(key),
      type: 'select',
      options: uniq.map(v => ({ value: v, label: v })),
    };
  }
  return { path: key, label: prettifyKey(key), type: 'text' };
}

function inferNumberField(key, values) {
  let min = Infinity, max = -Infinity, anyInt = true;
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    if (!Number.isInteger(v)) anyInt = false;
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 100;
  /** @type {FieldDef} */
  const f = {
    path: key,
    label: prettifyKey(key),
    type: 'number',
    min,
    max,
    step: anyInt ? 1 : 0.01,
  };
  // 0-1 / 0-100 范围 → range
  if (min >= 0 && max <= 1) f.type = 'range';
  return f;
}

function inferArrayField(key, values, depth) {
  const samples = values.slice(0, SAMPLE_LIMIT);
  // 嵌套数组：先剥一层（samples[0] 本身可能是数组），再看整体元素 kind 集合
  const flat = [];
  for (const s of samples) {
    if (Array.isArray(s)) flat.push(...s);
    else flat.push(s);
  }
  const kindSet = new Set();
  for (const v of flat) kindSet.add(kindOf(v));
  if (kindSet.size > 1) {
    return { path: key, label: prettifyKey(key), type: 'json' };
  }
  const firstKind = [...kindSet][0] || 'unknown';

  if (firstKind === 'string') {
    const flat = [];
    for (const s of samples) {
      if (Array.isArray(s)) flat.push(...s);
      else flat.push(s);
    }
    const uniq = [...new Set(flat)].filter(v => typeof v === 'string');
    if (uniq.length >= 2 && uniq.length <= ENUM_THRESHOLD) {
      return {
        path: key,
        label: prettifyKey(key),
        type: 'tags',
        options: uniq.map(v => ({ value: v, label: v })),
      };
    }
    return { path: key, label: prettifyKey(key), type: 'tags' };
  }
  if (firstKind === 'number') {
    return { path: key, label: prettifyKey(key), type: 'tags', itemType: 'number' };
  }
  if (firstKind === 'object') {
    if (depth >= MAX_DEPTH) {
      return { path: key, label: prettifyKey(key), type: 'json' };
    }
    // 展开所有嵌套层的对象到一个数组
    const items = [];
    for (const s of samples) {
      if (Array.isArray(s)) {
        for (const it of s) {
          if (it && typeof it === 'object' && !Array.isArray(it)) items.push(it);
        }
      } else if (s && typeof s === 'object') {
        items.push(s);
      }
    }
    return {
      path: key,
      label: prettifyKey(key),
      type: 'objectArray',
      itemFields: inferObjectArrayItemFields(items),
    };
  }
  return { path: key, label: prettifyKey(key), type: 'json' };
}

/** 把字段名拆成友好显示。 */
function prettifyKey(key) {
  if (!key) return '';
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, c => c.toUpperCase());
}

/**
 * 顶层入口：推断整个 JSON 的字段树。
 * @param {*} sample
 * @returns {SchemaTree}
 */
export function inferSchema(sample) {
  if (sample === null || sample === undefined) {
    return { rootType: 'json', rootFields: [] };
  }
  if (Array.isArray(sample)) {
    // 顶层数组：当作 objectArray
    const items = sample.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, SAMPLE_LIMIT);
    return {
      rootType: 'objectArray',
      rootFields: [],
      itemFields: inferObjectArrayItemFields(items),
    };
  }
  if (typeof sample === 'object') {
    return {
      rootType: 'object',
      rootFields: inferObjectFields(sample, 0),
    };
  }
  return { rootType: 'json', rootFields: [] };
}

/**
 * @typedef {Object} FieldDef
 * @property {string} path           字段路径（如 'meta.tags'）
 * @property {string} label          UI 显示名
 * @property {string} type           text/number/range/boolean/select/tags/object/objectArray/json/color/textarea/keyValueNumber/reference/relations/options/tileSummary/nestedJson
 * @property {FieldDef[]} [fields]   当 type=object
 * @property {FieldDef[]} [itemFields] 当 type=objectArray
 * @property {Array<{value,label}>} [options]  当 type=select/tags
 * @property {number} [min]          当 type=number/range
 * @property {number} [max]          当 type=number/range
 * @property {number} [step]         当 type=number/range
 * @property {string} [itemType]     当 type=tags（元素类型 number/string）
 * @property {boolean} [nullable]
 * @property {string} [help]         额外说明（可由 dataset 元信息注入）
 */

/**
 * @typedef {Object} SchemaTree
 * @property {string} rootType       object / objectArray / json
 * @property {FieldDef[]} [rootFields]   当 rootType=object
 * @property {FieldDef[]} [itemFields]   当 rootType=objectArray
 */
