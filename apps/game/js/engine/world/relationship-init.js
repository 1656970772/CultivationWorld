/**
 * 初始关系生成（ADR-027）。
 *
 * 开局据 NPC 的 factionId + role 推导两类静态关系边：
 *   - same_sect：同宗门弟子两两互建同门边
 *   - master / disciple：同宗门内掌门/长老收弟子为徒
 *
 * 纯函数式（只读 NPC 实体 + 配置，写入传入的 RelationshipSystem），不依赖 Tick 流程，便于单测。
 */

/** 取 NPC 的当前职位（运行时 currentRole 优先，回退静态 initialRole / role）。 */
function roleOf(npc) {
  return npc.state?.get('currentRole')
    || npc.staticData?.get('initialRole')
    || npc.staticData?.get('role')
    || 'disciple';
}

/** 取 NPC 的境界 order（用于师徒就近匹配）；无则 0。 */
function rankOrderOf(npc, rankOrderMap) {
  const rankId = npc.state?.get('rankId');
  return rankOrderMap[rankId] ?? 0;
}

/**
 * @param {import('./relationship-system.js').RelationshipSystem} rs
 * @param {Array} npcs 全部 NPC 实体
 * @param {Object} [config] relationship.json 内容
 * @param {Object} [rankOrderMap] rankId→order（可选，用于师徒就近匹配）
 * @returns {{ sameSectEdges:number, masterDiscipleEdges:number }}
 */
export function initRelationships(rs, npcs, config = {}, rankOrderMap = {}) {
  if (!rs || !rs.enabled || !Array.isArray(npcs) || npcs.length === 0) {
    return { sameSectEdges: 0, masterDiscipleEdges: 0 };
  }
  const initCfg = config?.init || {};

  // 按势力分组（仅含 factionId 的 NPC；散修不建同门/师徒）。
  const byFaction = new Map();
  for (const npc of npcs) {
    if (npc.alive === false) continue;
    const fId = npc.state?.get('factionId');
    if (!fId) continue;
    if (!byFaction.has(fId)) byFaction.set(fId, []);
    byFaction.get(fId).push(npc);
  }

  let sameSectEdges = 0;
  let masterDiscipleEdges = 0;

  // —— 同门边 ——
  const sameSectCfg = initCfg.sameSect || {};
  if (sameSectCfg.enabled !== false) {
    const maxPerFaction = sameSectCfg.maxPerFaction ?? 60;
    for (const members of byFaction.values()) {
      // 规模护栏：成员过多时只在前 maxPerFaction 人内建两两边，避免 O(n^2) 爆量。
      const pool = members.length > maxPerFaction ? members.slice(0, maxPerFaction) : members;
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          // same_sect 配置了 symmetricType=same_sect，addEdge 会自动建反向边。
          if (rs.addEdge(pool[i].id, pool[j].id, 'same_sect', { eventType: 'same_sect_init' })) {
            sameSectEdges++;
          }
        }
      }
    }
  }

  // —— 师徒边 ——
  const mdCfg = initCfg.masterDisciple || {};
  if (mdCfg.enabled !== false) {
    const masterRoles = new Set(mdCfg.masterRoles || ['leader', 'elder']);
    const discipleRoles = new Set(mdCfg.discipleRoles || ['disciple', 'outer_disciple']);
    const maxPerMaster = mdCfg.maxDisciplesPerMaster ?? 3;

    for (const members of byFaction.values()) {
      const masters = members.filter(n => masterRoles.has(roleOf(n)));
      let disciples = members.filter(n => discipleRoles.has(roleOf(n)));
      if (masters.length === 0 || disciples.length === 0) continue;

      // 师傅按境界从高到低；弟子按境界从高到低，依次分配（高境界师傅带高境界弟子）。
      masters.sort((a, b) => rankOrderOf(b, rankOrderMap) - rankOrderOf(a, rankOrderMap));
      disciples.sort((a, b) => rankOrderOf(b, rankOrderMap) - rankOrderOf(a, rankOrderMap));

      let di = 0;
      for (const master of masters) {
        for (let k = 0; k < maxPerMaster && di < disciples.length; k++, di++) {
          const disciple = disciples[di];
          if (disciple.id === master.id) continue;
          // master 配置了 symmetricType=disciple，addEdge 自动建反向 disciple 边。
          if (rs.addEdge(master.id, disciple.id, 'master', { eventType: 'same_sect_init' })) {
            masterDiscipleEdges++;
          }
        }
        if (di >= disciples.length) break;
      }
    }
  }

  return { sameSectEdges, masterDiscipleEdges };
}

/** 取妖兽老巢坐标（home 优先，回退当前位置）；无则 null。 */
function monsterHome(m) {
  const hx = m.staticData?.get('homeX');
  const hy = m.staticData?.get('homeY');
  if (typeof hx === 'number' && typeof hy === 'number') return { x: hx, y: hy };
  if (m.spatial) return { x: m.spatial.tileX, y: m.spatial.tileY };
  return null;
}

/**
 * 初始妖群关系（ADR-028）：同 family 且老巢邻近的妖兽互建 pack_member 边（双向对称），
 * 簇内最高 grade 妖兽建 pack_leader 臣服边。仅 goalsEnabled 时由 world-engine 调用。
 *
 * 纯函数式（只读妖兽实体 + 配置，写入传入的 RelationshipSystem），可单独对一批新增妖兽调用
 * （初始生成 / 种群补刷复用）。
 * @param {import('./relationship-system.js').RelationshipSystem} rs
 * @param {Array} monsters 妖兽实体（全部或新增的一批）
 * @param {Object} [packConfig] relationship.json 的 monsterPack 段
 * @returns {{ packEdges:number, leaderEdges:number }}
 */
export function initMonsterRelationships(rs, monsters, packConfig = {}) {
  if (!rs || !rs.enabled || !Array.isArray(monsters) || monsters.length === 0) {
    return { packEdges: 0, leaderEdges: 0 };
  }
  const packRadius = packConfig.packRadius ?? 12;
  const buildLeader = packConfig.buildPackLeader !== false;
  const maxPackSize = packConfig.maxPackSize ?? 8;

  // 按 family 分组（无 family 的妖兽不组群）。
  const byFamily = new Map();
  for (const m of monsters) {
    if (m.alive === false) continue;
    const fam = m.staticData?.get('family');
    if (!fam) continue;
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam).push(m);
  }

  let packEdges = 0;
  let leaderEdges = 0;

  for (const members of byFamily.values()) {
    // 简单近邻聚类：对每只妖兽，与老巢距离 ≤ packRadius 的同族建群边（限 maxPackSize 防爆量）。
    for (let i = 0; i < members.length; i++) {
      const hi = monsterHome(members[i]);
      if (!hi) continue;
      let linked = 0;
      for (let j = i + 1; j < members.length && linked < maxPackSize; j++) {
        const hj = monsterHome(members[j]);
        if (!hj) continue;
        const dist = Math.abs(hi.x - hj.x) + Math.abs(hi.y - hj.y);
        if (dist > packRadius) continue;
        // pack_member 配置了 symmetricType=pack_member，addEdge 自动建反向边。
        if (rs.addEdge(members[i].id, members[j].id, 'pack_member', { eventType: 'pack_init' })) {
          packEdges++;
          linked++;
        }
      }
    }

    // 妖群首领：簇内最高 grade 妖兽，群成员对其建 pack_leader 臣服边。
    if (buildLeader && members.length > 1) {
      let leader = members[0];
      for (const m of members) {
        if ((m.grade || 0) > (leader.grade || 0)) leader = m;
      }
      for (const m of members) {
        if (m.id === leader.id) continue;
        // 仅对与首领老巢邻近的成员建臣服边（同群范围内）。
        const hm = monsterHome(m);
        const hl = monsterHome(leader);
        if (!hm || !hl) continue;
        if (Math.abs(hm.x - hl.x) + Math.abs(hm.y - hl.y) > packRadius) continue;
        if (rs.addEdge(m.id, leader.id, 'pack_leader', { eventType: 'pack_leader_init' })) {
          leaderEdges++;
        }
      }
    }
  }

  return { packEdges, leaderEdges };
}
