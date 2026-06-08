import { SectTreasury } from './sect-treasury.js';

export class SectOperationService {
  constructor({
    config,
    organization,
    ranksData,
    economicSystem,
    questBoard,
    bountyService,
    ruleRegistry,
    memberProvider,
  } = {}) {
    if (!config || !organization || !ranksData || !ruleRegistry || !memberProvider) {
      throw new Error('SectOperationService 需要显式注入 config、organization、ranksData、ruleRegistry、memberProvider');
    }
    this.config = config;
    this.organization = organization;
    this.ranksData = ranksData;
    this.economicSystem = economicSystem;
    this.questBoard = questBoard;
    this.bountyService = bountyService;
    this.memberProvider = memberProvider;
    this.treasury = new SectTreasury({ economicSystem, config: config.treasury });
    this.ruleRegistry = ruleRegistry;
  }

  processMonthly({ day = 0, faction, members = [], rng = null } = {}) {
    if (!faction) throw new Error('SectOperationService.processMonthly 需要 faction');
    const ctx = {
      day,
      faction,
      members,
      rng,
      config: this.config,
      organization: this.organization,
      ranksData: this.ranksData,
      economicSystem: this.economicSystem,
      questBoard: this.questBoard,
      bountyService: this.bountyService,
      treasury: this.treasury,
    };
    const result = {};
    for (const rule of this.ruleRegistry.resolve(this.config.operationFlow)) {
      result[rule.id] = rule.run(ctx);
    }
    return result;
  }

  processAllMonthly({ day = 0, tickLog = null, rng = null } = {}) {
    const factions = this.memberProvider.aliveSectFactions();
    if (factions.length === 0) {
      if (tickLog) tickLog.sectOperations = [];
      return [];
    }
    const interval = Number(this.config.monthlyIntervalDays);
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error('sect-operation.monthlyIntervalDays 缺失或非法');
    }
    if (day <= 0 || day % interval !== 0) return [];

    const results = [];
    for (const faction of factions) {
      const members = this.memberProvider.membersOf(faction);
      const result = this.processMonthly({ day, faction, members, rng });
      faction.syncStateResourcesToInventory?.();
      results.push({ factionId: faction.id, ...result });
    }
    if (tickLog) tickLog.sectOperations = results;
    return results;
  }
}
