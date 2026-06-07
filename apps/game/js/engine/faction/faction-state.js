/**
 * FactionState - 势力运行时状态
 *
 * 封装势力的动态属性并提供派生状态计算。
 */
import { RuntimeState } from '../abstract/runtime-state.js';
import { ResourceRegistry } from '../economy/resource-registry.js';

function resourceRegistryFor(factionConfig, worldContext) {
  if (worldContext?.resourceRegistry) return worldContext.resourceRegistry;
  return ResourceRegistry.fromResourceIds(Object.keys(factionConfig.resources || {}));
}

export class FactionState extends RuntimeState {
  /**
   * @param {Object} factionConfig 势力初始配置
   * @param {Object} worldContext   世界上下文（用于计算领地数等）
   */
  constructor(factionConfig, worldContext = {}) {
    const territory = factionConfig.territory || [];
    const relations = factionConfig.relations || {};
    const territoryCount = factionConfig.territoryCount ?? territory.length;
    const resourceRegistry = resourceRegistryFor(factionConfig, worldContext);
    const initialResources = resourceRegistry.initialStateFrom(factionConfig.resources || {});

    super({
      // tuning-v6 2026-06-01: 初始稳定度钳到 [0,100]，防配置脏值或历史溢出值带入世界。
      stability: Math.max(0, Math.min(100, factionConfig.stability ?? 50)),
      territory: [...territory],
      territoryCount,
      relations: { ...relations },
      leaderNpcId: factionConfig.leader || null,
      isDestroyed: false,

      ...initialResources,

      borderThreat: 0,
      underAttack: false,
      allyCount: 0,
      enemyCount: 0,
      hasAdjacentUnowned: false,
      hasAdjacentEnemy: false,
      hasPotentialAlly: false,
      hasNeutralFaction: false,
      hasWeakEnemy: false,
      militaryAdvantage: 0,
    });
  }

  /**
   * 从世界上下文更新派生状态
   */
  updateDerived(worldContext) {
    const relations = this.get('relations') || {};
    const myDisciples = this.get('disciples') || 0;
    const registry = worldContext.entityRegistry;

    let allyCount = 0;
    let enemyCount = 0;
    let hasPotentialAlly = false;
    let hasWeakEnemyByRelation = false;

    let hasNeutralFaction = false;

    for (const [factionId, relation] of Object.entries(relations)) {
      // 盟友：关系 >= 60
      if (relation >= 60) allyCount++;

      // 敌人：关系 <= -30
      if (relation <= -30) {
        const enemy = registry ? registry.getById(factionId) : null;
        if (enemy && enemy.alive) {
          enemyCount++;
          // hasWeakEnemy：敌方弟子 < 自身 70%
          const enemyDisciples = enemy.state?.get?.('disciples') || enemy.inventory?.getAmount('disciples') || 0;
          if (enemyDisciples < myDisciples * 0.7) {
            hasWeakEnemyByRelation = true;
          }
        }
      }

      // hasPotentialAlly：关系 20~60 且不是敌人（关系 > 0）
      if (relation >= 20 && relation < 60) {
        const candidate = registry ? registry.getById(factionId) : null;
        if (candidate && candidate.alive) {
          hasPotentialAlly = true;
        }
      }

      // 中立势力：关系 > -30 且 < 20（既非敌非友）
      if (relation > -30 && relation < 20) {
        const neutral = registry ? registry.getById(factionId) : null;
        if (neutral && neutral.alive) {
          hasNeutralFaction = true;
        }
      }
    }

    const territory = this.get('territory') || [];
    const territoryCount = this.get('territoryCount') || territory.length;

    const hasAdjacentUnowned = territoryCount < 15 && (worldContext.checkAdjacentUnowned
      ? worldContext.checkAdjacentUnowned(territory)
      : true);

    const hasAdjacentEnemy = worldContext.checkAdjacentEnemy
      ? worldContext.checkAdjacentEnemy(territory, relations)
      : enemyCount > 0;

    let borderThreat = worldContext.calculateBorderThreat
      ? worldContext.calculateBorderThreat(territory, relations)
      : 0;
    if (enemyCount > 0 && borderThreat < 1) {
      borderThreat = 1;
    }

    // 综合 worldContext 和本地计算的 hasWeakEnemy
    const hasWeakEnemy = hasWeakEnemyByRelation || (worldContext.checkWeakEnemy
      ? worldContext.checkWeakEnemy(relations)
      : false);

    const militaryAdvantage = worldContext.calculateMilitaryAdvantage
      ? worldContext.calculateMilitaryAdvantage(this.snapshot())
      : 0;

    this.setMany({
      territoryCount: territory.length > 0 ? territory.length : territoryCount,
      allyCount,
      enemyCount,
      hasPotentialAlly,
      hasNeutralFaction,
      hasAdjacentUnowned,
      hasAdjacentEnemy,
      borderThreat,
      hasWeakEnemy,
      militaryAdvantage,
    });
  }

  /**
   * GOAP 状态转换：合并 inventory 数据到扁平状态
   */
  toGOAPState() {
    const base = super.toGOAPState();
    delete base['relations'];
    delete base['territory'];
    return base;
  }
}
