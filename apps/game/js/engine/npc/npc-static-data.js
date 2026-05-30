/**
 * NPCStaticData - NPC 静态数据
 *
 * 出生时设定的不可变属性：性格四维、初始境界、初始角色。
 */
import { StaticData } from '../abstract/static-data.js';

export class NPCStaticData extends StaticData {
  constructor(npcConfig) {
    super({
      name: npcConfig.name,
      personality: Object.freeze({ ...npcConfig.personality }),
      initialRankId: npcConfig.rankId,
      initialRole: npcConfig.role,
      initialFactionId: npcConfig.factionId,
    });
  }

  get name() { return this.get('name'); }
  get personality() { return this.get('personality'); }
  get initialRankId() { return this.get('initialRankId'); }
  get initialRole() { return this.get('initialRole'); }
  get initialFactionId() { return this.get('initialFactionId'); }
}
