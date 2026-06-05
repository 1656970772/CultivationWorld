/**
 * InfoCoordinator —— 信息传播 / 机会点 / 怀璧其罪 编排服务（ADR-024/025）。
 *
 * 职责：编排已有的 InfoPropagationSystem / OpportunitySystem 两个子系统，按 tick 顺序推进：
 *   ① 事件 → 新闻 + 机会点（妖王陨落/秘境开启/宗门大战）spawnNewsFromEvents
 *   ② 多渠道传播（口耳/宗门/商会/城镇）propagateChannels
 *   ③ 怀璧其罪：暴露身家 + 觊觎抢夺 tickCovet
 *   ④ 系统每日推进（新闻扩散/过期、机会点过期）
 *   并提供 bestOpportunityFor（NPC 选目标层取最值得前往的机会点）与 enrichInfoEvents（补坐标/地点名）。
 *
 * 默认配置下三系统 enabled=false，整体静默。共享 helper 与子系统引用经 host 调用。
 */
import { NewsType, OpportunityType } from '../../../core/constants.js';
import {
  exchangeNews, syncSectNews, syncGuildNews, broadcastTownNews,
  computeAssetScore, settleRobbery, decideCovet,
} from '../../npc/info-actions.js';

export class InfoCoordinator {
  /**
   * @param {Object} deps
   * @param {import('../tick-manager.js').TickManager} deps.host
   */
  constructor({ host }) {
    this.host = host;
    this._lastSectSyncDay = -1;
    this._lastGuildSyncDay = -1;
  }

  get entityRegistry() { return this.host.entityRegistry; }
  get worldEntity() { return this.host.worldEntity; }
  get infoSystem() { return this.host.infoSystem; }
  get opportunitySystem() { return this.host.opportunitySystem; }
  get balanceConfig() { return this.host.balanceConfig; }
  get covetConfig() { return this.host.covetConfig; }
  get techniqueRegistry() { return this.host.techniqueRegistry; }
  get rng() { return this.host.rng; }

  /**
   * 为 infoEvents（攻击/结盟/妖兽袭击）补坐标与地点名，使其成为位置事件。
   */
  enrichInfoEvents(tickLog) {
    const host = this.host;
    const events = tickLog.infoEvents || [];
    for (const evt of events) {
      if (typeof evt.x === 'number' && typeof evt.y === 'number') continue;
      let pos = null;
      if (evt.type === 'attack' || evt.type === 'alliance') {
        const originId = evt.attackerId || evt.factionId;
        const origin = originId ? this.entityRegistry.getById(originId) : null;
        const hq = origin?.staticData?.headquarters;
        if (hq && typeof hq.x === 'number') pos = { x: hq.x, y: hq.y };
      } else if (evt.type === 'monster_attack') {
        const monster = evt.monsterId ? this.entityRegistry.getById(evt.monsterId) : null;
        const npc = evt.npcId ? this.entityRegistry.getById(evt.npcId) : null;
        pos = host._entityPos(monster) || host._entityPos(npc);
      }
      if (pos) {
        evt.x = pos.x; evt.y = pos.y;
        evt.locationName = evt.locationName || host._resolveLocationName(pos.x, pos.y);
      }
    }
  }

  /**
   * 信息传播 / 机会点 / 怀璧其罪 统一推进（ADR-024/025）。
   */
  tickInfoSystems(tickLog, npcs, worldContext) {
    const host = this.host;
    const day = this.worldEntity.currentDay;
    const info = this.infoSystem;
    const opp = this.opportunitySystem;
    const covetCfg = this.covetConfig || {};
    if (!info.enabled && !opp.enabled && covetCfg.enabled !== true) return;

    const log = tickLog.infoEvents;
    const powerFn = (n) => host._npcCombatPower(n);

    if (info.enabled || opp.enabled) {
      this.spawnNewsFromEvents(tickLog, day, log);
    }

    if (info.enabled) {
      this.propagateChannels(npcs, day, log);
    }

    if (covetCfg.enabled === true) {
      this.tickCovet(npcs, day, log, powerFn, worldContext);
    }

    if (info.enabled) {
      const spreadLog = info.tick({ currentDay: day, npcs });
      for (const e of spreadLog) log.push(e);
    }
    if (opp.enabled) {
      const expireLog = opp.tick(day);
      for (const e of expireLog) log.push(e);
    }
  }

  /**
   * 把本 tick 的世界事件转化为 WorldNews（+ 关联 WorldOpportunity）。
   */
  spawnNewsFromEvents(tickLog, day, log) {
    const info = this.infoSystem;
    const opp = this.opportunitySystem;

    const monsterResourceCfg = this.balanceConfig?.economy?.monsterResources || {};
    const corpseMinGrade = monsterResourceCfg.corpseOpportunityMinGrade ?? 3;
    for (const md of (tickLog.monsterDeaths || [])) {
      if ((md.grade ?? 0) < corpseMinGrade) continue;
      if (typeof md.x !== 'number') continue;
      let oppId = null;
      if (opp.enabled) {
        const grade = Math.max(1, Math.min(9, md.grade || 1));
        const value = (monsterResourceCfg.corpseValueBase ?? 240)
          + grade * (monsterResourceCfg.corpseValuePerGrade ?? 180);
        const o = opp.spawn({
          type: OpportunityType.MONSTER_CORPSE,
          pos: { x: md.x, y: md.y },
          currentDay: day,
          value,
          rewardSource: `opportunity_corpse_g${grade}`,
          name: `${grade}阶妖兽尸骸`,
        });
        oppId = o?.id ?? null;
      }
      const news = info.publishNews({
        type: NewsType.MONSTER_KING_DEATH, origin: { x: md.x, y: md.y }, day,
        value: opp.typeConfig(OpportunityType.MONSTER_CORPSE).value ?? 600,
        opportunityId: oppId,
        text: `${md.monsterName || '妖王'}陨落于${md.locationName || '荒野'}，遗下机缘`,
      });
      if (news) log.push({ type: 'news_born', newsType: news.type, newsId: news.id, x: md.x, y: md.y, day, description: news.text });
    }

    const wr = tickLog.worldRules;
    const newMod = wr?.modifier;
    if (newMod && /secret_realm|秘境/.test(`${newMod.id} ${newMod.name}`)) {
      const here = this.secretRealmPos();
      if (here) {
        let oppId = null;
        if (opp.enabled) {
          const o = opp.spawn({ type: OpportunityType.SECRET_REALM, pos: here, currentDay: day });
          oppId = o?.id ?? null;
        }
        const news = info.publishNews({
          type: NewsType.SECRET_REALM_OPEN, origin: here, day,
          value: opp.typeConfig(OpportunityType.SECRET_REALM).value ?? 1000,
          opportunityId: oppId,
          text: `${newMod.name || '秘境'}开启，引动天地灵机`,
        });
        if (news) log.push({ type: 'news_born', newsType: news.type, newsId: news.id, x: here.x, y: here.y, day, description: news.text });
      }
    }

    const dynamicEventItems = [
      ...(tickLog.dynamicEvents || []),
      ...(tickLog.dynamicEventBirths || []).map(event => ({ event, phase: event.phase })),
    ];
    for (const item of dynamicEventItems) {
      const event = item?.event || item;
      const phase = item?.phase || item?.to || event?.phase;
      if (!event || (phase !== 'announced' && phase !== 'active')) continue;
      const pos = this.dynamicEventPos(event);
      if (!pos) continue;

      let oppId = null;
      if (phase === 'active' && event.opportunityType && opp.enabled) {
        const spawned = opp.spawn({
          type: event.opportunityType,
          pos,
          currentDay: day,
          value: event.value,
          rewardSource: event.rewardSource,
          riskKey: event.riskKey,
          name: event.name,
          subjectId: event.subjectId,
        });
        oppId = spawned?.id ?? null;
      }

      const newsType = phase === 'active'
        ? NewsType.DYNAMIC_EVENT_ACTIVE
        : NewsType.DYNAMIC_EVENT_ANNOUNCED;
      const text = phase === 'active'
        ? `${event.name || '动态事件'}已进入可参与窗口`
        : `${event.name || '动态事件'}的消息传开了`;
      const news = info.publishNews({
        type: newsType,
        origin: pos,
        day,
        value: event.value ?? 0,
        subjectId: event.subjectId ?? event.id ?? null,
        opportunityId: oppId,
        text,
      });
      if (news) {
        log.push({
          type: 'news_born',
          newsType: news.type,
          newsId: news.id,
          eventId: event.id ?? item?.eventId ?? null,
          x: pos.x,
          y: pos.y,
          day,
          description: news.text,
        });
      }
    }

    for (const evt of (tickLog.infoEvents || [])) {
      if (evt.type !== 'attack' || typeof evt.x !== 'number' || evt._newsPublished) continue;
      evt._newsPublished = true;
      const news = info.publishNews({
        type: NewsType.FACTION_WAR, origin: { x: evt.x, y: evt.y }, day,
        value: 0, text: evt.description || '宗门交锋',
      });
      if (news) log.push({ type: 'news_born', newsType: news.type, newsId: news.id, x: evt.x, y: evt.y, day, description: news.text });
    }
  }

  /**
   * 为某 NPC 评估其已知消息关联的机会点，返回得分最高且可行的一个（ADR-024 决策层）。
   * @returns {{ opp:import('../opportunity.js').WorldOpportunity, score:number }|null}
   */
  bestOpportunityFor(entity) {
    const host = this.host;
    const opp = this.opportunitySystem;
    if (!opp.enabled || !entity?._knownNews || !entity.spatial) return null;
    const day = this.worldEntity.currentDay;
    const decision = opp.decision;
    const distCost = decision.distanceCostPerTile ?? 0.3;
    const minScore = decision.minScore ?? 50;
    const here = { x: entity.spatial.tileX, y: entity.spatial.tileY };
    const myPower = host._npcCombatPower(entity);

    let best = null, bestScore = -Infinity;
    for (const [, entry] of entity._knownNews) {
      if (!entry.opportunityId) continue;
      const o = opp.getById(entry.opportunityId);
      if (!o || !o.isOpen(day)) continue;
      if (o.type === OpportunityType.WEALTH_TARGET) continue;
      const winFactor = Math.max(0.05, Math.min(1, myPower / 10));
      const dist = Math.abs(o.pos.x - here.x) + Math.abs(o.pos.y - here.y);
      const score = o.value * entry.reliability * winFactor - dist * distCost;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best && bestScore >= minScore) {
      return { opp: best, score: bestScore };
    }
    return null;
  }

  /** 取一个秘境入口坐标（地图上最近的高/顶级灵脉格，回退世界中心）。 */
  secretRealmPos() {
    const host = this.host;
    const cx = Math.floor((this.worldEntity.state.get('width') || 300) / 2);
    const cy = Math.floor((this.worldEntity.state.get('height') || 300) / 2);
    return host.nearestTerrainTile(cx, cy, 'top_spirit_vein')
      || host.nearestTerrainTile(cx, cy, 'high_spirit_vein')
      || { x: cx, y: cy };
  }

  /**
   * 解析动态事件的世界坐标；无明确坐标时返回 null，让缺位行为保持静默。
   */
  dynamicEventPos(event) {
    const pos = event?.pos || null;
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      return { x: pos.x, y: pos.y };
    }
    if (pos?.resolver === 'secret_realm') {
      return this.secretRealmPos();
    }
    if (pos?.resolver === 'faction_hq') {
      const factionId = pos.factionId || event?.subjectId;
      if (factionId) {
        const faction = this.entityRegistry.getById(factionId);
        const hq = faction?.staticData?.headquarters;
        if (hq && typeof hq.x === 'number' && typeof hq.y === 'number') {
          return { x: hq.x, y: hq.y };
        }
      }
    }
    return null;
  }

  /** 多渠道传播：口耳相传 / 宗门情报网 / 商会情报网 / 城镇广播。 */
  propagateChannels(npcs, day, log) {
    const info = this.infoSystem;
    const belief = info.defaultBeliefThreshold;

    if (info.channelEnabled('oral')) {
      const cfg = info.channelConfig('oral');
      const d = cfg.meetDistance ?? 2;
      for (let i = 0; i < npcs.length; i++) {
        const a = npcs[i];
        if (!a.spatial) continue;
        for (let j = i + 1; j < npcs.length; j++) {
          const b = npcs[j];
          if (!b.spatial) continue;
          if (Math.abs(a.spatial.tileX - b.spatial.tileX) + Math.abs(a.spatial.tileY - b.spatial.tileY) > d) continue;
          exchangeNews(a, b, cfg, day, belief);
        }
      }
    }

    const byFaction = new Map();
    for (const npc of npcs) {
      const fid = npc.state?.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }
    const sectCfg = info.channelConfig('sect');
    const guildCfg = info.channelConfig('guild');
    const sectInterval = sectCfg.syncIntervalDays ?? 5;
    const guildInterval = guildCfg.syncIntervalDays ?? 3;
    const doSect = info.channelEnabled('sect') && day - this._lastSectSyncDay >= sectInterval;
    const doGuild = info.channelEnabled('guild') && day - this._lastGuildSyncDay >= guildInterval;
    if (doSect) this._lastSectSyncDay = day;
    if (doGuild) this._lastGuildSyncDay = day;
    for (const [fid, members] of byFaction) {
      const faction = this.entityRegistry.getById(fid);
      const isGuild = faction?.staticData?.type === 'mortal_kingdom' || /org_|商会|坊市/.test(fid);
      if (isGuild) {
        if (doGuild) syncGuildNews(members, guildCfg, day);
      } else if (doSect) {
        syncSectNews(members, sectCfg, day);
      }
    }

    if (info.channelEnabled('town')) {
      const townCfg = info.channelConfig('town');
      const recent = this.recentHotNews(day, townCfg);
      if (recent.length > 0) {
        for (const npc of npcs) {
          if (!npc.spatial) continue;
          if (!this.isAtTown(npc.spatial.tileX, npc.spatial.tileY)) continue;
          broadcastTownNews(npc, recent, townCfg, day, belief);
        }
      }
    }
  }

  /** 近期热门新闻（按重要性排序，截断 maxBroadcast 条）。 */
  recentHotNews(day, townCfg) {
    const recentDays = townCfg.recentDays ?? 30;
    const max = townCfg.maxBroadcast ?? 5;
    return this.infoSystem.activeNews
      .filter(n => day - n.day <= recentDays)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, max);
  }

  /** 某坐标是否位于某机构 HQ（坊市/酒馆视为城镇）。 */
  isAtTown(x, y) {
    for (const f of this.entityRegistry.getByType('faction')) {
      const hq = f.staticData?.headquarters;
      if (hq && Math.abs(hq.x - x) <= 1 && Math.abs(hq.y - y) <= 1) return true;
    }
    return false;
  }

  /** 怀璧其罪：暴露高身家 → 生成消息 + 机会点；听闻者觊觎抢夺/放过。worldContext 供抢夺致死走统一伤害管线（ADR-042）。 */
  tickCovet(npcs, day, log, powerFn, worldContext) {
    const host = this.host;
    const covetCfg = this.covetConfig;
    const exposeCfg = covetCfg.expose || {};
    const threshold = exposeCfg.exposeThreshold ?? 500;
    const witnessD = exposeCfg.witnessDistance ?? 3;
    const exposeChance = exposeCfg.exposeChancePerDay ?? 0.15;

    for (const npc of npcs) {
      if (!npc.spatial) continue;
      const asset = computeAssetScore(npc, this.techniqueRegistry);
      if (asset < threshold) continue;
      npc._assetScore = asset;
      if (npc._wealthExposed) continue;
      if (this.rng.next() >= exposeChance) continue;
      let witnessed = false;
      for (const other of npcs) {
        if (other.id === npc.id || !other.spatial) continue;
        if (Math.abs(other.spatial.tileX - npc.spatial.tileX) + Math.abs(other.spatial.tileY - npc.spatial.tileY) <= witnessD) {
          witnessed = true;
          break;
        }
      }
      if (!witnessed) continue;
      npc._wealthExposed = true;

      let oppId = null;
      if (this.opportunitySystem.enabled) {
        const o = this.opportunitySystem.spawn({
          type: OpportunityType.WEALTH_TARGET, pos: { x: npc.spatial.tileX, y: npc.spatial.tileY },
          currentDay: day, value: asset, subjectId: npc.id,
        });
        oppId = o?.id ?? null;
      }
      const news = this.infoSystem.publishNews({
        type: NewsType.WEALTH_EXPOSED, origin: { x: npc.spatial.tileX, y: npc.spatial.tileY }, day,
        value: asset, subjectId: npc.id, opportunityId: oppId,
        text: `${npc.staticData.name} 身怀重宝（估值${asset}）的消息不胫而走`,
      });
      if (news) log.push({ type: 'wealth_exposed', newsId: news?.id, npcId: npc.id, npcName: npc.name, assetScore: asset, x: npc.spatial.tileX, y: npc.spatial.tileY, day, description: news.text });
    }

    const robbedThisTick = new Set();
    for (const seeker of npcs) {
      if (!seeker.alive || !seeker._knownNews) continue;
      for (const [, entry] of seeker._knownNews) {
        if (entry.type !== NewsType.WEALTH_EXPOSED || !entry.subjectId) continue;
        if (robbedThisTick.has(entry.subjectId)) continue;
        const target = this.entityRegistry.getById(entry.subjectId);
        if (!target || !target.alive || target.id === seeker.id) continue;
        const asset = target._assetScore ?? computeAssetScore(target, this.techniqueRegistry);
        const decision = decideCovet(seeker, target, asset, covetCfg, powerFn);
        if (decision.spare) {
          log.push({ type: 'covet_spare', seekerId: seeker.id, seekerName: seeker.name, targetId: target.id, targetName: target.name, day, description: `${seeker.staticData.name} 顾念情面，放过了怀宝的 ${target.staticData?.name || target.id}` });
          continue;
        }
        if (!decision.act) continue;
        if (seeker.spatial && target.spatial) {
          const dist = Math.abs(seeker.spatial.tileX - target.spatial.tileX) + Math.abs(seeker.spatial.tileY - target.spatial.tileY);
          if (dist > 6) continue;
        }
        const result = settleRobbery(seeker, target, covetCfg, powerFn, this.rng, worldContext);
        robbedThisTick.add(target.id);
        target._wealthExposed = false;
        if (typeof target.recordMemory === 'function') {
          target.recordMemory('humiliated', { actorId: seeker.id, tick: day, location: target.spatial ? { x: target.spatial.tileX, y: target.spatial.tileY } : null });
          host._applyRelationEvent('humiliated', target.id, seeker.id);
        }
        log.push({ type: 'covet_rob', seekerId: seeker.id, seekerName: seeker.name, targetId: target.id, targetName: target.name, success: result.success, killed: result.killed, day, x: seeker.spatial?.tileX ?? null, y: seeker.spatial?.tileY ?? null, description: result.description });
      }
    }
  }
}
