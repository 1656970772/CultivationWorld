/**
 * PopulationService —— 人口演化服务：道侣匹配与生育（社交层）。
 *
 * 职责：从 TickManager 抽离的两项定时人口事件：
 *   - matchDaoCompanions：按境界差/年龄/同门加成为单身修士配对道侣（建 dao_companion 关系边）。
 *   - processBirths：道侣有概率诞下后代 NPC（性格双亲遗传 + 变异，建 kin 血亲边）。
 *
 * 自有 birthLog / companionLog（供报告读取，经 TickManager getter 暴露）。
 * 共享 helper（_applyRelationEvent / _emitLocationEvent / entityConfig 等）经 host 调用。
 */
import { NPCEntity } from '../../npc/npc-entity.js';

export class PopulationService {
  /**
   * @param {Object} deps
   * @param {import('../tick-manager.js').TickManager} deps.host
   */
  constructor({ host }) {
    this.host = host;
    this.birthLog = [];
    this.companionLog = [];
  }

  get entityRegistry() { return this.host.entityRegistry; }
  get worldEntity() { return this.host.worldEntity; }
  get balanceConfig() { return this.host.balanceConfig; }
  get rng() { return this.host.rng; }

  /**
   * 道侣匹配 - 同门或友好势力间的修士结为道侣
   */
  matchDaoCompanions(worldContext, tickLog) {
    const host = this.host;
    const socialCfg = this.balanceConfig.social || {};
    const companionCfg = socialCfg.daoCompanion || {};

    const minAge = companionCfg.minAgeYears ?? 20;
    const maxLifeRatio = companionCfg.maxLifeRatio ?? 0.8;
    const maxRankDiff = companionCfg.maxRankDiff ?? 1;
    const sameFactionBonus = companionCfg.sameFactionScoreBonus ?? 20;
    const baseScore = companionCfg.baseScore ?? 10;
    const ageDiffScoreRange = companionCfg.ageDiffScoreRange ?? 10;
    const ageDiffScaleFactor = companionCfg.ageDiffScaleFactor ?? 10;
    const successRate = companionCfg.matchSuccessRate ?? 0.15;

    const npcs = this.entityRegistry.getAliveByType('npc');
    const singles = npcs.filter(n =>
      !n.state.get('daoCompanionId') &&
      n.state.get('ageYears') >= minAge &&
      n.state.get('lifeRatio') < maxLifeRatio
    );

    const males = singles.filter(n => n.state.get('gender') === 'male');
    const females = singles.filter(n => n.state.get('gender') === 'female');

    const RANK_ORDER = {
      mortal: 0, disciple: 0, qi_refining: 1,
      foundation_building: 2, golden_core: 3,
      nascent_soul: 4, spirit_transformation: 5,
    };

    const matched = new Set();
    const pairs = [];

    for (const m of males) {
      if (matched.has(m.id)) continue;
      const mFaction = m.state.get('factionId');
      const mRankOrder = RANK_ORDER[m.state.get('rankId')] ?? 0;

      let bestMatch = null;
      let bestMatchScore = -1;

      for (const f of females) {
        if (matched.has(f.id)) continue;
        const fFaction = f.state.get('factionId');
        const fRankOrder = RANK_ORDER[f.state.get('rankId')] ?? 0;

        if (Math.abs(mRankOrder - fRankOrder) > maxRankDiff) continue;

        let score = baseScore;
        if (mFaction === fFaction) score += sameFactionBonus;

        const ageDiff = Math.abs(m.state.get('ageYears') - f.state.get('ageYears'));
        score += Math.max(0, ageDiffScoreRange - ageDiff / ageDiffScaleFactor);

        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatch = f;
        }
      }

      if (bestMatch && this.rng.next() < successRate) {
        m.state.set('daoCompanionId', bestMatch.id);
        bestMatch.state.set('daoCompanionId', m.id);
        matched.add(m.id);
        matched.add(bestMatch.id);
        host._applyRelationEvent('dao_companion_matched', m.id, bestMatch.id);
        const entry = {
          day: this.worldEntity.currentDay,
          npc1Id: m.id, npc1Name: m.name,
          npc2Id: bestMatch.id, npc2Name: bestMatch.name,
          faction: m.state.get('factionId'),
        };
        pairs.push(entry);
        this.companionLog.push(entry);
      }
    }

    for (const p of pairs) {
      const m = this.entityRegistry.getById(p.npc1Id);
      host._emitLocationEvent(tickLog, { type: 'dao_companion', entity: m, ...p });
    }
  }

  /**
   * 生育系统 - 道侣有机会诞生后代 NPC
   */
  processBirths(worldContext, tickLog) {
    const host = this.host;
    const socialCfg = this.balanceConfig.social || {};
    const birthCfg = socialCfg.birth || {};

    const successRate = birthCfg.successRate ?? 0.20;
    const maxChildren = birthCfg.maxChildren ?? 3;
    const motherMaxLifeRatio = birthCfg.motherMaxLifeRatio ?? 0.7;
    const fatherWeight = birthCfg.childPersonalityFatherWeight ?? 0.5;
    const motherWeight = birthCfg.childPersonalityMotherWeight ?? 0.5;
    const loyaltyBase = birthCfg.childLoyaltyBase ?? 60;
    const loyaltyVariance = birthCfg.childLoyaltyVariance ?? 40;
    const diplomacyMax = birthCfg.childDiplomacyMax ?? 80;
    const mutationRange = birthCfg.personalityMutationRange ?? 20;

    const rng = this.rng;
    const inheritTrait = (father, mother, trait) => {
      const f = father.staticData?.get('personality')?.[trait] ?? 50;
      const m = mother.staticData?.get('personality')?.[trait] ?? 50;
      const avg = (f + m) / 2;
      const mutated = avg + (rng.next() * 2 - 1) * mutationRange;
      return Math.round(Math.max(0, Math.min(100, mutated)));
    };

    const surnames = host.namesConfig.surnames || ['陈', '李', '张', '王', '刘'];
    const maleNames = host.namesConfig.maleNames || ['天', '云', '风', '龙'];
    const femaleNames = host.namesConfig.femaleNames || ['月', '雪', '兰', '瑶'];

    const npcs = this.entityRegistry.getAliveByType('npc');
    const processed = new Set();
    const births = [];

    for (const npc of npcs) {
      const companionId = npc.state.get('daoCompanionId');
      if (!companionId || processed.has(npc.id)) continue;
      processed.add(npc.id);
      processed.add(companionId);

      const companion = this.entityRegistry.getById(companionId);
      if (!companion || !companion.alive) continue;

      const mother = npc.state.get('gender') === 'female' ? npc : companion;
      const father = npc.state.get('gender') === 'female' ? companion : npc;

      if (mother.state.get('lifeRatio') >= motherMaxLifeRatio) continue;
      if (mother.state.get('childrenCount') >= maxChildren) continue;

      if (rng.next() > successRate) continue;

      const childGender = rng.next() < 0.5 ? 'male' : 'female';
      const namePool = childGender === 'male' ? maleNames : femaleNames;
      const surname = father.name.charAt(0);
      const useSurname = surnames.includes(surname) ? surname : surnames[Math.floor(rng.next() * surnames.length)];
      const givenName = namePool[Math.floor(rng.next() * namePool.length)];
      const childName = useSurname + givenName;

      const childId = `npc_born_${host._nextBornNpcId()}`;
      const factionId = mother.state.get('factionId') || father.state.get('factionId');

      const childConfig = {
        id: childId,
        name: childName,
        factionId: factionId,
        role: 'disciple',
        personality: {
          ambition: Math.floor((father.staticData?.get('personality')?.ambition || 50) * fatherWeight + rng.next() * 50),
          caution: Math.floor((mother.staticData?.get('personality')?.caution || 50) * motherWeight + rng.next() * 50),
          loyalty: Math.floor(Math.min(100, loyaltyBase + rng.next() * loyaltyVariance)),
          diplomacy: Math.floor(rng.next() * diplomacyMax),
          courage: inheritTrait(father, mother, 'courage'),
          justice: inheritTrait(father, mother, 'justice'),
        },
        alive: true,
        gender: childGender,
        rankId: 'mortal',
      };

      const child = new NPCEntity(childConfig, host.ranksData, host.entityConfig);
      child.state.set('ageDays', 0);
      child.state.set('ageYears', 0);
      this.entityRegistry.register(child);

      mother.state.set('childrenCount', (mother.state.get('childrenCount') || 0) + 1);
      father.state.set('childrenCount', (father.state.get('childrenCount') || 0) + 1);

      host._applyRelationEvent('birth', father.id, child.id);
      host._applyRelationEvent('birth', mother.id, child.id);

      const entry = {
        day: this.worldEntity.currentDay,
        childId, childName, childGender,
        fatherId: father.id, fatherName: father.name,
        motherId: mother.id, motherName: mother.name,
        factionId,
      };
      births.push(entry);
      this.birthLog.push(entry);
    }

    for (const b of births) {
      const mother = this.entityRegistry.getById(b.motherId);
      host._emitLocationEvent(tickLog, { type: 'birth', entity: mother, ...b });
    }
  }
}
