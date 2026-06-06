/**
 * info-actions.js - 信息传播多渠道 + 怀璧其罪/觊觎抢夺 辅助逻辑（ADR-024/025）
 *
 * 这些函数被 TickManager 在相应时机调用，职责单一、纯函数式（输入实体/上下文，产出日志）：
 *   - exchangeNews     口耳相传：两 NPC 相遇互传已知消息。
 *   - syncSectNews     宗门情报网：同 factionId 成员同步已知消息。
 *   - syncGuildNews    商会情报网：商会/王朝类机构成员跨地共享。
 *   - broadcastTownNews 城镇广播：进入坊市/酒馆所在机构 HQ 获得近期热门消息。
 *   - computeAssetScore 身家估值（功法品阶 + 法宝 + 物品 + 灵石）。
 *   - decideCovet      听闻怀璧消息后的『抢夺 vs 放他一马』决策。
 *   - settleRobbery    抢夺结算（PvP + 物品转移）。
 *
 * 所有逻辑均在对应系统 enabled=true 时才被 TickManager 调用。
 */
import { receiveNews } from '../world/info-propagation.js';
import { ItemRegistry } from '../items/item-registry.js';
import { killNPCByPvP } from './npc-actions.js';

/** NPC 的已知消息 Map（懒初始化）。 */
function knownNewsOf(npc) {
  if (!npc._knownNews) npc._knownNews = new Map();
  return npc._knownNews;
}

/**
 * 口耳相传：a、b 相遇时互传各自已知消息，转述使可信度按 reliabilityDecay 衰减。
 * @returns {number} 实际新传出的消息条数
 */
export function exchangeNews(a, b, channelCfg, currentDay, defaultBelief) {
  const decay = channelCfg?.reliabilityDecay ?? 0.85;
  let transferred = 0;
  transferred += _shareInto(a, b, decay, currentDay, defaultBelief);
  transferred += _shareInto(b, a, decay, currentDay, defaultBelief);
  return transferred;
}

function _shareInto(from, to, decay, currentDay, defaultBelief) {
  const fromNews = knownNewsOf(from);
  const toNews = knownNewsOf(to);
  let n = 0;
  for (const [newsId, entry] of fromNews) {
    const newReliability = entry.reliability * decay;
    const prev = toNews.get(newsId);
    if (prev && prev.reliability >= newReliability) continue;
    const threshold = to.state?.personality?.beliefThreshold ?? defaultBelief;
    if (newReliability < threshold) continue;
    toNews.set(newsId, { ...entry, reliability: newReliability, tickKnown: currentDay });
    n++;
  }
  return n;
}

/**
 * 宗门情报网：把同门成员已知的消息汇总，再下发给所有成员（取最高可信度），
 * 体现"长老知 → 弟子知"的快速同步。reliability 不低于渠道下限。
 * @param {Array} members 同 factionId 的在世 NPC
 */
export function syncSectNews(members, channelCfg, currentDay) {
  if (!Array.isArray(members) || members.length < 2) return 0;
  const minRel = channelCfg?.reliability ?? 0.9;
  return _syncGroup(members, minRel, currentDay);
}

/** 商会情报网：与宗门类似，但跨地点（成员可能分散），可信度门槛略低。 */
export function syncGuildNews(members, channelCfg, currentDay) {
  if (!Array.isArray(members) || members.length < 2) return 0;
  const minRel = channelCfg?.reliability ?? 0.85;
  return _syncGroup(members, minRel, currentDay);
}

function _syncGroup(members, channelReliability, currentDay) {
  // 1) 汇总组内最高可信度版本
  const pooled = new Map();
  for (const m of members) {
    for (const [newsId, entry] of knownNewsOf(m)) {
      const cur = pooled.get(newsId);
      const rel = Math.max(entry.reliability, channelReliability);
      if (!cur || cur.reliability < rel) {
        pooled.set(newsId, { ...entry, reliability: rel });
      }
    }
  }
  // 2) 下发给所有成员
  let updates = 0;
  for (const m of members) {
    const kn = knownNewsOf(m);
    for (const [newsId, entry] of pooled) {
      const prev = kn.get(newsId);
      if (prev && prev.reliability >= entry.reliability) continue;
      kn.set(newsId, { ...entry, tickKnown: currentDay });
      updates++;
    }
  }
  return updates;
}

/**
 * 城镇广播：NPC 进入有坊市/酒馆的机构 HQ 时，从该机构 recentNews 池获得最近热门消息。
 * 机构 recentNews 由 TickManager 在 publishNews 时按坐标归集（此处直接读取传入的 newsList）。
 * @param {Object} npc
 * @param {Array} newsList 近期热门 WorldNews（已按重要性排序、截断）
 */
export function broadcastTownNews(npc, newsList, channelCfg, currentDay, defaultBelief) {
  const reliability = channelCfg?.reliability ?? 0.7;
  const kn = knownNewsOf(npc);
  let n = 0;
  for (const news of newsList) {
    const threshold = npc.state?.personality?.beliefThreshold ?? defaultBelief;
    if (reliability < threshold) continue;
    const prev = kn.get(news.id);
    if (prev && prev.reliability >= reliability) continue;
    kn.set(news.id, {
      newsId: news.id, type: news.type, reliability,
      value: news.value, origin: news.origin,
      opportunityId: news.opportunityId, subjectId: news.subjectId,
      tickKnown: currentDay,
    });
    n++;
  }
  return n;
}

/**
 * 身家估值（怀璧其罪的"璧"，ADR-025）：
 *   assetScore = 灵石 + Σ(可转移物品 value × 数量) + 已装备法宝 value + 功法品阶价值。
 * @param {Object} npc
 * @param {Map} [techniqueRegistry] 功法注册表（读 grade 估值）
 * @returns {number}
 */
export function computeAssetScore(npc, techniqueRegistry = null) {
  if (!npc?.inventory) return 0;
  let score = 0;
  const items = npc.inventory.getAll();
  for (const [itemId, amount] of Object.entries(items)) {
    if (itemId === 'low_spirit_stone') { score += amount; continue; }
    const def = ItemRegistry.get(itemId);
    const value = def?.properties?.value ?? def?.value ?? 0;
    score += value * amount;
  }
  // 已装备法宝
  const artifactId = npc.state?.get('equippedArtifactId');
  if (artifactId) {
    const def = ItemRegistry.get(artifactId);
    score += def?.properties?.value ?? def?.value ?? 0;
  }
  // 功法品阶价值（grade 越高越招摇）
  const techId = npc.state?.get('techniqueId');
  if (techId && techniqueRegistry?.get) {
    const tech = techniqueRegistry.get(techId);
    const grade = tech?.gradeNum ?? tech?.grade ?? 0;
    score += grade * 800;
  }
  return Math.round(score);
}

/**
 * 觊觎决策（ADR-025）：seeker 听闻 target 怀璧后，决定『抢夺』还是『放他一马』。
 * @returns {{ act:boolean, spare:boolean, reason:string }}
 */
export function decideCovet(seeker, target, assetScore, covetCfg, powerFn) {
  if (!seeker || !target || seeker.id === target.id) {
    return { act: false, spare: false, reason: 'invalid' };
  }
  const covet = covetCfg?.covet || {};
  const spareCfg = covetCfg?.spare || {};
  const personality = seeker.state?.personality || {};

  // 1) 起贪念门槛：身家、战力优势、贪婪性格
  if (assetScore < (covet.minAssetScore ?? 500)) {
    return { act: false, spare: false, reason: 'asset_too_low' };
  }
  const myPower = powerFn ? powerFn(seeker) : 1;
  const targetPower = powerFn ? powerFn(target) : 1;
  if (myPower < targetPower * (covet.powerSafetyFactor ?? 1.2)) {
    return { act: false, spare: false, reason: 'not_strong_enough' };
  }
  const courage = personality.courage ?? 50;
  if (courage < (covet.courageThreshold ?? 55)) {
    return { act: false, spare: false, reason: 'too_timid' };
  }
  const justice = personality.justice ?? 50;
  const greedScore = assetScore * (courage / 100) * Math.max(0, 1 - justice / 150);
  if (greedScore < (covet.minGreedScore ?? 300)) {
    return { act: false, spare: false, reason: 'greed_too_low' };
  }

  // 2) 放他一马判定：身份/恩义/道侣/性格累加，达阈值则放过
  let spareScore = 0;
  const sameFaction = seeker.state?.get('factionId') &&
    seeker.state.get('factionId') === target.state?.get('factionId');
  if (sameFaction) spareScore += spareCfg.sameFactionWeight ?? 0.7;

  const protectedRoles = spareCfg.protectedRoles || [];
  if (protectedRoles.includes(target.state?.get('currentRole'))) {
    spareScore += spareCfg.protectedRoleWeight ?? 0.5;
  }
  const gratitude = seeker.relationships?.getGratitude(target.id) ?? 0;
  if (gratitude > 0) {
    spareScore += Math.min(spareCfg.gratitudeMaxWeight ?? 1.0,
      gratitude / (spareCfg.gratitudeDivisor ?? 80));
  }
  if (seeker.state?.get('daoCompanionId') === target.id) {
    spareScore += spareCfg.daoCompanionWeight ?? 1.0;
  }
  spareScore += justice / (spareCfg.justiceDivisor ?? 120);
  spareScore += (personality.diplomacy ?? 50) / (spareCfg.diplomacyDivisor ?? 150);

  if (spareScore >= (spareCfg.spareThreshold ?? 1.0)) {
    return { act: false, spare: true, reason: 'spared' };
  }
  return { act: true, spare: false, reason: 'covet' };
}

/**
 * 抢夺结算（ADR-025）：robber 对 victim 发动掠夺。
 * 胜率 = myPower/(myPower+targetPower)。胜则转移可转移物品 + 部分灵石，按概率击杀。
 * @returns {{ success:boolean, killed:boolean, loot:Object, description:string }}
 */
export function settleRobbery(robber, victim, covetCfg, powerFn, rng, worldContext) {
  const robCfg = covetCfg?.rob || {};
  const myPower = powerFn ? powerFn(robber) : 1;
  const targetPower = powerFn ? powerFn(victim) : 1;
  const winChance = myPower / Math.max(1e-6, myPower + targetPower);
  const win = rng.next() < winChance;

  if (!win) {
    const injury = robCfg.loserInjuryOnLoss ?? 2;
    robber.state.set('injuryLevel', (robber.state.get('injuryLevel') || 0) + injury);
    return {
      success: false, killed: false, loot: {},
      description: `${robber.staticData.name} 欲劫掠 ${victim.staticData?.name || victim.id}，反被击退负伤`,
    };
  }

  // 转移可转移物品
  const loot = transferLoot(victim, robber, robCfg.lootStoneRatio ?? 0.6);
  // 杀人夺宝
  let killed = false;
  if (rng.next() < (robCfg.killChanceOnWin ?? 0.3)) {
    // ADR-042：劫掠致死走统一伤害管线，受害者持遁地符可锁血/遁地逃生。
    const kill = killNPCByPvP(victim, robber, worldContext);
    killed = kill.died;
  }
  const lootDesc = describeLoot(loot);
  return {
    success: true, killed, loot,
    description: `${robber.staticData.name} 劫掠 ${victim.staticData?.name || victim.id}${killed ? '并将其杀害' : ''}，夺得${lootDesc}`,
  };
}

/**
 * 把 victim 身上可转移物品与部分灵石转移到 robber。
 * @returns {Object} 战利品 { itemId: amount, ...,（含 low_spirit_stone）}
 */
export function transferLoot(victim, robber, stoneRatio) {
  const loot = {};
  if (!victim?.inventory || !robber?.inventory) return loot;
  const items = victim.inventory.getAll();
  for (const [itemId, amount] of Object.entries(items)) {
    if (itemId === 'low_spirit_stone') {
      const taken = Math.floor(amount * stoneRatio);
      if (taken > 0) {
        victim.inventory.remove(itemId, taken);
        robber.inventory.add(itemId, taken);
        loot[itemId] = taken;
      }
      continue;
    }
    const def = ItemRegistry.get(itemId);
    const transferable = def?.properties?.transferable ?? def?.transferable ?? false;
    if (!transferable) continue;
    victim.inventory.remove(itemId, amount);
    robber.inventory.add(itemId, amount);
    loot[itemId] = amount;
  }
  // 夺取已装备法宝
  const artifactId = victim.state?.get('equippedArtifactId');
  if (artifactId) {
    victim.state.set('equippedArtifactId', null);
    victim.refreshArtifactCombatModifiers?.();
    const cur = robber.state?.get('equippedArtifactId');
    if (!cur) {
      robber.state.set('equippedArtifactId', artifactId);
      robber.refreshArtifactCombatModifiers?.();
    } else {
      robber.inventory.add(artifactId, 1);
    }
    loot[artifactId] = (loot[artifactId] || 0) + 1;
  }
  return loot;
}

function describeLoot(loot) {
  const parts = [];
  for (const [itemId, amount] of Object.entries(loot)) {
    if (itemId === 'low_spirit_stone') { parts.push(`灵石×${amount}`); continue; }
    const def = ItemRegistry.get(itemId);
    parts.push(`${def?.name || itemId}×${amount}`);
  }
  return parts.length > 0 ? parts.join('、') : '些许财物';
}
