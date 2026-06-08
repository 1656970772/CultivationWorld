import { isSectFaction } from './sect-organization.js';

export class SectMemberProvider {
  constructor({ entityRegistry } = {}) {
    if (!entityRegistry) throw new Error('SectMemberProvider 需要 entityRegistry');
    this.entityRegistry = entityRegistry;
  }

  aliveSectFactions() {
    return this.entityRegistry.getAliveByType('faction').filter(isSectFaction);
  }

  membersOf(faction) {
    return this.entityRegistry.getAliveByType('npc')
      .filter(npc => npc.state?.get?.('factionId') === faction.id);
  }
}
