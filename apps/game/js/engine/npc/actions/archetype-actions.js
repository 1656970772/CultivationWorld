/**
 * archetype-actions —— 流派执念行为执行器（从 npc-actions.js 拆分，ADR-022/023）。
 *
 * 含养老归隐 / 收徒传承 / 夺权继任：
 *   Seclude / TakeDisciple / SeizePower
 * 风险结算等共享工具统一从 ./npc-action-utils.js 引入。
 */
import { ActionExecutor } from '../../abstract/action.js';
import { settleRisk } from './npc-action-utils.js';

/**
 * 养老流执行器（ADR-023，项目推演设定）。
 * 回归洞府/宗门安养余生：低风险，恢复少量伤势与心境（morale），置 atPeace=true。
 */
export class NPCSecludeExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const injury = entity.state.get('injuryLevel') || 0;
    if (injury > 0) entity.state.set('injuryLevel', Math.max(0, injury - 1));
    const morale = entity.state.get('morale') || 0;
    entity.state.set('morale', Math.min(100, morale + 5));
    entity.state.set('atPeace', true);
    return {
      success: true,
      outcome: 'secluded',
      description: `${entity.staticData.name} 看淡争锋，归隐洞府安养余生`,
    };
  }
}

/**
 * 传承流执行器（ADR-023，参考大道争锋 传承道统 / 遮天 大帝晚年收徒）。
 * 高境界修士收徒传授衣钵：提升宗门稳定度（传承使宗门后继有人），置 discipleRaised=true。
 */
export class NPCTakeDiscipleExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const factionId = entity.state.get('factionId');
    let stabilityNote = '';
    if (factionId) {
      const faction = worldContext.entityRegistry?.getById(factionId);
      if (faction && faction.alive) {
        const stability = faction.state.get('stability') || 0;
        faction.state.set('stability', Math.min(stability + 3, 100));
        stabilityNote = '，宗门后继有人，气运更盛';
      }
    }
    entity.state.set('discipleRaised', true);
    return {
      success: true,
      outcome: 'disciple_raised',
      description: `${entity.staticData.name} 择良才收徒，倾囊相授衣钵道统${stabilityNote}`,
    };
  }
}

/**
 * 夺权流执行器（ADR-023，参考凡人修仙传/大道争锋 掌门继任之争）。
 * 临近权力顶端者发动夺位：按 risk.json power 键结算冲突风险；
 * 成功率受当前 roleRank 与野心影响。成功则经 promoteByLadder 接掌门位并置 isFactionLeader=true。
 */
export class NPCSeizePowerExecutor extends ActionExecutor {
  run(entity, worldContext, action) {
    const risk = settleRisk(entity, worldContext, 'power');
    if (risk.died) {
      return {
        success: false,
        outcome: 'death',
        riskTriggered: risk.triggered,
        description: `${entity.staticData.name} 夺位事败，殒命于权力倾轧`,
      };
    }

    // 成功率：野心越高、已在的职阶越高，越可能上位。
    const ambition = entity.staticData?.personality?.ambition ?? 50;
    const roleRank = entity.state.get('roleRank') || 1;
    const successRate = Math.min(0.85, 0.2 + ambition / 200 + roleRank * 0.08);
    if (worldContext.rng.next() < successRate && typeof worldContext.promoteByLadder === 'function') {
      const r = worldContext.promoteByLadder(entity.id);
      if (r && r.promoted === 'leader') {
        entity.state.set('isFactionLeader', true);
        return {
          success: true,
          outcome: 'seized_leadership',
          riskTriggered: risk.triggered,
          description: `${entity.staticData.name} 力压群雄，执掌一方势力，登临掌门之位`,
        };
      }
      if (r && r.promoted) {
        return {
          success: false,
          outcome: 'partial_promotion',
          toRole: r.promoted,
          riskTriggered: risk.triggered,
          description: `${entity.staticData.name} 夺位未竟，但已晋升为 ${r.promoted}`,
        };
      }
    }
    return {
      success: false,
      outcome: 'failed',
      riskTriggered: risk.triggered,
      description: `${entity.staticData.name} 夺位失败，暂避锋芒`,
    };
  }
}
