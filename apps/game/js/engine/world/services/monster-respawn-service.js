/**
 * MonsterRespawnService —— 妖兽种群补充服务（ADR-026/028）。
 *
 * 职责：维持妖兽生态在目标数量附近：
 *   - respawn：存活数低于目标比例时，每 tick 最多补刷若干只（避免被清空或永不变化）。
 *   - linkRespawnedToPacks：补刷妖兽并入妖群（同 family + 老巢邻近建 pack_member 边，仅 goalsEnabled）。
 *
 * 依赖 host.monsterSpawner（生成器）与 host.relationshipSystem（建边）。
 */
export class MonsterRespawnService {
  /**
   * @param {Object} deps
   * @param {import('../tick-manager.js').TickManager} deps.host
   */
  constructor({ host }) {
    this.host = host;
  }

  get entityRegistry() { return this.host.entityRegistry; }
  get worldEntity() { return this.host.worldEntity; }
  get relationshipSystem() { return this.host.relationshipSystem; }

  /**
   * 妖兽种群补充：存活数低于目标比例时，每 tick 最多补充若干只。
   */
  respawn(tickLog) {
    const host = this.host;
    if (!host.monsterSpawner) return;
    const popCfg = host.monsterSpawner.cfg?.population || {};
    if (!popCfg.respawnEnabled) return;

    const alive = this.entityRegistry.getAliveByType('monster').length;
    const target = Math.floor(host.monsterInitialCount * (popCfg.respawnTargetRatio ?? 0.85));
    if (alive >= target) return;

    const maxPerTick = popCfg.respawnPerTickMax ?? 2;
    let added = 0;
    const newcomers = [];
    for (let i = 0; i < maxPerTick && alive + added < target; i++) {
      const m = host.monsterSpawner.spawnOne();
      if (!m) break;
      this.entityRegistry.register(m);
      newcomers.push(m);
      added++;
    }
    if (added > 0) {
      tickLog.monsterRespawned = (tickLog.monsterRespawned || 0) + added;
      this.linkRespawnedToPacks(newcomers);
    }
  }

  /**
   * 补刷妖兽并入妖群（ADR-028）：与同 family 存活妖兽按老巢邻近建 pack_member 边。仅 goalsEnabled 时生效。
   * @param {Array} newcomers
   */
  linkRespawnedToPacks(newcomers) {
    const host = this.host;
    if (!host._relationGoalsEnabled() || !Array.isArray(newcomers) || newcomers.length === 0) return;
    const packCfg = host.relationshipConfig?.monsterPack || {};
    const packRadius = packCfg.packRadius ?? 12;
    const maxPackSize = packCfg.maxPackSize ?? 8;
    const allMonsters = this.entityRegistry.getAliveByType('monster');
    const homeOf = (m) => {
      const hx = m.staticData?.get('homeX');
      const hy = m.staticData?.get('homeY');
      if (typeof hx === 'number' && typeof hy === 'number') return { x: hx, y: hy };
      return m.spatial ? { x: m.spatial.tileX, y: m.spatial.tileY } : null;
    };
    for (const nm of newcomers) {
      const fam = nm.staticData?.get('family');
      if (!fam) continue;
      const hn = homeOf(nm);
      if (!hn) continue;
      let linked = 0;
      for (const other of allMonsters) {
        if (other.id === nm.id || linked >= maxPackSize) continue;
        if (other.staticData?.get('family') !== fam) continue;
        const ho = homeOf(other);
        if (!ho) continue;
        if (Math.abs(hn.x - ho.x) + Math.abs(hn.y - ho.y) > packRadius) continue;
        if (this.relationshipSystem.addEdge(nm.id, other.id, 'pack_member', { eventType: 'pack_init', tick: this.worldEntity.currentDay })) {
          linked++;
        }
      }
    }
  }
}
