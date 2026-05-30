/**
 * layout-constants.js - 势力领地与建筑布局相关枚举与主题色
 *
 * 供 TerritoryLayoutGenerator（数据生成）与 SimulationRenderer（渲染）共用，
 * 避免字符串魔法值散落（遵循"用枚举而非字符串表达多种情况"的规则）。
 *
 * 这些是"运行时"概念：领地形状与建筑由引擎初始化时生成并写入 tileIndex 的 tile 上，
 * 不落盘到 map.json。
 */

/** 领地分区类别（写入 tile.district） */
export const DistrictType = Object.freeze({
  CORE: 'core',   // 核心院落内部
  INNER: 'inner', // 外围有机领地
  WALL: 'wall',   // 院墙/山门所在外圈
  MINE: 'mine',   // 矿区
});

/** 建筑类型（写入 tile.building；null 表示无建筑） */
export const BuildingType = Object.freeze({
  MAIN_HALL: 'main_hall',   // 主殿（宗主/核心）
  QUEST_HALL: 'quest_hall', // 任务殿（接发任务 / 兑换奖励）
  TRAINING: 'training',     // 修炼场（弟子日常修炼）
  LIBRARY: 'library',       // 藏经阁（功法）
  ALCHEMY: 'alchemy',       // 炼丹 / 炼器房
  GATE: 'gate',             // 山门 / 围墙关口
  MARKET: 'market',         // 坊市 / 拍卖行（中立机构核心）
  MINE_NODE: 'mine_node',   // 采矿点
  GUARD_POST: 'guard_post', // 守卫位
});

/**
 * 势力阵营主题色（按 faction.type 映射）。
 * 用于领地色块与院墙描边，使不同阵营在地图上一眼可辨。
 * 渲染层用 0xRRGGBB，这里给十六进制字符串便于复用到 HTML 图例。
 */
export const FactionThemeColor = Object.freeze({
  righteous: '#3fa7d6',      // 正派：青蓝
  evil: '#b23a6b',           // 邪修：紫红
  demon: '#7a2e2e',          // 魔道：暗红
  mortal_kingdom: '#d4a437', // 王朝：金黄
  neutral: '#8a93a6',        // 中立：灰蓝
  default: '#8a93a6',
});

/** 阵营中文名（图例用） */
export const FactionTypeName = Object.freeze({
  righteous: '正派宗门',
  evil: '邪修宗门',
  demon: '魔道',
  mortal_kingdom: '凡俗王朝',
  neutral: '中立势力',
});

/** 建筑中文名 + 图例图标说明 */
export const BuildingName = Object.freeze({
  [BuildingType.MAIN_HALL]: '主殿',
  [BuildingType.QUEST_HALL]: '任务殿',
  [BuildingType.TRAINING]: '修炼场',
  [BuildingType.LIBRARY]: '藏经阁',
  [BuildingType.ALCHEMY]: '炼丹房',
  [BuildingType.GATE]: '山门',
  [BuildingType.MARKET]: '坊市',
  [BuildingType.MINE_NODE]: '采矿点',
  [BuildingType.GUARD_POST]: '守卫位',
});

/** 取势力主题色（十六进制字符串） */
export function themeColorOf(factionType) {
  return FactionThemeColor[factionType] || FactionThemeColor.default;
}

/** 将 "#RRGGBB" 转为 PixiJS 数值色 0xRRGGBB */
export function hexToInt(hex) {
  return parseInt(String(hex).replace('#', ''), 16);
}
