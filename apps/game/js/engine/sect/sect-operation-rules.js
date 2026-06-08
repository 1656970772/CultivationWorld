import { hallForPressure } from './sect-organization.js';

export function number(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  if (arguments.length >= 2) return fallback;
  throw new Error(`数值配置缺失或非法: ${value}`);
}

function memberRole(npc) {
  const role = npc?.state?.get?.('currentRole');
  if (!role) throw new Error(`NPC ${npc?.id || '<unknown>'} 缺少 currentRole`);
  return role;
}

function memberRank(npc) {
  const rankId = npc?.state?.get?.('rankId');
  if (!rankId) throw new Error(`NPC ${npc?.id || '<unknown>'} 缺少 rankId`);
  return rankId;
}

function addState(entity, key, amount) {
  entity.state.set(key, number(entity.state.get(key), 0) + amount);
}

function scopedDedupeKey(faction, rule) {
  return rule.dedupeKey ? `${faction.id}:${rule.dedupeKey}` : null;
}

function maintenanceSinkFor(faction) {
  const values = new Map();
  return {
    id: `${faction.id}:sect_maintenance_sink`,
    type: 'sect_maintenance_sink',
    state: {
      get(key) {
        return values.get(key) || 0;
      },
      set(key, value) {
        values.set(key, Math.max(0, Number(value) || 0));
      },
    },
  };
}

function memberDues({ members, roleStones, rankPills, extra }) {
  return members.map(npc => {
    const role = memberRole(npc);
    if (!Object.prototype.hasOwnProperty.call(roleStones, role)) {
      throw new Error(`缺少身份月俸配置: ${role}`);
    }
    const hallExtra = npc.state.get('hallId')
      ? (npc.state.get('isHallChief') === true ? number(extra.chief) : number(extra.member))
      : 0;
    const stoneDue = number(roleStones[role]) + hallExtra;
    const rankId = memberRank(npc);
    const pillRule = rankPills[rankId];
    const pillDue = pillRule?.itemId && number(pillRule.quantity, 0) > 0
      ? { itemId: pillRule.itemId, quantity: number(pillRule.quantity) }
      : null;
    return { npc, stoneDue, pillDue };
  });
}

export class SectOperationRuleRegistry {
  constructor(rules = []) {
    this.rules = new Map();
    for (const rule of rules) this.register(rule);
  }

  register(rule) {
    if (!rule?.id) throw new Error('门派运行规则缺少 id');
    this.rules.set(rule.id, rule);
  }

  resolve(flow = []) {
    return flow.map(id => {
      const rule = this.rules.get(id);
      if (!rule) throw new Error(`未知门派运行规则: ${id}`);
      return rule;
    });
  }
}

export function defaultSectOperationRules() {
  return [
    new MonthlyStipendRule(),
    new StockPressureRule(),
    new DepartureRule(),
    new DestructionRule(),
  ];
}

export class MonthlyStipendRule {
  id = 'monthly_stipend';

  run(ctx) {
    const { day, faction, members, config, treasury } = ctx;
    const stipends = config.stipends;
    const roleStones = stipends?.roleStones;
    const rankPills = stipends?.rankPills;
    const extra = stipends?.hallExtraStones;
    const maintenance = config.maintenance;
    if (!roleStones || !rankPills || !extra || !maintenance) {
      throw new Error('sect-operation.stipends/maintenance 配置缺失');
    }

    const territoryCount = number(faction.state.get('territoryCount'), 1);
    const maintenanceDue = number(maintenance.baseStones)
      + territoryCount * number(maintenance.perTerritoryStones);
    const dues = memberDues({ members, roleStones, rankPills, extra });
    let totalStoneDue = maintenanceDue;
    let totalStonePaid = 0;
    let totalPillDue = 0;
    let totalPillPaid = 0;

    const maintenanceResult = treasury.settle({
      day,
      scenarioId: config.treasury?.stipendScenarioId,
      from: faction,
      to: maintenanceSinkFor(faction),
      asset: {
        kind: 'faction_state_resource',
        itemId: config.treasury?.stoneResourceId,
        quantity: maintenanceDue,
      },
      source: { type: 'sect_maintenance', factionId: faction.id },
      visibility: 'institution',
    });
    if (maintenanceResult.success) totalStonePaid += maintenanceDue;

    for (const { npc, stoneDue, pillDue } of dues) {
      totalStoneDue += stoneDue;
      const stone = treasury.transferFactionStonesToNpc({
        day,
        faction,
        npc,
        quantity: stoneDue,
        source: { type: this.id, factionId: faction.id, npcId: npc.id },
      });
      if (stone.success) totalStonePaid += stoneDue;

      if (pillDue) {
        totalPillDue += pillDue.quantity;
        const pill = treasury.transferFactionItemToNpc({
          day,
          faction,
          npc,
          itemId: pillDue.itemId,
          quantity: pillDue.quantity,
          source: { type: 'sect_pill_stipend', factionId: faction.id, npcId: npc.id },
        });
        if (pill.success) totalPillPaid += pillDue.quantity;
      }
    }

    const stoneShort = totalStonePaid < totalStoneDue;
    const pillShort = totalPillPaid < totalPillDue;
    faction.state.set('sectLastMonthlyDay', day);
    faction.state.set('sectLastStoneDue', totalStoneDue);
    faction.state.set('sectLastStonePaid', totalStonePaid);
    faction.state.set('sectLastPillDue', totalPillDue);
    faction.state.set('sectLastPillPaid', totalPillPaid);
    faction.state.set(
      'sectSalaryShortfallStreak',
      stoneShort ? number(faction.state.get('sectSalaryShortfallStreak'), 0) + 1 : 0,
    );
    faction.state.set(
      'sectPillShortfallStreak',
      pillShort ? number(faction.state.get('sectPillShortfallStreak'), 0) + 1 : 0,
    );
    if (stoneShort || pillShort) {
      faction.state.set(
        'stability',
        Math.max(0, number(faction.state.get('stability'), 50) - number(config.decline?.stabilityPenaltyPerMonth)),
      );
    }
    return { totalStoneDue, totalStonePaid, totalPillDue, totalPillPaid, stoneShort, pillShort };
  }
}

export class StockPressureRule {
  id = 'stock_pressure';

  stockAmount(faction, rule) {
    if (rule.kind === 'faction_state_resource') return number(faction.state.get(rule.resourceId), 0);
    return number(faction.inventory?.getAmount?.(rule.resourceId), 0);
  }

  run(ctx) {
    const { day, faction, config, organization, questBoard } = ctx;
    const created = [];
    if (!questBoard) return { created };
    if (!Array.isArray(config.stockPressure)) throw new Error('sect-operation.stockPressure 缺失');

    for (const rule of config.stockPressure) {
      const amount = this.stockAmount(faction, rule);
      if (amount >= number(rule.safeStock)) continue;
      const dedupeKey = scopedDedupeKey(faction, rule);
      if (questBoard.hasOpenDemand(dedupeKey)) continue;

      const severity = amount <= number(rule.criticalStock) ? 'critical' : 'safe';
      const hall = hallForPressure(organization, rule.issuerHall);
      const quest = questBoard.publish({
        day,
        factionId: faction.id,
        issuerType: 'hall',
        issuerId: hall.id,
        issuerName: hall.issuerName || hall.name,
        questBoard: rule.questBoard,
        questKind: rule.questKind,
        questTemplateId: rule.questTemplateId,
        difficulty: rule.difficultyBySeverity?.[severity],
        priority: rule.priority,
        requiredResourceId: rule.resourceId,
        rewardContribution: rule.rewardContributionBySeverity?.[severity],
        dedupeKey,
        metadata: {
          severity,
          stockAmount: amount,
          safeStock: rule.safeStock,
          criticalStock: rule.criticalStock,
          settlement: rule.settlement || null,
          configDedupeKey: rule.dedupeKey || null,
        },
      });
      if (quest?.success !== false) created.push(quest);
    }

    faction.state.set('sectOpenPressureQuestCount', questBoard.openFor({ factionId: faction.id }).length);
    return { created };
  }
}

export class DepartureRule {
  id = 'departure';

  run(ctx) {
    const { day, faction, members, config, rng } = ctx;
    const cfg = config.decline;
    if (!cfg) throw new Error('sect-operation.decline 配置缺失');

    const streak = Math.max(
      number(faction.state.get('sectSalaryShortfallStreak'), 0),
      number(faction.state.get('sectPillShortfallStreak'), 0),
    );
    const lowStability = number(faction.state.get('stability'), 50) <= number(cfg.stabilityForDeparture);
    const threshold = number(cfg.shortfallStreakForDeparture);
    const leftNpcIds = [];
    if (streak < threshold && !lowStability) return { leftNpcIds };

    const exempt = new Set(cfg.exemptRoles || []);
    for (const npc of members) {
      if (exempt.has(memberRole(npc))) continue;
      const chance = Math.min(
        1,
        number(cfg.leaveChanceBase) + Math.max(0, streak - threshold) * number(cfg.leaveChancePerShortfallStreak),
      );
      const roll = rng?.next?.() ?? Math.random();
      if (roll > chance) continue;

      npc.state.set('factionId', null);
      npc.state.set('hasFaction', false);
      npc.state.set('isWanderer', true);
      npc.state.set('hallId', null);
      npc.state.set('isHallChief', false);
      npc.state.set('activeBoardQuestId', null);
      npc.state.set('sectLeftDay', day);
      npc.state.set('sectLeaveReason', lowStability ? 'low_stability' : 'stipend_shortfall');
      leftNpcIds.push(npc.id);
    }

    if (leftNpcIds.length > 0) addState(faction, 'sectDepartureCount', leftNpcIds.length);
    return { leftNpcIds };
  }
}

export class DestructionRule {
  id = 'destruction';

  run({ day, faction, members }) {
    const aliveMembers = members.filter(n =>
      n.alive !== false
      && n.state?.get?.('alive') !== false
      && n.state?.get?.('factionId') === faction.id,
    );
    if (aliveMembers.length > 0) return { destroyed: false };
    faction.state.set('isDestroyed', true);
    faction.state.set('destroyedReason', 'no_members');
    faction.alive = false;
    return { destroyed: true, reason: 'no_members', day };
  }
}
