function text(value, fallback = '-') {
  const s = value == null ? '' : String(value).trim();
  return s || fallback;
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(value) {
  const n = num(value);
  if (n == null) return text(value);
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  if (Math.abs(n) >= 1000) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function fmtPercent(ratio) {
  const n = num(ratio);
  if (n == null) return '-';
  return `${Math.round(n * 100 + 1e-9)}%`;
}

function posText(spatial) {
  if (!spatial || typeof spatial.tileX !== 'number' || typeof spatial.tileY !== 'number') return '-';
  return `(${spatial.tileX},${spatial.tileY})`;
}

function destinationText(spatial) {
  const d = spatial?.destination;
  if (!d || typeof d.x !== 'number' || typeof d.y !== 'number') return '-';
  return `(${d.x},${d.y})`;
}

function factionName(snapshot, factionId) {
  return factionId ? (snapshot?.factions?.[factionId]?.name || '未知势力') : '散修';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const NPC_ACTION_LABELS = Object.freeze({
  idle: '空闲',
  traveling: '移动中',
  executing: '执行中',
  in_progress: '进行中',
});

const MONSTER_ACTION_LABELS = Object.freeze({
  wander: '游荡',
  hunt: '狩猎',
  rest: '休息',
  lair: '巢穴驻守',
  forage: '觅食',
  patrol: '巡逻',
});

const ROLE_LABELS = Object.freeze({
  leader: '掌门',
  heir: '继承人',
  elder: '长老',
  general: '将领',
  officer: '执事',
  core_disciple: '核心弟子',
  disciple: '弟子',
  outer_disciple: '外门弟子',
});

const GENDER_LABELS = Object.freeze({
  male: '男',
  female: '女',
});

const FACTION_TYPE_LABELS = Object.freeze({
  righteous: '正道',
  good: '正道',
  evil: '邪道',
  neutral: '中立',
  merchant: '商会',
  clan: '家族',
  academy: '书院',
});

const TALENT_LABELS = Object.freeze({
  heaven: '天灵根',
  dual: '双灵根',
  triple: '三灵根',
  quad: '四灵根',
  false: '伪灵根',
  mortal_body: '凡体',
  spirit_body: '天灵之体',
  dao_body: '先天道体',
  war_body: '不灭战体',
  nirvana_body: '涅槃之体',
});

function labelFromMap(map, key, fallback = '未知') {
  const raw = text(key, '');
  if (!raw) return fallback;
  return map[raw] || fallback;
}

function row(label, value, opts = {}) {
  return {
    label,
    value: text(value),
    percent: opts.percent ?? null,
    tone: opts.tone || '',
  };
}

function boundedRow(label, current, max, opts = {}) {
  const cur = num(current);
  const upper = num(max);
  const unit = opts.unit || '';

  if (cur == null) return row(label, '未知');
  if (upper == null || upper <= 0) return row(label, `${fmtNumber(cur)}${unit}（上限未知）`, { tone: 'unknown' });

  const ratio = upper > 0 ? cur / upper : 0;
  const status = opts.status ? opts.status(ratio, cur, upper) : boundedStatus(ratio);
  const displayCurrent = opts.percentValue ? fmtPercent(cur) : `${fmtNumber(cur)}${unit}`;
  const displayMax = opts.percentValue ? fmtPercent(upper) : `${fmtNumber(upper)}${unit}`;
  return row(label, `${displayCurrent}/${displayMax}（${fmtPercent(ratio)} · ${status.label}）`, {
    percent: Math.max(0, Math.min(100, ratio * 100)),
    tone: status.tone,
  });
}

function boundedStatus(ratio) {
  if (ratio >= 1) return { label: '已满', tone: 'good' };
  if (ratio >= 0.5) return { label: '积累中', tone: 'warn' };
  if (ratio > 0) return { label: '不足', tone: 'danger' };
  return { label: '为空', tone: 'danger' };
}

function hpStatus(ratio) {
  if (ratio <= 0) return { label: '已死亡', tone: 'danger' };
  if (ratio <= 0.2) return { label: '危急', tone: 'danger' };
  if (ratio <= 0.5) return { label: '受伤', tone: 'warn' };
  if (ratio < 1) return { label: '轻伤', tone: 'warn' };
  return { label: '健康', tone: 'good' };
}

function ageStatus(ratio) {
  if (ratio >= 1) return { label: '寿元耗尽', tone: 'danger' };
  if (ratio >= 0.9) return { label: '暮年', tone: 'danger' };
  if (ratio >= 0.7) return { label: '晚年', tone: 'warn' };
  if (ratio >= 0.4) return { label: '壮年', tone: 'good' };
  return { label: '青年', tone: 'good' };
}

function qiStatus(ratio) {
  if (ratio >= 1) return { label: '充足', tone: 'good' };
  if (ratio >= 0.5) return { label: '积累中', tone: 'warn' };
  if (ratio > 0) return { label: '不足', tone: 'danger' };
  return { label: '枯竭', tone: 'danger' };
}

function capStatus(ratio) {
  if (ratio >= 0.95) return { label: '已达上限', tone: 'good' };
  if (ratio >= 0.8) return { label: '接近上限', tone: 'warn' };
  if (ratio > 0) return { label: '修炼中', tone: 'warn' };
  return { label: '未开始', tone: 'danger' };
}

function totalProgressStatus(ratio) {
  if (ratio >= 1) return { label: '可突破', tone: 'good' };
  if (ratio >= 0.5) return { label: '积累中', tone: 'warn' };
  if (ratio > 0) return { label: '初步积累', tone: 'danger' };
  return { label: '未开始', tone: 'danger' };
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
  if (kind === 'faction') return { label: '势力运转', tone: 'busy' };

  const raw = kind === 'monster' ? text(entity.behaviorState, 'wander') : text(entity.actionStatus, 'idle');
  const label = kind === 'monster'
    ? labelFromMap(MONSTER_ACTION_LABELS, raw, '未知行为')
    : labelFromMap(NPC_ACTION_LABELS, raw, '未知行为');
  return { label, tone: label === '空闲' ? 'idle' : 'busy' };
}

function section(id, title, rows, defaultOpen = true) {
  return { id, title, rows: rows.filter(Boolean), defaultOpen };
}

function inventorySummary(inventory) {
  if (!inventory || typeof inventory !== 'object') return '无';
  const entries = Object.values(inventory).filter(v => Number(v) > 0);
  return entries.length ? `${entries.length} 类物品` : '无';
}

function buildNpcSections(entity, snapshot, life, action) {
  const moving = entity.spatial?.moving ? '移动中' : '停留';
  const maxInsight = entity.maxInsight ?? (entity.minCultivationRatio != null ? 1 - entity.minCultivationRatio : null);
  const totalProgress = entity.totalProgress ?? ((num(entity.cultivationProgress) || 0) + (num(entity.insight) || 0));
  const hasQuest = entity.hasActiveQuest ? '有任务' : '无任务';
  const companion = entity.daoCompanionId ? '已有道侣' : '无';
  const artifact = entity.equippedArtifactId ? '已装备' : '未装备';

  return [
    section('life', '生命与寿元', [
      row('生死', life.label, { tone: life.tone === 'dead' ? 'danger' : 'good' }),
      boundedRow('气血', entity.hp, entity.maxHp, { status: hpStatus }),
      boundedRow('寿元', entity.ageYears, entity.maxAgeYears, { unit: '岁', status: ageStatus }),
      row('受伤程度', entity.injuryLevel == null ? '未知' : `${fmtNumber(entity.injuryLevel)}级`),
    ]),
    section('cultivation', '真气与修炼', [
      row('境界', text(entity.rankName, '未知')),
      row('下一境界', text(entity.nextRankName, '未知')),
      boundedRow('真气', entity.qi, entity.nextQiRequired, { status: qiStatus }),
      boundedRow('闭关进度', entity.cultivationProgress, entity.cultivationCap, { percentValue: true, status: capStatus }),
      boundedRow('游历感悟', entity.insight, maxInsight, { percentValue: true, status: boundedStatus }),
      boundedRow('突破总进度', totalProgress, 1, { percentValue: true, status: totalProgressStatus }),
    ]),
    section('action', '当前行动', [
      row('行为', action.label, { tone: action.tone === 'busy' ? 'warn' : '' }),
      row('移动', moving),
      row('目的地', destinationText(entity.spatial)),
      row('剩余行动', entity.actionRemaining == null ? '未知' : `${fmtNumber(entity.actionRemaining)}天`),
      row('任务状态', hasQuest),
    ]),
    section('identity', '身份与关系', [
      row('职位', labelFromMap(ROLE_LABELS, entity.role, '无职位')),
      row('势力', factionName(snapshot, entity.factionId)),
      row('性别', labelFromMap(GENDER_LABELS, entity.gender, '未知')),
      row('道侣', companion),
      row('子女', `${fmtNumber(entity.childrenCount || 0)}人`),
    ]),
    section('talent', '资质与资产', [
      row('灵根', labelFromMap(TALENT_LABELS, entity.spiritRootId, '未知')),
      row('体质', labelFromMap(TALENT_LABELS, entity.physiqueId, '未知')),
      row('贡献', fmtNumber(entity.contribution || 0)),
      row('完成任务', `${fmtNumber(entity.totalQuestsCompleted || 0)}次`),
      row('物品', inventorySummary(entity.inventory)),
      row('法宝', artifact),
      row('身家评分', fmtNumber(entity.assetScore || 0)),
    ]),
    section('position', '位置', [
      row('坐标', posText(entity.spatial)),
      row('速度', entity.spatial?.speed == null ? '未知' : `${fmtNumber(entity.spatial.speed)}格/天`),
      row('目标坐标', destinationText(entity.spatial)),
    ]),
  ];
}

export function buildTrackedStatusModel(entity, kind, snapshot = {}) {
  if (!entity) {
    return {
      title: '未跟随',
      subtitle: '选择人物、妖兽或势力后显示状态',
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
        section('life', '生命', [
          row('状态', life.label),
          boundedRow('气血', entity.hp, entity.maxHp, { status: hpStatus }),
        ]),
        section('action', '行为', [
          row('当前行为', action.label),
        ]),
        section('position', '位置', [
          row('坐标', posText(entity.spatial)),
          row('移动', entity.spatial?.moving ? '移动中' : '停留'),
        ]),
      ],
    };
  }

  if (kind === 'faction') {
    return {
      title,
      subtitle: `势力 · ${labelFromMap(FACTION_TYPE_LABELS, entity.type, '未知类型')}`,
      life,
      action,
      sections: [
        section('life', '势力状态', [
          row('状态', life.label),
          boundedRow('稳定度', entity.stability, 100, { status: boundedStatus }),
        ]),
        section('resources', '资源', [
          row('弟子', fmtNumber(entity.resources?.disciples || 0)),
          row('领地', `${fmtNumber(entity.territoryCount || 0)}格`),
          row('灵石', fmtNumber(entity.resources?.low_spirit_stone || 0)),
          row('粮食', fmtNumber(entity.resources?.food || 0)),
        ]),
      ],
    };
  }

  return {
    title,
    subtitle: `人物 · ${text(entity.rankName, '未知境界')} · ${factionName(snapshot, entity.factionId)}`,
    life,
    action,
    sections: buildNpcSections(entity, snapshot, life, action),
  };
}

function rowToHtml(rawRow, escape) {
  const r = Array.isArray(rawRow)
    ? row(rawRow[0], rawRow[1])
    : rawRow;
  const tone = r.tone ? ` ${escape(r.tone)}` : '';
  const percent = num(r.percent);
  const meter = percent == null
    ? ''
    : `<span class="follow-status-meter ${tone.trim()}"><i style="width:${Math.max(0, Math.min(100, percent)).toFixed(1)}%"></i></span>`;
  return `<div class="follow-status-row${tone}"><span>${escape(r.label)}</span><b>${escape(r.value)}</b>${meter}</div>`;
}

export function statusModelToHtml(model, escape = escapeHtml) {
  const badge = `<span class="follow-life ${model.life.tone}">${escape(model.life.label)}</span>`;
  const action = `<span class="follow-action ${model.action.tone}">${escape(model.action.label)}</span>`;
  const sections = (model.sections || []).map(section => {
    const rows = (section.rows || []).map(r => rowToHtml(r, escape)).join('');
    const openAttr = section.defaultOpen === false ? '' : ' open';
    return `<details class="follow-status-section" data-section-id="${escape(section.id || section.title)}"${openAttr}>` +
      `<summary><span class="follow-section-caret"></span><span>${escape(section.title)}</span></summary>` +
      `<div class="follow-status-section-body">${rows}</div>` +
      `</details>`;
  }).join('');
  return `<div class="follow-status-summary"><div><strong>${escape(model.title)}</strong><small>${escape(model.subtitle)}</small></div><div class="follow-status-badges">${badge}${action}</div></div>${sections}`;
}
