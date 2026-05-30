/**
 * FactionStaticData - 势力静态数据
 *
 * 出生时设定的不可变属性：阵营类型、特性标签、初始总部。
 */
import { StaticData } from '../abstract/static-data.js';

export class FactionStaticData extends StaticData {
  constructor(factionConfig) {
    super({
      factionType: factionConfig.type,
      // 机构子类型：bounty_hall（悬赏阁）/market（坊市）/escort_guild（镖行）等，
      // 供散修悬赏目标解析按机构类型分流（见 TickManager._nearestBountyOrg）。
      subtype: factionConfig.subtype || null,
      traits: Object.freeze([...(factionConfig.traits || [])]),
      headquarters: Object.freeze({ ...factionConfig.headquarters }),
      name: factionConfig.name,
      // 顶层稀缺职位名额（按宗门规模配置）：如 { elder: 6, heir: 1 }。
      // 弟子晋入这些职位时受此名额限制（满员则需挑战现任）。详见 wiki/rules/sect-operation.md。
      roleQuota: Object.freeze({ ...(factionConfig.roleQuota || {}) }),
    });
  }

  get factionType() { return this.get('factionType'); }
  get subtype() { return this.get('subtype'); }
  get traits() { return this.get('traits'); }
  get headquarters() { return this.get('headquarters'); }
  get name() { return this.get('name'); }
  get roleQuota() { return this.get('roleQuota'); }

  hasTrait(trait) {
    return this.traits.includes(trait);
  }
}
