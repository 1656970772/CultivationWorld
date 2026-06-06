export const TERRAIN_TYPES = {
  PLAIN: 'plain',
  MOUNTAIN: 'mountain',
  FOREST: 'forest',
  RIVER: 'river',
  SWAMP: 'swamp',
  DESERT: 'desert',
  LOW_SPIRIT_VEIN: 'low_spirit_vein',
  MID_SPIRIT_VEIN: 'mid_spirit_vein',
  HIGH_SPIRIT_VEIN: 'high_spirit_vein',
  TOP_SPIRIT_VEIN: 'top_spirit_vein'
};

export const FACTION_TYPES = {
  RIGHTEOUS: 'righteous',
  EVIL: 'evil',
  NEUTRAL: 'neutral',
  DEMON: 'demon'
};

export const FACTION_TRAITS = {
  EXPANSIONIST: 'expansionist',
  DEFENSIVE: 'defensive',
  SCHOLARLY: 'scholarly',
  AGGRESSIVE: 'aggressive',
  DIPLOMATIC: 'diplomatic'
};

export const MODIFIER_TYPES = {
  DEMON_QI_RISING: 'demon_qi_rising',
  BEAST_SURGE: 'beast_surge',
  DYNASTY_DECLINE: 'dynasty_decline',
  SPIRIT_RECOVERY: 'spirit_recovery',
  DROUGHT: 'drought',
  PLAGUE: 'plague',
  SECRET_REALM: 'secret_realm'
};

export const EVENTS = {
  WORLD_TICK_COMPLETE: 'WORLD_TICK_COMPLETE',
  PLAYER_MOVED: 'PLAYER_MOVED',
  EVENT_TRIGGERED: 'EVENT_TRIGGERED',
  EVENT_CHOICE_MADE: 'EVENT_CHOICE_MADE',
  INFO_RECEIVED: 'INFO_RECEIVED',
  SAVE_COMPLETE: 'SAVE_COMPLETE',
  LOAD_COMPLETE: 'LOAD_COMPLETE'
};

export const WORKER_MESSAGES = {
  // 主线程 → Worker
  INIT: 'INIT',
  TICK: 'TICK',
  MULTI_TICK: 'MULTI_TICK',
  GET_SNAPSHOT: 'GET_SNAPSHOT',
  GET_HISTORY: 'GET_HISTORY',
  // Worker → 主线程
  INIT_COMPLETE: 'INIT_COMPLETE',
  TICK_RESULT: 'TICK_RESULT',
  MULTI_TICK_RESULT: 'MULTI_TICK_RESULT',
  SNAPSHOT: 'SNAPSHOT',
  HISTORY: 'HISTORY',
  ERROR: 'ERROR',
};

export const FACTION_ACTIONS = {
  EXPAND: 'expand',
  DEFEND: 'defend',
  ATTACK: 'attack',
  ALLY: 'ally',
  DEVELOP: 'develop',
  TRADE: 'trade',
  RETREAT: 'retreat'
};

/**
 * 灵石品阶换算体系：内部统一以低级灵石为基准单位存储和计算，
 * 仅在展示时换算为可读的多品阶格式。
 * 100低级=1中级，100中级=1高级，100高级=1极品
 */
export const SPIRIT_STONE_GRADES = [
  { id: 'top_spirit_stone',  name: '极品', rate: 1000000 },
  { id: 'high_spirit_stone', name: '高级', rate: 10000 },
  { id: 'mid_spirit_stone',  name: '中级', rate: 100 },
  { id: 'low_spirit_stone',  name: '低级', rate: 1 },
];

export function formatSpiritStones(amount) {
  if (!amount || amount <= 0) return '0';
  let remaining = Math.floor(amount);
  const parts = [];
  for (const grade of SPIRIT_STONE_GRADES) {
    if (remaining >= grade.rate) {
      const count = Math.floor(remaining / grade.rate);
      remaining %= grade.rate;
      parts.push(`${count}${grade.name}`);
    }
  }
  return parts.length > 0 ? parts.join(' ') : '0';
}

export const GAME_CONSTANTS = {
  MAP_WIDTH: 300,
  MAP_HEIGHT: 300,
  PLAYER_ACTIONS_PER_DAY: 5,
  PLAYER_INITIAL_SENSE_RANGE: 5,
  PLAYER_INITIAL_X: 150,
  PLAYER_INITIAL_Y: 150
};

// 可信度阈值：> CONFIRMED 显示为"确认"，> RUMOR 显示为"消息"，其余为"传闻"
export const RELIABILITY_LEVELS = {
  CONFIRMED: 0.7,
  MESSAGE: 0.3,
  RUMOR: 0
};

/**
 * 世界新闻类型（信息传播系统，ADR-024）。
 * 事件发生后生成对应 WorldNews，通过传播渠道扩散，NPC 知晓后关联 WorldOpportunity 决策。
 * @enum {string}
 */
export const NewsType = Object.freeze({
  TRIBULATION: 'tribulation',         // 渡劫异象（高 importance，大半径直接传播）
  MONSTER_KING_DEATH: 'monster_king_death', // 妖王陨落 → 留下尸骸机缘
  SECRET_REALM_OPEN: 'secret_realm_open',   // 秘境开启 → 入口热点
  AUCTION: 'auction',                 // 拍卖会举办 → 各方云集
  FACTION_WAR: 'faction_war',         // 宗门大战
  TREASURE_BORN: 'treasure_born',     // 天材地宝成熟
  WEALTH_EXPOSED: 'wealth_exposed',   // 怀璧其罪（ADR-025）：某修士暴露高价值身家
  DYNAMIC_EVENT_ANNOUNCED: 'dynamic_event_announced', // 动态世界事件预告
  DYNAMIC_EVENT_ACTIVE: 'dynamic_event_active',       // 动态世界事件进入活跃窗口
});

/**
 * 世界机会点类型（机会系统，ADR-024）。
 * WorldOpportunity 是有坐标/价值/过期的持久热点，统一所有"值得前往"的目标。
 * @enum {string}
 */
export const OpportunityType = Object.freeze({
  TREASURE: 'treasure',               // 天材地宝点
  AUCTION: 'auction',                 // 拍卖会
  WAR: 'war',                         // 战场
  RECRUITMENT: 'recruitment',         // 招募
  INHERITANCE: 'inheritance',         // 传承机缘
  MONSTER_CORPSE: 'monster_corpse',   // 妖兽尸骸（夺尸夺丹）
  SECRET_REALM: 'secret_realm',       // 秘境入口
  WEALTH_TARGET: 'wealth_target',     // 怀璧其罪目标（ADR-025）：可被觊觎抢夺的富有修士
});
