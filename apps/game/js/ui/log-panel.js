import { eventBus } from '../core/event-bus.js';
import { EVENTS, RELIABILITY_LEVELS } from '../core/constants.js';

const EVENT_TYPE_LABELS = {
  war: '⚔ 攻伐',
  alliance: '🤝 结盟',
  trade: '💰 贸易',
  betrayal: '🗡 叛变',
  civil_war: '🔥 内乱',
  raid: '💀 掠夺',
  demon_invasion: '👹 入侵',
  leader_death: '💀 陨落',
  realm_contest: '✨ 秘境',
  great_war: '⚡ 大战',
};

export class LogPanel {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.entries = [];
    this.currentDay = 0;
    this.factionNames = [];
    this.npcNames = [];
    this.pendingInfoForDay = {};
    this.setupListeners();
  }

  setHighlightNames(factions, npcs) {
    this.factionNames = (factions || []).map(f => f.name).sort((a, b) => b.length - a.length);
    this.npcNames = (npcs || []).map(n => n.name).sort((a, b) => b.length - a.length);
  }

  setupListeners() {
    eventBus.subscribe(EVENTS.INFO_RECEIVED, (data) => this.addEntry(data));
    eventBus.subscribe(EVENTS.WORLD_TICK_COMPLETE, (data) => this.onTick(data));
  }

  addEntry(info) {
    const day = info.day ?? this.currentDay;

    const typeLabel = this._detectEventType(info.content);
    const reliability = info.reliability ?? 0.5;

    let reliabilityTag;
    if (reliability > RELIABILITY_LEVELS.CONFIRMED) {
      reliabilityTag = { text: '确', cls: 'log-rel-confirmed' };
    } else if (reliability > RELIABILITY_LEVELS.MESSAGE) {
      reliabilityTag = { text: '传', cls: 'log-rel-message' };
    } else {
      reliabilityTag = { text: '疑', cls: 'log-rel-rumor' };
    }

    const highlightedContent = this._highlightNames(info.content || '');

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const distText = info.distance != null ? `${info.distance}格` : '';
    const sourceText = info.source || '';
    const metaParts = [sourceText, distText].filter(Boolean).join(' · ');

    entry.innerHTML =
      `<div class="log-line">` +
        `<span class="log-day-tag">D${day}</span>` +
        `<span class="log-rel ${reliabilityTag.cls}">${reliabilityTag.text}</span>` +
        (typeLabel ? `<span class="log-type-tag">${typeLabel}</span>` : '') +
        `<span class="log-text">${highlightedContent}</span>` +
      `</div>` +
      (metaParts ? `<div class="log-meta">${metaParts}</div>` : '');

    this.entries.push(entry);
    this.container.appendChild(entry);
    this.container.scrollTop = this.container.scrollHeight;
  }

  _detectEventType(content) {
    if (!content) return '';
    if (content.includes('贸易') || content.includes('互通')) return EVENT_TYPE_LABELS.trade;
    if (content.includes('结盟') || content.includes('同盟') || content.includes('守望')) return EVENT_TYPE_LABELS.alliance;
    if (content.includes('攻伐') || content.includes('击败') || content.includes('进攻') || content.includes('抵御') || content.includes('夺取')) return EVENT_TYPE_LABELS.war;
    if (content.includes('叛变') || content.includes('推翻')) return EVENT_TYPE_LABELS.betrayal;
    if (content.includes('内乱') || content.includes('分裂')) return EVENT_TYPE_LABELS.civil_war;
    if (content.includes('掠夺') || content.includes('劫掠')) return EVENT_TYPE_LABELS.raid;
    if (content.includes('妖') && content.includes('入侵')) return EVENT_TYPE_LABELS.demon_invasion;
    if (content.includes('陨落') || content.includes('继位') || content.includes('去世')) return EVENT_TYPE_LABELS.leader_death;
    if (content.includes('秘境') || content.includes('仙器')) return EVENT_TYPE_LABELS.realm_contest;
    if (content.includes('正邪') || content.includes('大战')) return EVENT_TYPE_LABELS.great_war;
    return '';
  }

  _highlightNames(text) {
    let result = text;
    for (const name of this.factionNames) {
      result = result.replaceAll(name, `<span class="hl-faction">${name}</span>`);
    }
    for (const name of this.npcNames) {
      result = result.replaceAll(name, `<span class="hl-npc">${name}</span>`);
    }
    return result;
  }

  onTick(data) {
    const day = data.day ?? data.playerState?.day;
    if (day && day !== this.currentDay) {
      this.currentDay = day;
    }
  }

  clear() {
    this.container.innerHTML = '';
    this.entries = [];
    this.currentDay = 0;
  }
}
