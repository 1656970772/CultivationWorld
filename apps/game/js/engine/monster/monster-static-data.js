/**
 * MonsterStaticData - 妖兽静态数据
 *
 * 出生时设定的不可变属性，来源于 data/definitions/monsters.json 的某条妖兽定义。
 */
import { StaticData } from '../abstract/static-data.js';
import { resolveMonsterAttributes } from './monster-attributes.js';

export class MonsterStaticData extends StaticData {
  /**
   * @param {Object} def      monsters.json 中的妖兽定义
   * @param {Object} instance 实例化时附加的信息（如出生坐标、唯一名称）
   */
  constructor(def, instance = {}) {
    const attributes = resolveMonsterAttributes(def, instance.monsterAttributeTemplates);
    super({
      defId: def.id,
      name: instance.name || def.name,
      family: def.family,
      monsterType: def.type,
      grade: def.grade,
      gradeName: def.gradeName,
      equivalentRealm: def.equivalentRealm,
      habitat: Object.freeze([...(def.habitat || [])]),
      attributes: Object.freeze({ ...attributes }),
      templates: Object.freeze({ ...(def.templates || {}) }),
      skills: Object.freeze([...(def.skills || [])]),
      monsterAttributeTemplates: instance.monsterAttributeTemplates || null,
      innateAbility: def.innateAbility ? Object.freeze({ ...def.innateAbility }) : null,
      drops: Object.freeze([...(def.drops || [])]),
      rarity: def.rarity,
      swarmBehavior: def.swarmBehavior === true,
      homeX: instance.homeX ?? 0,
      homeY: instance.homeY ?? 0,
      wanderRadius: instance.wanderRadius ?? 12,
    });
  }

  get name() { return this.get('name'); }
  get grade() { return this.get('grade'); }
  get habitat() { return this.get('habitat'); }
  get attributes() { return this.get('attributes'); }
}
