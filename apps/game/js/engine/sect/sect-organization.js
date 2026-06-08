function asList(value) {
  return Array.isArray(value) ? value : [];
}

export function hallsById(organization = {}) {
  return new Map(asList(organization.halls)
    .filter((hall) => hall?.id)
    .map((hall) => [hall.id, hall]));
}

export function rankOrderOf(rankId, ranksData = []) {
  const rank = asList(ranksData).find((entry) => entry?.id === rankId);
  if (!rank) throw new Error(`未知 rankId: ${rankId}`);
  return Number(rank.order);
}

export function isManagementRole(role, organization = {}) {
  if (!Array.isArray(organization.managementRoles)) {
    throw new Error('sect-organization.managementRoles 缺失');
  }
  return new Set(organization.managementRoles).has(role);
}

export function isSectFaction(faction) {
  if (!faction || faction.alive === false) return false;
  return faction.staticData?.get?.('isSect') === true;
}

export function eligibleHallMember(npc, organization = {}, ranksData = []) {
  const minOrder = Number(organization.hallMembership?.minRankOrder);
  if (!Number.isFinite(minOrder)) throw new Error('sect-organization.hallMembership.minRankOrder 缺失');
  return rankOrderOf(npc?.state?.get?.('rankId'), ranksData) >= minOrder;
}

export function hallForPressure(organization = {}, hallId) {
  const hall = hallsById(organization).get(hallId);
  if (!hall) throw new Error(`未知库存压力堂口: ${hallId}`);
  return hall;
}
