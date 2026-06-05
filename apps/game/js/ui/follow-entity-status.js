function text(value, fallback = '-') {
  const s = value == null ? '' : String(value).trim();
  return s || fallback;
}

function posText(spatial) {
  if (!spatial || typeof spatial.tileX !== 'number' || typeof spatial.tileY !== 'number') return '-';
  return `(${spatial.tileX},${spatial.tileY})`;
}

function factionName(snapshot, factionId) {
  return factionId ? (snapshot?.factions?.[factionId]?.name || factionId) : '散修';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function getLifeStatus(entity, kind) {
  if (!entity) return { label: '未跟随', tone: 'idle' };
  if (kind === 'faction' && (entity.isDestroyed || entity.alive === false)) return { label: '覆灭', tone: 'dead' };
  if (entity.alive === false) return { label: '死亡', tone: 'dead' };
  return { label: '存活', tone: 'alive' };
}

export function getActionStatus(entity, kind) {
  if (!entity) return { label: '未选择', tone: 'idle' };
  if (getLifeStatus(entity, kind).tone === 'dead') return { label: '无行动', tone: 'idle' };
  const raw = kind === 'monster'
    ? entity.behaviorState
    : kind === 'npc'
      ? entity.actionStatus
      : null;
  const label = text(raw, 'idle');
  return { label, tone: label === 'idle' ? 'idle' : 'busy' };
}

export function buildTrackedStatusModel(entity, kind, snapshot = {}) {
  if (!entity) {
    return {
      title: '未跟随',
      subtitle: '选择 NPC、妖兽或势力后显示状态',
      life: getLifeStatus(null, kind),
      action: getActionStatus(null, kind),
      sections: [],
    };
  }

  const life = getLifeStatus(entity, kind);
  const action = getActionStatus(entity, kind);
  const title = text(entity.name, entity.id || '未知实体');

  if (kind === 'monster') {
    return {
      title,
      subtitle: `妖兽 · ${text(entity.gradeName || (entity.grade ? `${entity.grade}阶` : ''), '未知阶位')} · ${text(entity.family, '未知族类')}`,
      life,
      action,
      sections: [
        { title: '生命', rows: [['状态', life.label], ['气血', `${text(entity.hp, '?')}/${text(entity.maxHp, '?')}`]] },
        { title: '行为', rows: [['当前行为', action.label]] },
        { title: '位置', rows: [['坐标', posText(entity.spatial)]] },
      ],
    };
  }

  if (kind === 'faction') {
    return {
      title,
      subtitle: `势力 · ${text(entity.type, '未知类型')}`,
      life,
      action,
      sections: [
        { title: '生命', rows: [['状态', life.label], ['稳定度', text(entity.stability)]] },
        { title: '资源', rows: [['弟子', text(entity.resources?.disciples, '0')], ['领地', text(entity.territoryCount, '0')]] },
      ],
    };
  }

  return {
    title,
    subtitle: `NPC · ${text(entity.rankName, '未知境界')} · ${factionName(snapshot, entity.factionId)}`,
    life,
    action,
    sections: [
      { title: '生命', rows: [['状态', life.label], ['年龄', `${text(entity.ageYears, '?')}/${text(entity.maxAgeYears, '?')}岁`]] },
      { title: '行为', rows: [['当前行为', action.label], ['角色', text(entity.role, '无')]] },
      { title: '修炼', rows: [['境界', text(entity.rankName, '未知')], ['真气', text(entity.qi, '0')], ['进度', `${text(entity.cultivationProgress, '0')}%`]] },
      { title: '位置', rows: [['坐标', posText(entity.spatial)]] },
    ],
  };
}

export function statusModelToHtml(model, escape = escapeHtml) {
  const badge = `<span class="follow-life ${model.life.tone}">${escape(model.life.label)}</span>`;
  const action = `<span class="follow-action ${model.action.tone}">${escape(model.action.label)}</span>`;
  const sections = (model.sections || []).map(section => {
    const rows = section.rows.map(([k, v]) =>
      `<div class="follow-status-row"><span>${escape(k)}</span><b>${escape(v)}</b></div>`
    ).join('');
    return `<section class="follow-status-section"><h4>${escape(section.title)}</h4>${rows}</section>`;
  }).join('');
  return `<div class="follow-status-summary"><div><strong>${escape(model.title)}</strong><small>${escape(model.subtitle)}</small></div><div class="follow-status-badges">${badge}${action}</div></div>${sections}`;
}
