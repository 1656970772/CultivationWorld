/**
 * FactionAIService —— 势力 AI 决策服务（策略模式，对应 design-patterns.md 第 3 节）。
 *
 * 职责：承载势力的全部"对外决策"行为与态势计算：
 *   - 领地扩张 expandTerritory
 *   - 攻伐敌对 attackEnemy（含战果结算、攻战致死、宿敌结边）
 *   - 结盟 formAlliance
 *   - 贸易 conductTrade
 *   - 态势评估 checkAdjacentUnowned / checkAdjacentEnemy / calculateBorderThreat
 *     / checkWeakEnemy / calculateMilitaryAdvantage
 *   - 沿阶梯晋升 promoteByLadder（被"挑战上位"行为调用）
 *
 * 设计：从 TickManager._buildWorldContext 中抽离（原内联在返回对象字面量里）。
 *   - 战斗/外交/贸易参数在构造时一次性从 balanceConfig.combat 读出并缓存为字段（与原逻辑等价）。
 *   - 共享 helper（地理邻接、战力、记仇、晋升底层、位置/关系写边）通过 host(TickManager) 调用，
 *     避免逻辑重复，保证行为零漂移。
 *   - 攻击/结盟产生的 infoEvents 写入每 tick 传入的数组（与原 worldContext.infoEvents 同一引用）。
 *
 * 扩展（OCP）：新增势力类型的差异化决策，可继承本类覆写对应方法，或在此基于 faction.factionType 分派，
 *   无需改动 TickManager 或其他实体代码。
 */
export class FactionAIService {
  /**
   * @param {Object} deps
   * @param {import('../tick-manager.js').TickManager} deps.host 宿主 TickManager（提供共享 helper 与状态）
   * @param {Object} deps.combatConfig balanceConfig.combat
   */
  constructor({ host, combatConfig }) {
    this.host = host;
    const combatCfg = combatConfig || {};

    // 外交阈值
    this.hostileThreshold = combatCfg.diplomacy?.hostileThreshold ?? -50;
    this.alignmentHostileThreshold = combatCfg.diplomacy?.alignmentHostileThreshold ?? 0;
    this.weakEnemyStability = combatCfg.diplomacy?.weakEnemyStabilityThreshold ?? 30;
    this.weakEnemyDisciples = combatCfg.diplomacy?.weakEnemyDisciplesThreshold ?? 50;
    this.maxTerritory = combatCfg.diplomacy?.maxTerritory ?? 50;

    // 军事权重
    this.disciplesWeight = combatCfg.military?.disciplesWeight ?? 1.0;
    this.territoryWeight = combatCfg.military?.territoryWeight ?? 10;
    this.stabilityWeight = combatCfg.military?.stabilityWeight ?? 0.5;

    // 结盟
    this.allyMinRel = combatCfg.alliance?.minRelation ?? 20;
    this.allyMaxRel = combatCfg.alliance?.maxRelation ?? 60;
    this.allyRelGain = combatCfg.alliance?.relationGain ?? 20;

    // 贸易
    this.tradeStoneRatio = combatCfg.trade?.stoneRatio ?? 0.1;
    this.tradeMaxAmount = combatCfg.trade?.maxTradeAmount ?? 200;
    this.tradeFoodRate = combatCfg.trade?.foodExchangeRate ?? 2;
    this.tradeRelGain = combatCfg.trade?.relationGain ?? 3;
    this.tradeMinRel = combatCfg.trade?.minRelation ?? 20;

    // 攻击
    this.attackerMult = combatCfg.attack?.attackerPowerMultiplier ?? 1.2;
    this.attackerStabFactor = combatCfg.attack?.attackerStabilityFactor ?? 200;
    this.defenderMult = combatCfg.attack?.defenderPowerMultiplier ?? 1.0;
    this.defenderStabFactor = combatCfg.attack?.defenderStabilityFactor ?? 100;
    this.winLootRatio = combatCfg.attack?.winLootRatio ?? 0.2;
    this.winDefLoss = combatCfg.attack?.winDefenderDisciplineLossRatio ?? 0.08;
    this.winDefMin = combatCfg.attack?.winDefenderMinDisciples ?? 5;
    this.winDefStabLoss = combatCfg.attack?.winDefenderStabilityLoss ?? 15;
    this.winAttLoss = combatCfg.attack?.winAttackerDisciplineLossRatio ?? 0.05;
    this.winAttMin = combatCfg.attack?.winAttackerMinDisciples ?? 5;
    this.winAttStabLoss = combatCfg.attack?.winAttackerStabilityLoss ?? 5;
    this.loseAttLoss = combatCfg.attack?.loseAttackerDisciplineLossRatio ?? 0.10;
    this.loseAttMin = combatCfg.attack?.loseAttackerMinDisciples ?? 5;
    this.loseAttStabLoss = combatCfg.attack?.loseAttackerStabilityLoss ?? 10;
    this.loseDefStabGain = combatCfg.attack?.loseDefenderStabilityGain ?? 5;
    this.winRelChange = combatCfg.attack?.winRelationChange ?? -20;
    this.loseRelChange = combatCfg.attack?.loseRelationChange ?? -10;
    this.maxTerritoryPerFaction = combatCfg.attack?.maxTerritoryPerFaction ?? 20;
    this.winNpcKillRatio = combatCfg.attack?.winNpcKillRatio ?? 0.005;
    this.winNpcKillMax = combatCfg.attack?.winNpcKillMax ?? 2;
    this.winNpcKillMinDefender = combatCfg.attack?.winNpcKillMinDefender ?? 50;
    this.winNpcKillStabilityFloor = combatCfg.attack?.winNpcKillStabilityFloor ?? 30;
  }

  get entityRegistry() { return this.host.entityRegistry; }
  get worldEntity() { return this.host.worldEntity; }

  checkAdjacentUnowned(territory) {
    if (!territory || territory.length === 0) return true;
    const tileIndex = this.host.tileIndex;
    for (const key of territory) {
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        const neighbor = tileIndex.get(`${nx},${ny}`);
        if (neighbor && !neighbor.ownerId) return true;
      }
    }
    return false;
  }

  checkAdjacentEnemy(territory, relations, selfFactionId) {
    const selfFaction = selfFactionId ? this.entityRegistry.getById(selfFactionId) : null;
    const selfType = selfFaction?.factionType || '';

    for (const [fId, rel] of Object.entries(relations || {})) {
      const enemy = this.entityRegistry.getById(fId);
      if (!enemy || !enemy.alive) continue;

      let hostile = false;
      if (rel <= this.hostileThreshold) {
        hostile = true;
      } else if (rel <= this.alignmentHostileThreshold && selfType && enemy.factionType) {
        const enemyType = enemy.factionType;
        hostile =
          (selfType === 'righteous' && (enemyType === 'evil' || enemyType === 'demon')) ||
          ((selfType === 'evil' || selfType === 'demon') && enemyType === 'righteous');
      }
      if (!hostile) continue;

      if (this.host._factionsGeographicallyClose(selfFactionId, fId)) return true;
    }
    return false;
  }

  calculateBorderThreat(territory, relations) {
    let threat = 0;
    for (const [fId, rel] of Object.entries(relations || {})) {
      if (rel <= this.hostileThreshold) {
        const enemy = this.entityRegistry.getById(fId);
        if (enemy && enemy.alive) threat++;
      }
    }
    return threat;
  }

  checkWeakEnemy(relations) {
    for (const [fId, rel] of Object.entries(relations || {})) {
      if (rel <= this.hostileThreshold) {
        const enemy = this.entityRegistry.getById(fId);
        if (enemy && enemy.alive) {
          const stability = enemy.state?.get('stability') || 50;
          const disciples = enemy.inventory?.getAmount('disciples') || 0;
          if (stability < this.weakEnemyStability || disciples < this.weakEnemyDisciples) return true;
        }
      }
    }
    return false;
  }

  calculateMilitaryAdvantage(factionIdOrSnapshot) {
    let disciples, territoryCount, stability, factionId;

    if (typeof factionIdOrSnapshot === 'string') {
      factionId = factionIdOrSnapshot;
      const faction = this.entityRegistry.getById(factionId);
      if (!faction) return 0;
      disciples = faction.state.get('disciples') || 0;
      territoryCount = faction.state.get('territoryCount') || 0;
      stability = faction.state.get('stability') || 0;
    } else {
      const snap = factionIdOrSnapshot || {};
      disciples = snap.disciples || 0;
      territoryCount = snap.territoryCount || 0;
      stability = snap.stability || 0;
      factionId = null;
    }

    const allFactions = this.entityRegistry.getByType('faction')
      .filter(f => f.alive && (!factionId || f.id !== factionId));
    if (allFactions.length === 0) return 1;

    const myPower = disciples * this.disciplesWeight + territoryCount * this.territoryWeight + stability * this.stabilityWeight;
    const avgPower = allFactions.reduce((sum, f) => {
      const d = f.state.get('disciples') || 0;
      const t = f.state.get('territoryCount') || 0;
      const s = f.state.get('stability') || 0;
      return sum + d * this.disciplesWeight + t * this.territoryWeight + s * this.stabilityWeight;
    }, 0) / allFactions.length;

    return avgPower > 0 ? (myPower - avgPower) / avgPower : 0;
  }

  /**
   * 沿职位阶梯晋升一名 NPC（供"挑战上位"行为调用）。
   * @returns {{ promoted:false }|{ promoted:string, fromRole:string, viaChallenge:boolean, displacedNpcId:?string }}
   */
  promoteByLadder(npcId) {
    const host = this.host;
    const promotion = host.promotionService;
    const npc = this.entityRegistry.getById(npcId);
    if (!npc) return { promoted: false };
    const factionId = npc.state.get('factionId');
    const faction = factionId ? this.entityRegistry.getById(factionId) : null;
    const members = factionId
      ? this.entityRegistry.getAliveByType('npc').filter(n => n.state.get('factionId') === factionId)
      : [npc];
    const roleCounts = promotion.countRolesInFaction(factionId, members);
    const fromRole = npc.state.get('currentRole');
    npc._lastChallengeDisplaced = null;
    const promoted = promotion.promoteRole(npc, {
      roleCounts, faction, members, allowChallenge: true, checkQuota: false,
    });
    if (!promoted) return { promoted: false };
    const displaced = npc._lastChallengeDisplaced || null;
    npc._lastChallengeDisplaced = null;
    host._recordDisplacementGrudge(displaced, npc);
    if (factionId) {
      host.sectEventLog.push({
        day: this.worldEntity.currentDay, type: 'challenge_promote', factionId,
        npcId: npc.id, npcName: npc.name, fromRole, toRole: promoted,
        viaChallenge: !!displaced, displacedNpcId: displaced,
      });
    }
    return { promoted, fromRole, viaChallenge: !!displaced, displacedNpcId: displaced };
  }

  expandTerritory(factionId) {
    const faction = this.entityRegistry.getById(factionId);
    if (!faction) return { success: false };
    const tileIndex = this.host.tileIndex;
    const territory = faction.state.get('territory') || [];
    if (territory.length === 0) {
      const hq = faction.staticData?.headquarters || {};
      const hqX = typeof hq.x === 'number' ? hq.x : 0;
      const hqY = typeof hq.y === 'number' ? hq.y : 0;
      for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = hqX + dx, ny = hqY + dy;
        const nkey = `${nx},${ny}`;
        const tile = tileIndex.get(nkey);
        if (tile && !tile.ownerId) {
          tile.ownerId = factionId;
          faction.state.set('territory', [...territory, nkey]);
          return { success: true, tileKey: nkey };
        }
      }
      return { success: false, reason: '无可扩张的相邻格子' };
    }
    for (const key of territory) {
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        const nkey = `${nx},${ny}`;
        const tile = tileIndex.get(nkey);
        if (tile && !tile.ownerId) {
          tile.ownerId = factionId;
          faction.state.set('territory', [...territory, nkey]);
          return { success: true, tileKey: nkey };
        }
      }
    }
    return { success: false, reason: '无可扩张的相邻格子' };
  }

  /**
   * 攻伐敌对势力。
   * @param {string} factionId 攻方
   * @param {Array} infoEvents 本 tick 的信息事件数组（攻击事件写入此处）
   */
  attackEnemy(factionId, infoEvents) {
    const host = this.host;
    const faction = this.entityRegistry.getById(factionId);
    if (!faction) return { success: false };
    const relations = faction.state.get('relations') || {};
    let targetId = null;
    let worstRelation = 0;
    for (const [fId, rel] of Object.entries(relations)) {
      if (rel < worstRelation) {
        const enemy = this.entityRegistry.getById(fId);
        if (enemy && enemy.alive && host._factionsGeographicallyClose(factionId, fId)) {
          worstRelation = rel;
          targetId = fId;
        }
      }
    }
    if (!targetId) return { success: false, description: '无可达的敌对势力可攻击' };

    if (host._attackedThisTick && host._attackedThisTick.has(targetId)) {
      return { success: false, description: '目标本轮已遭受攻击' };
    }
    if (host._attackedThisTick) host._attackedThisTick.add(targetId);

    const target = this.entityRegistry.getById(targetId);
    const attackerDisciples = faction.state.get('disciples') || 0;
    const defenderDisciples = target.state.get('disciples') || 0;
    const attackerStability = faction.state.get('stability') || 50;
    const defenderStability = target.state.get('stability') || 50;

    const attackerPower = attackerDisciples * this.attackerMult * (1 + attackerStability / this.attackerStabFactor);
    const defenderPower = defenderDisciples * this.defenderMult * (1 + defenderStability / this.defenderStabFactor);
    const success = attackerPower > defenderPower;

    if (success) {
      const loot = Math.floor((target.state.get('low_spirit_stone') || 0) * this.winLootRatio);
      target.state.set('low_spirit_stone', Math.max(0, (target.state.get('low_spirit_stone') || 0) - loot));
      faction.state.set('low_spirit_stone', (faction.state.get('low_spirit_stone') || 0) + loot);

      const defenderLoss = Math.floor(defenderDisciples * this.winDefLoss);
      const defenderAfter = Math.max(this.winDefMin, defenderDisciples - defenderLoss);
      target.state.set('disciples', defenderAfter);
      target.state.set('stability', Math.max(0, (target.state.get('stability') || 50) - this.winDefStabLoss));

      const attackerLoss = Math.floor(attackerDisciples * this.winAttLoss);
      const attackerAfter = Math.max(this.winAttMin, attackerDisciples - attackerLoss);
      faction.state.set('disciples', attackerAfter);
      faction.state.set('stability', Math.max(0, attackerStability - this.winAttStabLoss));

      const attackerTerritory = faction.state.get('territoryCount') || 0;
      const defenderTerritory = target.state.get('territoryCount') || 0;
      if (defenderTerritory > 0 && attackerTerritory < this.maxTerritoryPerFaction) {
        faction.state.set('territoryCount', attackerTerritory + 1);
        target.state.set('territoryCount', defenderTerritory - 1);
      }

      const fRel = faction.state.get('relations') || {};
      fRel[targetId] = Math.max(-100, (fRel[targetId] || 0) + this.winRelChange);
      faction.state.set('relations', { ...fRel });

      const tRel = target.state.get('relations') || {};
      tRel[factionId] = Math.max(-100, (tRel[factionId] || 0) + this.winRelChange);
      target.state.set('relations', { ...tRel });

      // 攻战真正杀 NPC（打通复仇链路）：战败方活 NPC 池随机打散后取前 npcKillCount 个。
      const defenderMembers = this.entityRegistry.getAliveByType('npc')
        .filter(n => n.state.get('factionId') === targetId);
      let npcKillCount = 0;
      if (defenderDisciples >= this.winNpcKillMinDefender) {
        npcKillCount = Math.min(
          this.winNpcKillMax,
          Math.max(1, Math.floor(defenderDisciples * this.winNpcKillRatio))
        );
      } else if (defenderStability < this.winNpcKillStabilityFloor && defenderMembers.length > 0) {
        npcKillCount = 1;
      }
      if (npcKillCount > 0 && defenderMembers.length > 0) {
        for (let i = defenderMembers.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = defenderMembers[i]; defenderMembers[i] = defenderMembers[j]; defenderMembers[j] = tmp;
        }
        const toKill = defenderMembers.slice(0, npcKillCount);
        for (const npc of toKill) {
          npc.state.set('alive', false);
          npc.alive = false;
          const pos = host._entityPos(npc);
          npc._deathInfo = {
            cause: 'slain',
            npcId: npc.id,
            npcName: npc.name || (npc.staticData && npc.staticData.name) || npc.id,
            factionId: targetId,
            ageYears: npc.state.get('ageYears'),
            maxAgeYears: npc.state.get('maxAgeYears'),
            rankName: npc.state.get('rankName'),
            killerId: null,
            killerName: '势力战争',
            killerFactionId: factionId,
            day: this.worldEntity.currentDay,
          };
          if (pos) {
            npc._deathInfo.x = pos.x;
            npc._deathInfo.y = pos.y;
            npc._deathInfo.locationName = host._resolveLocationName(pos.x, pos.y);
          }
        }
      }

      // 给战败方所有活 NPC 写 'attacked' 记忆 + 对攻方成员结『宿敌』边。
      const allDefenderMembers = this.entityRegistry.getAliveByType('npc')
        .filter(n => n.state.get('factionId') === targetId && n.alive !== false);
      const attackerMembers = this.entityRegistry.getAliveByType('npc')
        .filter(n => n.state.get('factionId') === factionId && n.alive !== false)
        .slice(0, 8);
      for (const npc of allDefenderMembers) {
        if (typeof npc.recordMemory === 'function') {
          const pos = host._entityPos(npc);
          npc.recordMemory('attacked', {
            actorId: null,
            factionId: factionId,
            tick: this.worldEntity.currentDay,
            location: pos ? { x: pos.x, y: pos.y } : null,
          });
        }
        for (const enemyNpc of attackerMembers) {
          host._applyRelationEvent('faction_war_attacked', npc.id, enemyNpc.id);
        }
      }
    } else {
      const attackerLoss = Math.floor(attackerDisciples * this.loseAttLoss);
      const attackerAfter = Math.max(this.loseAttMin, attackerDisciples - attackerLoss);
      faction.inventory.remove('disciples', attackerDisciples - attackerAfter);
      faction.state.set('stability', Math.max(0, attackerStability - this.loseAttStabLoss));

      target.state.set('stability', Math.min(100, (target.state.get('stability') || 50) + this.loseDefStabGain));

      const fRel = faction.state.get('relations') || {};
      fRel[targetId] = Math.max(-100, (fRel[targetId] || 0) + this.loseRelChange);
      faction.state.set('relations', { ...fRel });

      const tRel = target.state.get('relations') || {};
      tRel[factionId] = Math.max(-100, (tRel[factionId] || 0) + this.loseRelChange);
      target.state.set('relations', { ...tRel });
    }

    target.state.set('underAttack', true);

    infoEvents.push({
      type: 'attack',
      day: this.worldEntity.currentDay,
      attackerId: factionId,
      attackerName: faction.name,
      targetId,
      targetName: target.name,
      success,
      description: success
        ? `${faction.name} 攻击 ${target.name} 并胜利`
        : `${faction.name} 攻击 ${target.name} 失败`,
    });

    return {
      success,
      targetId,
      targetName: target.name,
      description: success ? `成功攻击了 ${target.name}` : `攻击 ${target.name} 失败`,
    };
  }

  formAlliance(factionId, infoEvents) {
    const faction = this.entityRegistry.getById(factionId);
    if (!faction) return { success: false };
    const relations = faction.state.get('relations') || {};
    let bestId = null;
    let bestRelation = this.allyMinRel;
    for (const [fId, rel] of Object.entries(relations)) {
      if (rel > bestRelation && rel < this.allyMaxRel) {
        const candidate = this.entityRegistry.getById(fId);
        if (candidate && candidate.alive) {
          bestRelation = rel;
          bestId = fId;
        }
      }
    }
    if (!bestId) return { success: false, description: '无合适的结盟对象' };

    const ally = this.entityRegistry.getById(bestId);
    const fRel = faction.state.get('relations') || {};
    fRel[bestId] = Math.min(100, (fRel[bestId] || 0) + this.allyRelGain);
    faction.state.set('relations', { ...fRel });

    const aRel = ally.state.get('relations') || {};
    aRel[factionId] = Math.min(100, (aRel[factionId] || 0) + this.allyRelGain);
    ally.state.set('relations', { ...aRel });

    infoEvents.push({
      type: 'alliance',
      day: this.worldEntity.currentDay,
      factionId,
      factionName: faction.name,
      allyId: bestId,
      allyName: ally.name,
      description: `${faction.name} 与 ${ally.name} 结盟`,
    });

    return { success: true, allyId: bestId, allyName: ally.name };
  }

  conductTrade(factionId) {
    const faction = this.entityRegistry.getById(factionId);
    if (!faction) return { success: false };

    const allFactions = this.entityRegistry.getByType('faction')
      .filter(f => f.alive && f.id !== factionId);
    const relations = faction.state.get('relations') || {};

    let bestPartner = null;
    let bestRelation = this.tradeMinRel;
    for (const f of allFactions) {
      const rel = relations[f.id] || 0;
      if (rel > bestRelation) {
        bestRelation = rel;
        bestPartner = f;
      }
    }

    if (!bestPartner) {
      return { success: false, description: '无合适贸易伙伴' };
    }

    const myStone = faction.inventory.getAmount('low_spirit_stone');
    const tradeAmount = Math.min(Math.floor(myStone * this.tradeStoneRatio), this.tradeMaxAmount);
    if (tradeAmount <= 0) return { success: false, description: '灵石不足以贸易' };

    faction.inventory.remove('low_spirit_stone', tradeAmount);
    faction.inventory.add('food', tradeAmount * this.tradeFoodRate);
    bestPartner.inventory.add('low_spirit_stone', tradeAmount);
    const partnerFood = bestPartner.inventory.getAmount('food');
    bestPartner.inventory.remove('food', Math.min(tradeAmount * this.tradeFoodRate, partnerFood));

    const fRel = { ...relations };
    fRel[bestPartner.id] = Math.min((fRel[bestPartner.id] || 0) + this.tradeRelGain, 100);
    faction.state.set('relations', fRel);

    const pRel = { ...(bestPartner.state.get('relations') || {}) };
    pRel[factionId] = Math.min((pRel[factionId] || 0) + this.tradeRelGain, 100);
    bestPartner.state.set('relations', pRel);

    return {
      success: true,
      partnerId: bestPartner.id,
      partnerName: bestPartner.name,
      tradeAmount,
      description: `与 ${bestPartner.name} 完成贸易`,
    };
  }
}
