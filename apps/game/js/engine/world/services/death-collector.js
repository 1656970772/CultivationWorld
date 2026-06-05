/**
 * DeathCollector —— 死亡收集与遗志继承服务。
 *
 * 职责：每 tick 统一扫描本轮新死亡的 NPC / 妖兽，写入 tickLog.deaths / monsterDeaths：
 *   - 带发生坐标与地点名（位置事件日志用）；
 *   - 道侣陨落记忆（在世道侣记下刻骨之痛，可触发复活/复仇执念）；
 *   - 继承遗志（ADR-029）：师傅陨落 → 在世徒弟结仇复仇 + 继承师傅未竟执念（仅 goalsEnabled）；
 *   - 妖兽死亡清理其关系边，避免悬空边。
 *
 * 通过实体上的 _deathInfo / _deathLogged 标记避免重复。共享 helper 经 host 调用。
 */
export class DeathCollector {
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
   * 统一收集本 tick 发生的死亡，写入 tickLog.deaths / monsterDeaths。
   */
  collect(tickLog) {
    const host = this.host;
    for (const npc of this.entityRegistry.getByType('npc')) {
      if (npc.alive) continue;
      if (npc._deathLogged) continue;
      const info = npc._deathInfo || {};
      const pos = host._entityPos(npc);
      tickLog.deaths.push({
        npcId: npc.id,
        npcName: info.npcName || npc.name,
        cause: info.cause || 'unknown',
        factionId: info.factionId ?? npc.state?.get('factionId') ?? null,
        rankName: info.rankName || npc.state?.get('rankName') || '',
        ageYears: info.ageYears ?? npc.state?.get('ageYears'),
        maxAgeYears: info.maxAgeYears ?? npc.state?.get('maxAgeYears'),
        monsterName: info.monsterName || null,
        monsterGrade: info.monsterGrade || null,
        questName: info.questName || null,
        x: pos?.x ?? null,
        y: pos?.y ?? null,
        locationName: pos ? host._resolveLocationName(pos.x, pos.y) : null,
      });
      const dynamicEvents = host.worldEventSystem?.publishDeathEvents?.(
        npc,
        info,
        pos,
        host.worldEntity.currentDay,
        host.relationshipSystem,
      ) || [];
      if (dynamicEvents.length > 0) {
        if (!tickLog.dynamicEventBirths) tickLog.dynamicEventBirths = [];
        for (const event of dynamicEvents) {
          tickLog.dynamicEventBirths.push(typeof event.toJSON === 'function' ? event.toJSON() : event);
        }
      }

      // 记忆：道侣陨落（ADR-019）。
      const companionId = npc.state?.get('daoCompanionId');
      if (companionId) {
        const companion = this.entityRegistry.getById(companionId);
        if (companion && companion.alive && typeof companion.recordMemory === 'function') {
          companion.recordMemory('companion_lost', {
            actorId: info.killerId || null,
            factionId: info.killerFactionId || null,
            tick: this.worldEntity.currentDay,
            location: pos ? { x: pos.x, y: pos.y } : null,
          });
        }
      }

      // 继承遗志（ADR-029）：师傅陨落 → 在世徒弟结仇 + 继承未竟执念（仅 goalsEnabled）。
      if (host._relationGoalsEnabled() && this.relationshipSystem) {
        const killInfo = {
          killerId: info.killerId || null,
          killerFactionId: info.killerFactionId || null,
          tick: this.worldEntity.currentDay,
          location: pos ? { x: pos.x, y: pos.y } : null,
        };
        for (const edge of this.relationshipSystem.edgesOfType(npc.id, 'master')) {
          const disciple = this.entityRegistry.getById(edge.toId);
          if (disciple && disciple.alive && typeof disciple.inheritMasterLegacy === 'function') {
            disciple.inheritMasterLegacy(npc, killInfo);
          }
        }
      }

      npc._deathLogged = true;
    }
    for (const monster of this.entityRegistry.getByType('monster')) {
      if (monster.alive) continue;
      if (monster._deathLogged) continue;
      const info = monster._deathInfo || {};
      const pos = host._entityPos(monster);
      tickLog.monsterDeaths.push({
        monsterId: monster.id,
        monsterName: info.monsterName || monster.name,
        grade: monster.grade,
        cause: info.cause || 'unknown',
        killerName: info.killerName || null,
        killerNpcId: info.killerNpcId || null,
        dropItems: Array.isArray(info.dropItems) ? info.dropItems : [],
        ageYears: info.ageYears ?? null,
        maxAgeYears: info.maxAgeYears ?? null,
        x: pos?.x ?? null,
        y: pos?.y ?? null,
        locationName: pos ? host._resolveLocationName(pos.x, pos.y) : null,
      });
      monster._deathLogged = true;
      if (this.relationshipSystem) this.relationshipSystem.removeEntity(monster.id);
    }
  }
}
