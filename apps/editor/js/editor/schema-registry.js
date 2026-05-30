export const DATASET_ORDER = [
  'factions',
  'npcs',
  'terrains',
  'modifiers',
  'rules',
  'events',
  'map'
];

export const FACTION_TYPES = [
  { value: 'righteous', label: '正派' },
  { value: 'evil', label: '邪派' },
  { value: 'neutral', label: '中立' },
  { value: 'demon', label: '妖族' },
  { value: 'mortal_kingdom', label: '凡人王朝' }
];

export const FACTION_TRAITS = [
  { value: 'expansionist', label: '扩张倾向' },
  { value: 'defensive', label: '防御倾向' },
  { value: 'scholarly', label: '研究发展' },
  { value: 'aggressive', label: '攻伐倾向' },
  { value: 'diplomatic', label: '外交倾向' }
];

export const DATASET_SCHEMAS = {
  factions: {
    key: 'factions',
    file: 'data/entities/factions.json',
    label: '势力',
    icon: '宗',
    itemName: '势力',
    keyField: 'id',
    collection: 'array',
    description: '宗门、妖族和凡人王朝的基础配置，决定初始资源、关系、掌门和行为倾向。',
    emptyItem: {
      id: 'sect_new',
      name: '新势力',
      type: 'neutral',
      headquarters: { x: 50, y: 50 },
      stability: 70,
      resources: { spirit_stone: 1000, disciples: 100, food: 1000 },
      leader: '',
      traits: [],
      relations: {}
    },
    summary: (item) => `${item.type || 'unknown'} / 稳定度 ${item.stability ?? '-'}`,
    fields: [
      { path: 'id', label: '势力 ID', type: 'text', required: true, help: '唯一标识，其他数据会通过它引用这个势力。' },
      { path: 'name', label: '名称', type: 'text', required: true, help: '玩家看到的势力名称。' },
      { path: 'type', label: '阵营类型', type: 'select', options: FACTION_TYPES, required: true, help: '影响势力 AI 的策略选择。' },
      { path: 'headquarters.x', label: '总部 X', type: 'number', min: 0, max: 299, step: 1, help: '势力总部横坐标。' },
      { path: 'headquarters.y', label: '总部 Y', type: 'number', min: 0, max: 299, step: 1, help: '势力总部纵坐标。' },
      { path: 'stability', label: '稳定度', type: 'range', min: 0, max: 100, step: 1, help: '0-100，过低会诱发内乱、叛变等事件。' },
      { path: 'resources.spirit_stone', label: '灵石', type: 'number', min: 0, step: 1, help: '势力资源之一，影响发展和冲突结算。' },
      { path: 'resources.disciples', label: '弟子数', type: 'number', min: 0, step: 1, help: '势力人力规模，影响攻伐和稳定。' },
      { path: 'resources.food', label: '粮食', type: 'number', min: 0, step: 1, help: '凡俗供养与长期稳定资源。' },
      { path: 'leader', label: '掌门 NPC', type: 'reference', target: 'npcs', required: true, help: '引用 `npcs.json` 中的 NPC ID。' },
      { path: 'traits', label: '势力特性', type: 'tags', options: FACTION_TRAITS, help: '影响势力 AI 权重，可选多个。' },
      { path: 'relations', label: '势力关系', type: 'relations', target: 'factions', min: -100, max: 100, help: '-100 为死敌，100 为至交。' }
    ]
  },

  npcs: {
    key: 'npcs',
    file: 'data/entities/npcs.json',
    label: 'NPC 领袖',
    icon: '人',
    itemName: 'NPC',
    keyField: 'id',
    collection: 'array',
    description: '势力掌门和关键人物。NPC 性格直接影响所属势力每天的行为决策。',
    emptyItem: {
      id: 'npc_new',
      name: '新掌门',
      factionId: '',
      personality: { ambition: 50, caution: 50, loyalty: 70, diplomacy: 50 },
      alive: true
    },
    summary: (item) => `${item.factionId || '未归属'} / ${item.alive ? '存活' : '陨落'}`,
    fields: [
      { path: 'id', label: 'NPC ID', type: 'text', required: true, help: '唯一标识，势力 leader 会引用它。' },
      { path: 'name', label: '名称', type: 'text', required: true, help: '人物显示名称。' },
      { path: 'factionId', label: '所属势力', type: 'reference', target: 'factions', help: '引用 `factions.json` 中的势力 ID；散修/游侠可留空。' },
      { path: 'personality.ambition', label: '野心', type: 'range', min: 0, max: 100, step: 1, help: '高值更倾向扩张和攻伐。' },
      { path: 'personality.caution', label: '谨慎', type: 'range', min: 0, max: 100, step: 1, help: '高值更倾向防守，只在有把握时行动。' },
      { path: 'personality.loyalty', label: '忠诚', type: 'range', min: 0, max: 100, step: 1, help: '低值更容易触发叛变相关事件。' },
      { path: 'personality.diplomacy', label: '外交', type: 'range', min: 0, max: 100, step: 1, help: '高值更倾向结盟、贸易和缓和关系。' },
      { path: 'alive', label: '是否存活', type: 'boolean', help: '陨落后会影响掌门继任。' }
    ]
  },

  terrains: {
    key: 'terrains',
    file: 'data/definitions/terrains.json',
    label: '地形',
    icon: '地',
    itemName: '地形',
    keyField: 'type',
    collection: 'array',
    description: '地图格子的地形定义，控制颜色、通行、移动消耗和资源倍率。',
    emptyItem: {
      type: 'new_terrain',
      name: '新地形',
      moveCost: 1,
      passable: true,
      color: '#6f8f58',
      description: '',
      resourceMultiplier: 1
    },
    summary: (item) => `${item.passable ? '可通行' : '不可通行'} / 移动 ${item.moveCost}`,
    fields: [
      { path: 'type', label: '地形类型', type: 'text', required: true, help: '唯一标识，地图 tile.terrain 会引用它。' },
      { path: 'name', label: '名称', type: 'text', required: true, help: '地形显示名称。' },
      { path: 'moveCost', label: '移动消耗', type: 'number', min: -1, step: 1, help: '-1 通常表示不可通行。' },
      { path: 'passable', label: '可通行', type: 'boolean', help: '玩家和寻路是否可以穿过该地形。' },
      { path: 'color', label: '地图颜色', type: 'color', required: true, help: 'Canvas 地图渲染颜色。' },
      { path: 'description', label: '说明', type: 'textarea', help: '给设计者和玩家理解地形用途。' },
      { path: 'resourceMultiplier', label: '资源倍率', type: 'number', min: 0, step: 0.1, help: '影响资源收益倾向。' },
      { path: 'defenseBonus', label: '防守加成', type: 'number', min: 0, step: 0.1, optional: true, help: '可选字段，山脉等地形用于战斗结算。' },
      { path: 'spiritBonus', label: '灵气加成', type: 'number', min: 0, step: 0.1, optional: true, help: '可选字段，灵脉等特殊地形使用。' }
    ]
  },

  modifiers: {
    key: 'modifiers',
    file: 'data/world/modifiers.json',
    label: '世界状态',
    icon: '象',
    itemName: '状态',
    keyField: 'type',
    collection: 'array',
    description: '全局时代状态，例如魔气上涨、大旱、秘境开启，影响世界 Tick 的行为权重。',
    emptyItem: {
      type: 'new_modifier',
      name: '新状态',
      description: '',
      minDuration: 5,
      maxDuration: 15,
      probability: 0.01,
      effects: {}
    },
    summary: (item) => `概率 ${item.probability ?? '-'} / ${item.minDuration ?? '-'}-${item.maxDuration ?? '-'} 天`,
    fields: [
      { path: 'type', label: '状态类型', type: 'text', required: true, help: '唯一标识，规则条件可能引用它。' },
      { path: 'name', label: '名称', type: 'text', required: true, help: '状态显示名称。' },
      { path: 'description', label: '说明', type: 'textarea', help: '状态叙事描述。' },
      { path: 'minDuration', label: '最短持续天数', type: 'number', min: 0, step: 1, help: '随机持续时间下限。' },
      { path: 'maxDuration', label: '最长持续天数', type: 'number', min: 0, step: 1, help: '随机持续时间上限。' },
      { path: 'probability', label: '每日出现概率', type: 'range', min: 0, max: 1, step: 0.001, help: '0-1，越高越容易在每天 Tick 中出现。' },
      { path: 'effects', label: '效果参数', type: 'keyValueNumber', help: '效果键值由各系统解释，数值通常为倍率或加减权重。' }
    ]
  },

  rules: {
    key: 'rules',
    file: 'data/rules.json',
    label: '事件规则',
    icon: '律',
    itemName: '规则',
    keyField: 'id',
    collection: 'array',
    description: '规则引擎配置。满足条件后按概率生成对应事件类型。',
    emptyItem: {
      id: 'rule_new',
      name: '新规则',
      description: '',
      conditions: {},
      event_type: 'trade',
      probability: 0.1,
      cooldown: 10
    },
    summary: (item) => `${item.event_type || 'unknown'} / 概率 ${item.probability ?? '-'}`,
    fields: [
      { path: 'id', label: '规则 ID', type: 'text', required: true, help: '唯一标识，用于冷却记录。' },
      { path: 'name', label: '名称', type: 'text', required: true, help: '规则显示名称。' },
      { path: 'description', label: '说明', type: 'textarea', help: '规则触发意图说明。' },
      { path: 'conditions', label: '触发条件', type: 'json', help: '规则条件对象，具体键由事件系统解释。' },
      { path: 'event_type', label: '生成事件类型', type: 'reference', target: 'events', targetKey: 'type', required: true, help: '引用 `events.json` 中的事件 type。' },
      { path: 'probability', label: '触发概率', type: 'range', min: 0, max: 1, step: 0.001, help: '0-1，每次条件满足时的触发概率。' },
      { path: 'cooldown', label: '冷却天数', type: 'number', min: 0, step: 1, help: '触发后多少天内不再触发。' }
    ]
  },

  events: {
    key: 'events',
    file: 'data/events.json',
    label: '事件模板',
    icon: '事',
    itemName: '事件',
    keyField: 'type',
    collection: 'array',
    description: '事件模板定义展示文本、持续时间、结算效果、玩家可选项和信息传播参数。',
    emptyItem: {
      type: 'new_event',
      name: '新事件',
      description: '',
      duration: 1,
      effects: {},
      player_options: [],
      info_spread_speed: 3,
      info_max_radius: 50,
      info_reliability: 0.8
    },
    summary: (item) => `持续 ${item.duration ?? 0} 天 / 传播 ${item.info_max_radius ?? '-'}`,
    fields: [
      { path: 'type', label: '事件类型', type: 'text', required: true, help: '唯一标识，rules.event_type 会引用它。' },
      { path: 'name', label: '名称', type: 'text', required: true, help: '事件显示名称。' },
      { path: 'description', label: '描述模板', type: 'textarea', required: true, help: '可包含 {attacker}、{defender} 等占位符。' },
      { path: 'duration', label: '持续天数', type: 'number', min: 0, step: 1, help: '0 表示立即结算。' },
      { path: 'effects', label: '效果参数', type: 'json', help: '事件系统读取的效果对象。' },
      { path: 'player_options', label: '玩家选项', type: 'options', help: '玩家在神识范围内可选择的介入方式。' },
      { path: 'info_spread_speed', label: '信息传播速度', type: 'number', min: 0, step: 1, help: '每天传播的地图格数。' },
      { path: 'info_max_radius', label: '信息最大半径', type: 'number', min: 0, step: 1, help: '消息最多传播到多远。' },
      { path: 'info_reliability', label: '基础可信度', type: 'range', min: 0, max: 1, step: 0.01, help: '0-1，传得越远显示可信度越低。' }
    ]
  },

  map: {
    key: 'map',
    file: 'data/world/map.json',
    label: '地图',
    icon: '图',
    itemName: '地图',
    keyField: null,
    collection: 'object',
    description: '300×300 世界地图。编辑器提供摘要、校验和 JSON 高级编辑。',
    summary: (item) => `${item.width ?? '-'}×${item.height ?? '-'} / ${item.tiles?.length ?? 0} 格`,
    fields: [
      { path: 'width', label: '地图宽度', type: 'number', min: 1, step: 1, help: '地图横向格子数。' },
      { path: 'height', label: '地图高度', type: 'number', min: 1, step: 1, help: '地图纵向格子数。' },
      { path: 'tiles', label: '格子数据', type: 'tileSummary', help: '地图有 90000 格，默认只展示摘要，避免把完整 JSON 渲染进页面导致卡顿。完整数据仍会随保存/导出保留。' }
    ]
  }
};

export function getDatasetSchema(datasetKey) {
  return DATASET_SCHEMAS[datasetKey] || null;
}

export function getDatasetLabel(datasetKey) {
  return DATASET_SCHEMAS[datasetKey]?.label || datasetKey;
}

export function getSchemaKey(schema, item) {
  if (!schema?.keyField) return schema?.key || '';
  return item?.[schema.keyField] ?? '';
}

export function cloneEmptyItem(schema) {
  return JSON.parse(JSON.stringify(schema.emptyItem || {}));
}
