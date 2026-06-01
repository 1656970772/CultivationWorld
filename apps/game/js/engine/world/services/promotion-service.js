/**
 * PromotionService —— 宗门晋升与定时活动服务（宗门治理层）。
 *
 * 职责：集中"职位晋升体系"的底层原语与三类定时活动：
 *   - 原语：setRole / promoteRole / applyPromote / promotionCfg / countRolesInFaction
 *           / factionRoleQuota / isScarceSeat / npcSeatStrength / demoteToOuter / roleSalaryOf
 *           （沿阶梯晋升、稀缺顶层席位"有空缺补位/满员挑战现任"规则）。
 *   - processMonthlyContribution：月度贡献考核（未达额贬外门 + 前三名奖励）。
 *   - processSectEvents：门派考核（境界未达贬外门）+ 门派大比（按境界分组排名、冠军晋升）。
 *   - processPromotions：贡献晋升通道（达标沿阶梯升级，受名额限制）。
 *
 * 被 FactionAIService.promoteByLadder 与 TickManager tick 流程调用。
 * 共享 helper（_rankOrderOf / _recordDisplacementGrudge / _applyRelationEvent / sectEventLog 等）经 host 调用。
 */
export class PromotionService {
  /**
   * @param {Object} deps
   * @param {import('../tick-manager.js').TickManager} deps.host
   */
  constructor({ host }) {
    this.host = host;
  }

  get entityRegistry() { return this.host.entityRegistry; }
  get worldEntity() { return this.host.worldEntity; }
  get balanceConfig() { return this.host.balanceConfig; }
  get sectEventLog() { return this.host.sectEventLog; }

  // ── 原语 ─────────────────────────────────────────

  /** 晋升配置（promotion 段），带默认值兜底 */
  promotionCfg() {
    return this.balanceConfig.cultivation?.promotion || {
      ladder: ['outer_disciple', 'disciple', 'core_disciple', 'officer', 'general', 'elder', 'heir'],
      roleRankByStep: {
        outer_disciple: 0, disciple: 1, core_disciple: 2,
        officer: 3, general: 3, elder: 4, heir: 5,
      },
      contributionByStep: {},
      rankOrderByStep: {},
      quotaByRole: {},
    };
  }

  /** 角色月俸（用于月度考核前三名奖励基数） */
  roleSalaryOf(role) {
    const roles = this.balanceConfig.economy?.salary?.roles || {};
    return roles[role] ?? 5;
  }

  /** 设置职位（同时同步 roleRank / isElder / isLeader） */
  setRole(npc, role) {
    const cfg = this.promotionCfg();
    npc.state.set('currentRole', role);
    npc.state.set('roleRank', cfg.roleRankByStep[role] ?? 0);
    npc.state.set('isElder', role === 'elder');
    npc.state.set('isLeader', role === 'leader');
  }

  /** 统计某势力当前各职位人数（存活），用于名额限制 */
  countRolesInFaction(factionId, members) {
    const counts = {};
    for (const npc of members) {
      const role = npc.state.get('currentRole');
      counts[role] = (counts[role] || 0) + 1;
    }
    return counts;
  }

  /**
   * 某职位在某宗门的名额上限：宗门 staticData.roleQuota[role] 优先，
   * 回退全局 promotion.quotaByRole[role]，再无则 Infinity。
   */
  factionRoleQuota(faction, role) {
    const fq = faction?.staticData?.roleQuota;
    if (fq && fq[role] != null) return fq[role];
    const cfg = this.promotionCfg();
    if (cfg.quotaByRole && cfg.quotaByRole[role] != null) return cfg.quotaByRole[role];
    return Infinity;
  }

  /** 该职位是否为"宗门稀缺顶层席位"（在宗门 roleQuota 中显式配置，如 elder/heir） */
  isScarceSeat(faction, role) {
    const fq = faction?.staticData?.roleQuota;
    return !!(fq && fq[role] != null);
  }

  /** NPC 实力比较分：境界 successionScore 为主，qi 为次。用于挑战席位时择强弱。 */
  npcSeatStrength(npc) {
    const rank = this.host.ranksData.find(r => r.id === npc.state.get('rankId'));
    const score = rank ? (rank.successionScore ?? rank.order ?? 0) : 0;
    return score * 1e6 + (npc.state.get('qi') || 0);
  }

  /**
   * 将 NPC 沿职位阶梯晋升一级（数据驱动，全阶梯）。
   * 顶层稀缺席位：有空缺补位，满员挑战现任（取最弱者，挑战者更强则现任降一级）。
   * @returns {string|false} 晋升后的新职位，或 false
   */
  promoteRole(npc, opts = {}) {
    const cfg = this.promotionCfg();
    const ladder = cfg.ladder;
    const role = npc.state.get('currentRole');
    const idx = ladder.indexOf(role);
    if (idx < 0 || idx >= ladder.length - 1) return false;
    const next = ladder[idx + 1];

    const faction = opts.faction;
    const counts = opts.roleCounts;

    if (faction && this.isScarceSeat(faction, next) && counts) {
      const quota = this.factionRoleQuota(faction, next);
      const cur = counts[next] || 0;
      if (cur < quota) {
        this.applyPromote(npc, role, next, counts);
        return next;
      }
      const allowChallenge = opts.allowChallenge !== false;
      if (!allowChallenge || !opts.members) return false;
      const incumbents = opts.members.filter(
        m => m.state.get('currentRole') === next && m.id !== npc.id && m.state.get('alive') !== false
      );
      if (incumbents.length === 0) return false;
      incumbents.sort((a, b) => this.npcSeatStrength(a) - this.npcSeatStrength(b));
      const weakest = incumbents[0];
      if (this.npcSeatStrength(npc) <= this.npcSeatStrength(weakest)) return false;
      this.setRole(weakest, role);
      counts[next] = Math.max(0, (counts[next] || 0) - 1);
      counts[role] = (counts[role] || 0) + 1;
      this.applyPromote(npc, role, next, counts);
      npc._lastChallengeDisplaced = weakest.id;
      return next;
    }

    if (opts.checkQuota && cfg.quotaByRole && cfg.quotaByRole[next] != null && counts) {
      const cap = cfg.quotaByRole[next];
      if ((counts[next] || 0) >= cap) return false;
    }
    this.applyPromote(npc, role, next, counts);
    return next;
  }

  /** 落实一次晋升的状态写入与计数更新 */
  applyPromote(npc, fromRole, toRole, counts) {
    this.setRole(npc, toRole);
    if (counts) {
      counts[fromRole] = Math.max(0, (counts[fromRole] || 0) - 1);
      counts[toRole] = (counts[toRole] || 0) + 1;
    }
  }

  /** 贬为外门弟子 */
  demoteToOuter(npc) {
    const host = this.host;
    if (npc.state.get('currentRole') === 'outer_disciple') return false;
    const role = npc.state.get('currentRole');
    if (role === 'leader' || role === 'elder' || role === 'heir') return false;
    npc.state.set('currentRole', 'outer_disciple');
    npc.state.set('roleRank', 0);
    npc.state.set('isLeader', false);
    npc.state.set('isElder', false);
    if (typeof npc.recordMemory === 'function') {
      npc.recordMemory('demoted', {
        factionId: npc.state.get('factionId'),
        tick: this.worldEntity.currentDay,
      });
      const faction = this.entityRegistry.getById(npc.state.get('factionId'));
      const leaderId = faction?.state?.get('leaderNpcId');
      if (leaderId && leaderId !== npc.id) {
        host._applyRelationEvent('demoted', npc.id, leaderId);
      }
    }
    return true;
  }

  // ── 定时活动 ─────────────────────────────────────

  /**
   * 月度贡献考核（每 monthlyContribution.intervalDays 天）：
   * 弟子当月贡献需达 quotaByRank[境界]，否则贬外门；前三名额外奖励灵石；结算后清零。
   */
  processMonthlyContribution(worldContext, tickLog, currentDay) {
    const cfg = this.balanceConfig.cultivation?.monthlyContribution;
    if (!cfg) return;
    const interval = cfg.intervalDays ?? 30;
    if (currentDay <= 0 || currentDay % interval !== 0) return;

    const quotaByRank = cfg.quotaByRank || {};
    const topMult = cfg.topRewardMultipliers || [5, 3, 2];

    const byFaction = new Map();
    for (const npc of this.entityRegistry.getAliveByType('npc')) {
      const fid = npc.state.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }

    for (const [factionId, members] of byFaction) {
      const ranked = [...members].sort(
        (a, b) => (b.state.get('monthlyContribution') || 0) - (a.state.get('monthlyContribution') || 0)
      );
      for (let i = 0; i < topMult.length && i < ranked.length; i++) {
        const npc = ranked[i];
        if ((npc.state.get('monthlyContribution') || 0) <= 0) break;
        const reward = Math.round(this.roleSalaryOf(npc.state.get('currentRole')) * topMult[i]);
        npc.inventory.add('low_spirit_stone', reward);
        this.sectEventLog.push({
          day: currentDay, type: 'monthly_top', factionId,
          npcId: npc.id, npcName: npc.name, place: i + 1, reward,
        });
      }

      for (const npc of members) {
        const role = npc.state.get('currentRole');
        if (role === 'leader' || role === 'elder' || role === 'heir') {
          npc.state.set('monthlyQuotaMet', true);
          npc.state.set('monthlyContribution', 0);
          continue;
        }
        const monthly = npc.state.get('monthlyContribution') || 0;
        const quota = quotaByRank[npc.state.get('rankId')] ?? 3;
        const met = monthly >= quota;
        npc.state.set('monthlyQuotaMet', met);
        if (!met) {
          const demoted = this.demoteToOuter(npc);
          this.sectEventLog.push({
            day: currentDay, type: 'monthly_fail', factionId,
            npcId: npc.id, npcName: npc.name, monthly, quota, demoted,
          });
        }
        npc.state.set('monthlyContribution', 0);
      }
    }
  }

  /**
   * 势力定时活动：门派考核（境界未达贬外门）、门派大比（按境界分组排名，奖前五，冠军晋升）。
   */
  processSectEvents(worldContext, tickLog, currentDay) {
    const host = this.host;
    const cfg = this.balanceConfig.cultivation?.sectEvents;
    if (!cfg || currentDay <= 0) return;

    const byFaction = new Map();
    for (const npc of this.entityRegistry.getAliveByType('npc')) {
      const fid = npc.state.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }

    const exam = cfg.sect_exam;
    if (exam && currentDay % (exam.intervalDays ?? 180) === 0) {
      const minOrder = exam.minRankOrder ?? 20;
      for (const [factionId, members] of byFaction) {
        for (const npc of members) {
          if ((npc.state.get('ageYears') || 0) < 16) continue;
          if (host._rankOrderOf(npc.state.get('rankId')) < minOrder) {
            const demoted = this.demoteToOuter(npc);
            this.sectEventLog.push({
              day: currentDay, type: 'exam_fail', factionId,
              npcId: npc.id, npcName: npc.name,
              rankName: npc.state.get('rankName'), demoted,
            });
          }
        }
      }
    }

    const grand = cfg.grandCompetition;
    if (grand && currentDay % (grand.intervalDays ?? 360) === 0) {
      const stoneRewards = grand.stoneRewards || [];
      const contribRewards = grand.contributionRewards || [];
      const count = grand.rewardCount ?? 5;
      const byRank = grand.byRank !== false;
      const exemptRoles = new Set(grand.exemptRoles || ['leader', 'heir', 'elder']);

      for (const [factionId, members] of byFaction) {
        const groups = new Map();
        for (const npc of members) {
          if (exemptRoles.has(npc.state.get('currentRole'))) continue;
          const key = byRank ? (npc.state.get('rankId') || 'unknown') : 'all';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(npc);
        }

        for (const [rankId, groupMembers] of groups) {
          const ranked = [...groupMembers].sort(
            (a, b) => (b.state.get('qi') || 0) - (a.state.get('qi') || 0)
          );
          for (let i = 0; i < count && i < ranked.length; i++) {
            const npc = ranked[i];
            const stone = stoneRewards[i] ?? 0;
            const contrib = contribRewards[i] ?? 0;
            if (stone > 0) npc.inventory.add('low_spirit_stone', stone);
            if (contrib > 0) {
              npc.state.set('contribution', (npc.state.get('contribution') || 0) + contrib);
              npc.state.set('monthlyContribution', (npc.state.get('monthlyContribution') || 0) + contrib);
            }
            let promoted = false;
            if (i === 0 && grand.championPromote) {
              const faction = this.entityRegistry.getById(factionId);
              const fRoleCounts = this.countRolesInFaction(factionId, members);
              promoted = this.promoteRole(npc, {
                roleCounts: fRoleCounts, faction, members, allowChallenge: true, checkQuota: false,
              });
            }
            this.sectEventLog.push({
              day: currentDay, type: 'grand_competition', factionId,
              rankId: byRank ? rankId : undefined,
              rankName: byRank ? npc.state.get('rankName') : undefined,
              npcId: npc.id, npcName: npc.name, place: i + 1, stone, contrib, promoted,
            });
          }
        }
      }
    }
  }

  /**
   * 贡献晋升通道（每 promotion.intervalDays 天）：弟子终身累计贡献达 contributionByStep[下一职位]
   * 且境界达标，则沿阶梯晋升一级；高阶职位受名额限制。
   */
  processPromotions(worldContext, tickLog, currentDay) {
    const host = this.host;
    const cfg = this.balanceConfig.cultivation?.promotion;
    if (!cfg) return;
    const interval = cfg.intervalDays ?? 90;
    if (currentDay <= 0 || currentDay % interval !== 0) return;

    const ladder = cfg.ladder || [];
    const contribByStep = cfg.contributionByStep || {};
    const orderByStep = cfg.rankOrderByStep || {};

    const byFaction = new Map();
    for (const npc of this.entityRegistry.getAliveByType('npc')) {
      const fid = npc.state.get('factionId');
      if (!fid) continue;
      if (!byFaction.has(fid)) byFaction.set(fid, []);
      byFaction.get(fid).push(npc);
    }

    for (const [factionId, members] of byFaction) {
      const faction = this.entityRegistry.getById(factionId);
      const roleCounts = this.countRolesInFaction(factionId, members);
      const ordered = [...members].sort(
        (a, b) => (b.state.get('contribution') || 0) - (a.state.get('contribution') || 0)
      );
      for (const npc of ordered) {
        const role = npc.state.get('currentRole');
        const idx = ladder.indexOf(role);
        if (idx < 0 || idx >= ladder.length - 1) continue;
        const next = ladder[idx + 1];

        const needContrib = contribByStep[next];
        const needOrder = orderByStep[next] ?? 0;
        if (needContrib == null) continue;

        const contribution = npc.state.get('contribution') || 0;
        const rankOrder = host._rankOrderOf(npc.state.get('rankId'));
        if (contribution < needContrib || rankOrder < needOrder) continue;

        npc._lastChallengeDisplaced = null;
        const promoted = this.promoteRole(npc, {
          roleCounts, faction, members, allowChallenge: true, checkQuota: true,
        });
        if (promoted) {
          const displaced = npc._lastChallengeDisplaced || null;
          host._recordDisplacementGrudge(displaced, npc);
          this.sectEventLog.push({
            day: currentDay, type: 'promotion', factionId,
            npcId: npc.id, npcName: npc.name,
            fromRole: role, toRole: promoted, contribution,
            viaChallenge: !!displaced, displacedNpcId: displaced,
          });
          npc._lastChallengeDisplaced = null;
        }
      }
    }
  }
}
