/**
 * 模拟器主入口 - 直接在主线程运行 WorldEngine（便于调试）
 */
import { WorldEngine } from './engine/world-engine.js';
import { formatSpiritStones } from './core/constants.js';
import { loadGameConfigs } from './core/config-loader.js';
import { SimulationRenderer } from './renderer/simulation-renderer.js';
import { buildTrackedStatusModel, getActionStatus, getLifeStatus, statusModelToHtml } from './ui/follow-entity-status.js';

const FACTION_TYPE_NAMES = {
  righteous: '正派',
  evil: '邪派',
  neutral: '中立',
  demon: '妖族',
  mortal_kingdom: '凡人王朝',
};

class SimulationApp {
  constructor() {
    this.engine = new WorldEngine();
    this.autoRunning = false;
    this.autoInterval = null;
    this.ticksPerSecond = 5;
    this.selectedFactionId = null;
    this.logEntries = [];
    this.maxLogEntries = 500;

    // 渲染相关
    this.renderer = null;
    this.renderEnabled = false;
    this.entityTab = 'npc';
    this._entityListTimer = null;
    this._followStatusCollapsed = true;

    // 单个 NPC 行为事件日志（按 entityId 分组的环形队列）。
    // 实时模拟时为每个 NPC 累积其行为/目标事件，右侧"行为事件日志"面板按当前
    // 跟随的 NPC 渲染，切换跟随对象后自动显示新 NPC 的日志。
    this.npcEventLogs = new Map();
    this.maxNpcEvents = 80;
    this._npcEventSeq = 0;
    this._lastFollowIdForEvents = null;
  }

  async init() {
    const configs = await this.loadConfigs();
    const result = this.engine.init(configs);
    console.log('WorldEngine 初始化完成:', result);

    // 行为 id → 中文名映射（供行为事件日志显示情绪反应行为名等）。
    this._actionNames = {};
    for (const a of (configs.npcActions || [])) {
      if (a && a.id && a.name) this._actionNames[a.id] = a.name;
    }

    this.engine.setFactionAI(false);

    this.bindUI();
    this.render();
  }

  loadConfigs() {
    return loadGameConfigs();
  }

  bindUI() {
    document.getElementById('btn-tick').onclick = () => this.doTick(1);
    document.getElementById('btn-tick10').onclick = () => this.doTick(10);
    document.getElementById('btn-tick100').onclick = () => this.doTick(100);
    document.getElementById('btn-auto').onclick = () => this.toggleAuto();
    document.getElementById('btn-clear-log').onclick = () => this.clearLog();

    const factionAIBtn = document.getElementById('btn-toggle-faction-ai');
    factionAIBtn.onclick = () => {
      const enabled = factionAIBtn.dataset.enabled === 'true';
      const next = !enabled;
      this.engine.setFactionAI(next);
      factionAIBtn.dataset.enabled = String(next);
      factionAIBtn.textContent = `势力AI: ${next ? '开' : '关'}`;
      factionAIBtn.className = `toggle-btn ${next ? 'on' : 'off'}`;
    };

    const slider = document.getElementById('speed-slider');
    slider.oninput = () => {
      this.ticksPerSecond = parseInt(slider.value);
      document.getElementById('speed-display').textContent = `${this.ticksPerSecond} 天/秒`;
      if (this.renderer) this.renderer.setTicksPerSecond(this.ticksPerSecond);
      if (this.autoRunning) {
        this.stopAuto();
        this.startAuto();
      }
    };

    // 渲染开关
    const renderBtn = document.getElementById('btn-toggle-render');
    renderBtn.onclick = () => this.toggleRender(renderBtn);

    // 缩放控制
    document.getElementById('btn-zoom-in').onclick = () => this.renderer?.zoomIn();
    document.getElementById('btn-zoom-out').onclick = () => this.renderer?.zoomOut();
    document.getElementById('btn-zoom-reset').onclick = () => this.renderer?.resetView();

    const followStatusHeader = document.getElementById('follow-status-card-header');
    if (followStatusHeader) {
      followStatusHeader.onclick = () => {
        this._followStatusCollapsed = !this._followStatusCollapsed;
        this.refreshFollowStatusCard();
      };
    }

    // 实体跟随面板
    document.getElementById('btn-stop-follow').onclick = () => {
      if (this.renderer) this.renderer.stopFollow();
      this.refreshEntityList();
    };
    document.querySelectorAll('.entity-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.entity-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.entityTab = tab.dataset.tab;
        this.refreshEntityList();
      };
    });

    // 行为事件日志：清空当前跟随 NPC 的事件记录
    const clearEventsBtn = document.getElementById('btn-clear-npc-events');
    if (clearEventsBtn) {
      clearEventsBtn.onclick = (e) => {
        e.stopPropagation(); // 避免触发标题栏折叠
        const followId = this.renderer ? this.renderer.getFollowId() : null;
        if (followId) this.npcEventLogs.delete(followId);
        this.refreshNpcEventLog();
      };
    }

    // 可折叠区块：点击标题栏切换展开/收起（如折叠图例腾出空间看日志）
    document.querySelectorAll('.collapse-header').forEach(header => {
      header.onclick = () => {
        const section = header.closest('.collapsible');
        if (section) section.classList.toggle('collapsed');
      };
    });
  }

  async toggleRender(btn) {
    this.renderEnabled = !this.renderEnabled;
    const view = document.getElementById('render-view');

    if (this.renderEnabled) {
      btn.dataset.enabled = 'true';
      btn.textContent = '渲染画面: 开';
      btn.className = 'toggle-btn on';
      view.classList.remove('hidden');
      document.getElementById('app').classList.add('render-mode');

      if (!this.renderer) {
        const factionTypes = new Map();
        for (const f of this.engine.entityRegistry.getByType('faction')) {
          factionTypes.set(f.id, f.staticData?.factionType);
        }
        this.renderer = new SimulationRenderer({
          container: document.getElementById('render-canvas-wrap'),
          tileIndex: this.engine.tileIndex,
          terrainIndex: this.engine.terrainIndex,
          mapWidth: this.engine._mapWidth,
          mapHeight: this.engine._mapHeight,
          factionTypes,
        });
        await this.renderer.init();
        this.renderer.setTicksPerSecond(this.ticksPerSecond);
        this.renderer.onSelect(() => this.refreshEntityList());
      }
      this.renderer.updateSnapshot(this.engine.getWorldSnapshot());
      this.startEntityListRefresh();
    } else {
      btn.dataset.enabled = 'false';
      btn.textContent = '渲染画面: 关';
      btn.className = 'toggle-btn off';
      view.classList.add('hidden');
      document.getElementById('app').classList.remove('render-mode');
      this.stopEntityListRefresh();
    }
  }

  startEntityListRefresh() {
    this.refreshEntityList();
    if (this._entityListTimer) clearInterval(this._entityListTimer);
    this._entityListTimer = setInterval(() => this.refreshEntityList(), 1000);
  }

  stopEntityListRefresh() {
    if (this._entityListTimer) { clearInterval(this._entityListTimer); this._entityListTimer = null; }
  }

  refreshEntityList() {
    if (!this.renderEnabled || !this.renderer) return;
    // 行为事件日志随实体列表一起刷新（涵盖切换 tab / 切换跟随 / 定时刷新）。
    this.refreshNpcEventLog();
    const snap = this.engine.getWorldSnapshot();
    const followId = this.renderer.getFollowId();
    const listEl = document.getElementById('entity-list');

    // 势力 tab：列出每个具体势力，点击定位到其总部（不跟随）
    if (this.entityTab === 'faction') {
      this.refreshFactionList(snap, listEl);
      this.refreshFollowStatusCard(snap);
      return;
    }

    const source = this.entityTab === 'monster' ? snap.monsters : snap.npcs;

    this.refreshFollowStatusLine(snap);

    // 列表（限制数量；NPC 保留死亡对象用于状态观察，妖兽快照当前只含存活对象）
    const entries = Object.entries(source).filter(([, e]) => e.spatial || e.alive === false).slice(0, 200);
    listEl.innerHTML = '';
    for (const [id, e] of entries) {
      const div = document.createElement('div');
      const meta = this.entityTab === 'monster'
        ? `${e.gradeName || e.grade + '阶'} · ${e.family || ''}`
        : `${e.rankName || ''}`;
      const kind = this.entityTab === 'monster' ? 'monster' : 'npc';
      const life = getLifeStatus(e, kind);
      const action = getActionStatus(e, kind);
      div.className = `entity-item${id === followId ? ' following' : ''}${life.tone === 'dead' ? ' dead' : ''}`;
      div.innerHTML = `
        <div class="entity-main">
          <div class="e-name">${this._escapeHtml(e.name)}</div>
          <div class="e-meta">${this._escapeHtml(meta)}</div>
        </div>
        <div class="entity-status-stack">
          <span class="entity-life ${life.tone}">${this._escapeHtml(life.label)}</span>
          <span class="e-state ${action.tone}">${this._escapeHtml(action.label)}</span>
        </div>
      `;
      div.onclick = () => {
        this.renderer.followEntity(id, () => this.refreshEntityList());
        this.refreshEntityList();
      };
      listEl.appendChild(div);
    }
    this.refreshFollowStatusCard(snap);
  }

  /** 势力 tab：列出每个势力，点击把视角定位到其总部 */
  refreshFactionList(snap, listEl) {
    const statusEl = document.getElementById('follow-status');
    statusEl.textContent = '点击势力可把视角定位到其总部（不会持续跟随）。';

    const entries = Object.entries(snap.factions || {})
      .sort(([, a], [, b]) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return (b.resources?.disciples || 0) - (a.resources?.disciples || 0);
      });

    listEl.innerHTML = '';
    for (const [id, f] of entries) {
      const faction = this.engine.entityRegistry.getById(id);
      const hq = faction?.staticData?.headquarters;
      const div = document.createElement('div');
      const typeName = FACTION_TYPE_NAMES[f.type] || f.type;
      const life = getLifeStatus(f, 'faction');
      const action = getActionStatus(f, 'faction');
      div.className = `entity-item${f.isDestroyed ? ' destroyed dead' : ''}`;
      div.innerHTML = `
        <div class="entity-main">
          <div class="e-name">${this._escapeHtml(f.name)}${f.isDestroyed ? ' [覆灭]' : ''}</div>
          <div class="e-meta">${this._escapeHtml(typeName)} · 弟子 ${f.resources?.disciples || 0}</div>
        </div>
        <div class="entity-status-stack">
          <span class="entity-life ${life.tone}">${this._escapeHtml(life.label)}</span>
          <span class="e-state ${action.tone}">${hq ? `(${hq.x},${hq.y})` : this._escapeHtml(action.label)}</span>
        </div>
      `;
      if (hq && typeof hq.x === 'number') {
        div.onclick = () => this.renderer.focusOnTile(hq.x, hq.y);
      }
      listEl.appendChild(div);
    }
    this.refreshFollowStatusCard(snap);
  }

  _kindForFollowId(snap, followId) {
    if (!followId) return 'npc';
    if (snap.npcs?.[followId]) return 'npc';
    if (snap.monsters?.[followId]) return 'monster';
    if (snap.factions?.[followId]) return 'faction';
    return 'npc';
  }

  _followedEntityFromSnapshot(snap, followId) {
    if (!followId) return null;
    return snap.npcs?.[followId] || snap.monsters?.[followId] || snap.factions?.[followId] || null;
  }

  refreshFollowStatusLine(snapshot = null) {
    const statusEl = document.getElementById('follow-status');
    if (!statusEl || !this.renderer) return;
    const snap = snapshot || this.engine.getWorldSnapshot();
    const followId = this.renderer.getFollowId();

    if (!followId) {
      statusEl.textContent = this.entityTab === 'faction'
        ? '点击势力可把视角定位到其总部（不会持续跟随）。'
        : '从下方列表选择人物或妖兽进行跟随，或直接点击地图上的实体。';
      return;
    }

    const e = this._followedEntityFromSnapshot(snap, followId);
    if (!e) {
      statusEl.textContent = '正在跟随的实体已死亡或已离开当前快照。';
      return;
    }

    const sp = e.spatial;
    const kind = this._kindForFollowId(snap, followId);
    const action = getActionStatus(e, kind);
    const life = getLifeStatus(e, kind);
    const position = sp ? `位置 (${sp.tileX},${sp.tileY})` : '';
    statusEl.innerHTML = `正在跟随：<b>${this._escapeHtml(e.name)}</b>（${this._escapeHtml(life.label)} · ${this._escapeHtml(action.label)}）${this._escapeHtml(position)}`;
  }

  doTick(count) {
    for (let i = 0; i < count; i++) {
      const result = this.engine.tick();
      this.processTickLog(result);
      if (this.renderEnabled) this._collectNpcEvents(result);
    }
    this.render();
    if (this.renderEnabled && this.renderer) {
      const snap = this.engine.getWorldSnapshot();
      this.renderer.updateSnapshot(snap);
      this.refreshNpcEventLog();
      this.refreshFollowStatusLine(snap);
      this.refreshFollowStatusCard(snap);
    }
  }

  /**
   * 从一帧 tickLog.npcUpdates 中，为每个 NPC 提取"有意义的行为事件"并追加到
   * 其专属环形队列（this.npcEventLogs）。供右侧"行为事件日志"面板按跟随对象渲染。
   *
   * 记录策略（避免逐 tick 刷屏）：
   *   - 选中新目标：btTrace.selectedGoal 的来源/目标变化时记一条"决意"事件。
   *   - 行为结算：execution.status 为 step_done / plan_complete 且带 result 时记一条"行为"事件。
   *   - 情绪抢占反应：btTrace.reactedPath 命中时记一条"反应"事件。
   * 移动中/执行中的中间 tick（traveling/executing/in_progress）不单独记录。
   */
  _collectNpcEvents(tickLog) {
    const day = tickLog.day;
    for (const nl of (tickLog.npcUpdates || [])) {
      if (!nl || nl.skipped) continue;
      const id = nl.entityId;
      if (!id) continue;

      const exec = nl.execution || {};
      const trace = nl.btTrace || {};

      // 1) 情绪反应抢占（如心魔/恐惧驱动的即时行为）。reactedPath = { emotion, value, actionId }
      const reacted = trace.reactedPath;
      if (reacted && reacted.actionId) {
        const key = `${reacted.emotion || ''}:${reacted.actionId}`;
        const prev = this._lastReactedByNpc?.get?.(id);
        if (key !== prev) {
          (this._lastReactedByNpc ||= new Map()).set(id, key);
          this._pushNpcEvent(id, day, 'reaction',
            `情绪反应：${reacted.emotion || ''}(${Math.round(reacted.value || 0)}) → ${this._actionName(reacted.actionId)}`);
        }
      }

      // 2) 选中新目标（决意）。selectedGoal = _lastPlanResult = { needId, needName, goalSource, failed, ... }
      const goal = trace.selectedGoal;
      if (goal && goal.needId) {
        const goalKey = `${goal.needId}|${goal.failed ? 'x' : 'ok'}`;
        const prevGoal = this._lastGoalByNpc?.get?.(id);
        if (goalKey !== prevGoal) {
          (this._lastGoalByNpc ||= new Map()).set(id, goalKey);
          const label = goal.needName || goal.needId;
          const tag = ({ obsession: '执念', opportunity: '机会', relationship: '关系' })[goal.goalSource] || '目标';
          this._pushNpcEvent(id, day, 'goal',
            goal.failed ? `决意：${label}（无可行计划）` : `决意（${tag}）：${label}`);
        }
      }

      // 3) 行为结算
      if ((exec.status === 'step_done' || exec.status === 'plan_complete') && exec.result) {
        const actionName = exec.action?.name || exec.result.actionName || '行动';
        const desc = exec.result.description || `完成 ${actionName}`;
        const cls = exec.result.success === false ? 'danger' : 'action';
        this._pushNpcEvent(id, day, cls, desc);
      }
    }
  }

  /** 向某 NPC 的事件队列追加一条记录（环形截断）。 */
  _pushNpcEvent(npcId, day, cls, text) {
    let arr = this.npcEventLogs.get(npcId);
    if (!arr) { arr = []; this.npcEventLogs.set(npcId, arr); }
    arr.push({ id: ++this._npcEventSeq, day, cls, text });
    if (arr.length > this.maxNpcEvents) arr.shift();
  }

  /** 行为 id → 中文名（缺失时回退原 id）。 */
  _actionName(actionId) {
    return (this._actionNames && this._actionNames[actionId]) || actionId || '行动';
  }

  /**
   * 渲染右侧"行为事件日志"面板：显示当前跟随 NPC 的事件列表。
   * 切换跟随对象时自动重渲染（清空旧 NPC 的内容并展示新 NPC 的）。
   */
  refreshNpcEventLog() {
    const panel = document.getElementById('npc-event-log');
    const titleEl = document.getElementById('npc-event-title');
    const listEl = document.getElementById('npc-event-list');
    if (!panel || !listEl) return;

    const followId = this.renderer ? this.renderer.getFollowId() : null;

    if (!followId) {
      if (titleEl) titleEl.textContent = '行为事件日志';
      listEl.innerHTML = '<div class="npc-event-empty">选择并跟随一个人物，这里会显示它的行为事件。</div>';
      this._lastFollowIdForEvents = null;
      return;
    }

    const snap = this.engine.getWorldSnapshot();
    const e = snap.npcs[followId];
    // 跟随的是妖兽/势力时不显示 NPC 行为日志
    if (!e) {
      if (titleEl) titleEl.textContent = '行为事件日志';
      listEl.innerHTML = '<div class="npc-event-empty">当前跟随的不是人物（妖兽暂不记录行为日志）。</div>';
      this._lastFollowIdForEvents = followId;
      return;
    }

    if (titleEl) titleEl.textContent = `行为事件 · ${e.name}`;

    const events = this.npcEventLogs.get(followId) || [];
    if (events.length === 0) {
      listEl.innerHTML = '<div class="npc-event-empty">暂无行为事件，推进时间后将逐步记录。</div>';
    } else {
      // 最新在上
      const html = [];
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        html.push(
          `<div class="npc-event-item ${ev.cls}">` +
          `<span class="ev-day">第${ev.day}天</span>` +
          `<span class="ev-text">${this._escapeHtml(ev.text)}</span>` +
          `</div>`
        );
      }
      listEl.innerHTML = html.join('');
    }
    this._lastFollowIdForEvents = followId;
  }

  _escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  refreshFollowStatusCard(snapshot = null) {
    const card = document.getElementById('follow-status-card');
    const titleEl = document.getElementById('follow-status-card-title');
    const subtitleEl = document.getElementById('follow-status-card-subtitle');
    const bodyEl = document.getElementById('follow-status-card-body');
    if (!card || !titleEl || !subtitleEl || !bodyEl) return;

    card.classList.toggle('collapsed', this._followStatusCollapsed);
    const snap = snapshot || this.engine.getWorldSnapshot();
    const followId = this.renderer ? this.renderer.getFollowId() : null;
    const kind = this._kindForFollowId(snap, followId);
    const entity = this._followedEntityFromSnapshot(snap, followId);
    const model = buildTrackedStatusModel(entity, kind, snap);

    titleEl.textContent = model.title === '未跟随' ? '跟随状态' : model.title;
    subtitleEl.textContent = `${model.life.label} · ${model.action.label}`;
    const previousSectionState = new Map(
      Array.from(bodyEl.querySelectorAll('details.follow-status-section[data-section-id]'))
        .map(detail => [detail.dataset.sectionId, detail.open])
    );
    bodyEl.innerHTML = statusModelToHtml(model, (s) => this._escapeHtml(s));
    for (const detail of bodyEl.querySelectorAll('details.follow-status-section[data-section-id]')) {
      if (previousSectionState.has(detail.dataset.sectionId)) {
        detail.open = previousSectionState.get(detail.dataset.sectionId);
      }
    }
  }

  /** 把坐标/地点格式化为日志后缀，如「 @(123,45) 平原」；无坐标返回空串 */
  _locSuffix(evt) {
    if (!evt || typeof evt.x !== 'number' || typeof evt.y !== 'number') return '';
    const place = evt.locationName ? ` ${evt.locationName}` : '';
    return ` @(${evt.x},${evt.y})${place}`;
  }

  processTickLog(tickLog) {
    const day = tickLog.day;

    for (const fd of tickLog.factionDecisions) {
      if (fd.execution && fd.execution.status !== 'idle') {
        const plan = fd.plan;
        const actionName = fd.execution.action?.name || fd.execution.result?.actionName || '';
        let logClass = '';
        let text = `${fd.factionName} `;

        if (plan && plan.needName) {
          text += `[${plan.needName}] `;
        }

        if (fd.execution.result?.description) {
          text += fd.execution.result.description;
        } else if (actionName) {
          text += `执行了 ${actionName}`;
        } else {
          text += '做出了行动';
        }

        if (fd.execution.result?.success === false) {
          logClass = 'danger';
        } else if (actionName.includes('攻')) {
          logClass = 'important';
        } else if (actionName.includes('结盟') || actionName.includes('贸易')) {
          logClass = 'success';
        }

        if (!fd.state.alive) {
          text = `${fd.factionName} 已覆灭！`;
          logClass = 'danger';
        }

        this.addLog(day, text, logClass);
      }
    }

    for (const rule of tickLog.worldRules?.rules || []) {
      if (rule.result?.spawned) {
        const mod = rule.result.modifier;
        this.addLog(day, `世界异变：${mod.name} 降临，持续 ${mod.remainingDays} 天`, 'important');
      }
      if (rule.result?.expired?.length > 0) {
        for (const exp of rule.result.expired) {
          this.addLog(day, `世界状态消退：${exp.name}`, '');
        }
      }
      if (rule.result?.disaster) {
        this.addLog(day,
          `天灾降临 ${rule.result.targetName}：稳定度 -${rule.result.stabilityLoss}，粮食 -${rule.result.foodLoss}`,
          'danger'
        );
      }
    }

    // NPC 死亡日志（统一来自 tickLog.deaths，覆盖自然/妖兽/任务三种死因）
    for (const d of (tickLog.deaths || [])) {
      const factionName = d.factionId
        ? (this.engine.entityRegistry.getById(d.factionId)?.name || d.factionId)
        : '散修';
      const who = `${factionName} ${d.npcName}（${d.rankName || '凡人'}）`;
      let text, cls;
      switch (d.cause) {
        case 'natural':
          text = `${who}寿终正寝，享年 ${d.ageYears}/${d.maxAgeYears} 岁`;
          cls = 'important';
          break;
        case 'monster': {
          const beast = d.monsterName
            ? `${d.monsterGrade ? d.monsterGrade + '阶妖兽' : '妖兽'}「${d.monsterName}」`
            : '妖兽';
          text = `${who}被${beast}击杀`;
          cls = 'danger';
          break;
        }
        case 'quest':
          text = `${who}在执行「${d.questName || '任务'}」时身陨`;
          cls = 'danger';
          break;
        default:
          text = `${who}身亡`;
          cls = 'danger';
      }
      this.addLog(day, text + this._locSuffix(d), cls);
    }

    // 妖兽死亡日志
    for (const m of (tickLog.monsterDeaths || [])) {
      const beast = `${m.grade}阶妖兽「${m.monsterName}」`;
      let text;
      if (m.killerName) {
        text = `${beast}被 ${m.killerName} 斩杀`;
      } else if (m.cause === 'natural') {
        const age = m.ageYears != null && m.maxAgeYears != null
          ? `，享年 ${m.ageYears}/${m.maxAgeYears} 岁` : '';
        text = `${beast}寿元将尽，无疾而终${age}`;
      } else {
        text = `${beast}陨落`;
      }
      this.addLog(day, text + this._locSuffix(m), '');
    }

    // 位置事件：悬赏/任务、道侣、生育（tickLog.events，均带坐标）
    for (const evt of (tickLog.events || [])) {
      const text = this._formatLocationEvent(evt);
      if (text) this.addLog(day, text + this._locSuffix(evt), this._eventLogClass(evt));
    }

    // 信息事件：势力攻击/结盟、妖兽袭击（tickLog.infoEvents，已补坐标）
    for (const evt of (tickLog.infoEvents || [])) {
      if (evt.description) {
        const cls = evt.type === 'attack' ? 'important'
          : evt.type === 'alliance' ? 'success'
          : evt.type === 'monster_attack' ? 'danger' : '';
        this.addLog(day, evt.description + this._locSuffix(evt), cls);
      }
    }
  }

  /** 位置事件 → 日志文案；优先用事件自带 description */
  _formatLocationEvent(evt) {
    if (!evt) return '';
    switch (evt.type) {
      case 'wanderer_bounty_accept':
      case 'wanderer_bounty_do':
      case 'wanderer_bounty_turn_in':
      case 'quest_accept':
      case 'quest_do':
      case 'quest_turn_in':
        return evt.description || '';
      case 'dao_companion':
        return `${evt.npc1Name} 与 ${evt.npc2Name} 结为道侣`;
      case 'birth':
        return `${evt.fatherName} 与 ${evt.motherName} 诞下${evt.childGender === 'female' ? '女' : '子'} ${evt.childName}`;
      default:
        return evt.description || '';
    }
  }

  /** 位置事件日志样式 */
  _eventLogClass(evt) {
    if (!evt) return '';
    if (evt.success === false) return 'danger';
    if (evt.type === 'wanderer_bounty_turn_in' || evt.type === 'quest_turn_in') return 'success';
    if (evt.type === 'dao_companion' || evt.type === 'birth') return '';
    if (String(evt.type).startsWith('wanderer_bounty')) return 'important';
    return '';
  }

  addLog(day, text, logClass = '') {
    this._logSeq = (this._logSeq || 0) + 1;
    this.logEntries.push({ id: this._logSeq, day, text, logClass });
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries.shift();
    }
  }

  clearLog() {
    this.logEntries = [];
    this._renderedLogTopId = null;
    document.getElementById('log-container').innerHTML = '';
  }

  toggleAuto() {
    if (this.autoRunning) {
      this.stopAuto();
    } else {
      this.startAuto();
    }
  }

  startAuto() {
    this.autoRunning = true;
    document.getElementById('btn-auto').textContent = '停止';
    document.getElementById('btn-auto').dataset.running = 'true';
    this.autoInterval = setInterval(() => {
      this.doTick(1);
    }, 1000 / this.ticksPerSecond);
  }

  stopAuto() {
    this.autoRunning = false;
    document.getElementById('btn-auto').textContent = '自动运行';
    document.getElementById('btn-auto').dataset.running = 'false';
    if (this.autoInterval) {
      clearInterval(this.autoInterval);
      this.autoInterval = null;
    }
  }

  render() {
    const snapshot = this.engine.getWorldSnapshot();
    this.renderWorldStats(snapshot);
    this.renderFactions(snapshot);
    this.renderLog();
    if (this.selectedFactionId) {
      this.renderDetail(snapshot);
    }
  }

  renderWorldStats(snapshot) {
    document.getElementById('stat-day').textContent = `第 ${snapshot.day} 天（${Math.floor(snapshot.day / 360)} 年 ${snapshot.day % 360} 天）`;
    document.getElementById('stat-factions').textContent = `势力: ${snapshot.stats.aliveFactions}/${snapshot.stats.totalFactions}`;
    document.getElementById('stat-npcs').textContent = `人物: ${snapshot.stats.aliveNPCs}/${snapshot.stats.totalNPCs}`;
    const monsterStat = document.getElementById('stat-monsters');
    if (monsterStat) {
      monsterStat.textContent = `妖兽: ${snapshot.stats.aliveMonsters ?? 0}/${snapshot.stats.totalMonsters ?? 0}`;
    }

    const modNames = snapshot.activeModifiers.map(m => m.name).join('、');
    document.getElementById('stat-modifiers').textContent = `世界状态: ${modNames || '无'}`;
  }

  /** 若已开启渲染，把视角定位到指定势力的总部 */
  focusFactionOnMap(factionId) {
    if (!this.renderer) return;
    const faction = this.engine.entityRegistry.getById(factionId);
    const hq = faction?.staticData?.headquarters;
    if (hq && typeof hq.x === 'number') {
      this.renderer.focusOnTile(hq.x, hq.y);
    }
  }

  renderFactions(snapshot) {
    const grid = document.getElementById('factions-grid');
    grid.innerHTML = '';

    const sortedFactions = Object.entries(snapshot.factions)
      .sort(([, a], [, b]) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return (b.resources?.disciples || 0) - (a.resources?.disciples || 0);
      });

    for (const [id, f] of sortedFactions) {
      const card = document.createElement('div');
      card.className = `faction-card${f.isDestroyed ? ' destroyed' : ''}${this.selectedFactionId === id ? ' selected' : ''}`;
      card.onclick = () => {
        this.selectedFactionId = id;
        this.render();
        this.focusFactionOnMap(id);
      };

      const stability = f.stability || 0;
      let stabilityColor = 'var(--success)';
      if (stability < 30) stabilityColor = 'var(--danger)';
      else if (stability < 60) stabilityColor = 'var(--warning)';

      card.innerHTML = `
        <div class="faction-name">${f.name}${f.isDestroyed ? ' [覆灭]' : ''}</div>
        <span class="faction-type ${f.type}">${FACTION_TYPE_NAMES[f.type] || f.type}</span>
        <div class="faction-stats">
          <span class="label">弟子</span><span>${f.resources?.disciples || 0}</span>
          <span class="label">灵石</span><span>${formatSpiritStones(f.resources?.low_spirit_stone)}</span>
          <span class="label">粮食</span><span>${f.resources?.food || 0}</span>
          <span class="label">领地</span><span>${f.territoryCount || 0}</span>
        </div>
        <div class="stability-bar">
          <div class="stability-fill" style="width:${stability}%;background:${stabilityColor}"></div>
        </div>
      `;
      grid.appendChild(card);
    }
  }

  renderLog() {
    const container = document.getElementById('log-container');
    const recent = this.logEntries.slice(-(this.maxVisibleLogs || 200));

    if (recent.length === 0) {
      container.innerHTML = '';
      this._renderedLogTopId = null;
      return;
    }

    // 循环列表 + 从上到下（旧在上、新在下）。增量追加到底部，避免整列表重建闪烁；
    // 超出上限时从顶部删除最旧的 DOM，形成滚动循环效果。
    const lastId = this._renderedLogTopId || 0;
    const fresh = recent.filter(e => e.id > lastId);

    if (fresh.length === 0) return; // 无新条目

    if (fresh.length >= recent.length) {
      // 首次或清空后：全量构建
      container.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const entry of recent) frag.appendChild(this._buildLogRow(entry));
      container.appendChild(frag);
    } else {
      // 仅把新条目追加到底部
      const frag = document.createDocumentFragment();
      for (const entry of fresh) frag.appendChild(this._buildLogRow(entry));
      container.appendChild(frag);
      // 修剪顶部超出上限的旧条目
      while (container.childElementCount > recent.length) {
        container.removeChild(container.firstChild);
      }
    }

    this._renderedLogTopId = recent[recent.length - 1].id;
    // 自动滚动到底部，始终展示最新
    container.scrollTop = container.scrollHeight;
  }

  _buildLogRow(entry) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.logClass}`;
    div.innerHTML = `<span class="log-day">[第${entry.day}天]</span> <span class="log-text">${entry.text}</span>`;
    return div;
  }

  renderDetail(snapshot) {
    const content = document.getElementById('detail-content');
    const faction = snapshot.factions[this.selectedFactionId];
    if (!faction) {
      content.innerHTML = '<p class="hint">该势力不存在</p>';
      return;
    }

    const entity = this.engine.entityRegistry.getById(this.selectedFactionId);
    const needsHtml = entity && entity.needSystem
      ? entity.needSystem.needs.map(n => `
        <div class="need-bar">
          <span class="bar-label">${n.name}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${n.priority}%"></div></div>
          <span class="bar-value">${Math.round(n.priority)}</span>
        </div>
      `).join('')
      : '<p>无需求数据</p>';

    const planInfo = entity?.behaviorSystem?.getLastPlanResult();
    const planHtml = planInfo
      ? `<p>目标需求: ${planInfo.needName || '-'} (优先级 ${planInfo.needPriority || 0})</p>
         <p>计划步骤: ${planInfo.actions?.join(' → ') || '无'}</p>
         <p>搜索迭代: ${planInfo.iterations || 0}</p>`
      : '<p>无规划数据</p>';

    const leaderNpc = faction.leaderNpcId ? snapshot.npcs[faction.leaderNpcId] : null;
    const leaderHtml = leaderNpc
      ? `${leaderNpc.name}（${leaderNpc.rankName}，${leaderNpc.ageYears}岁/${leaderNpc.maxAgeYears}岁）`
      : '无';

    const relationsHtml = Object.entries(faction.relations || {})
      .sort(([, a], [, b]) => b - a)
      .map(([fId, rel]) => {
        const other = snapshot.factions[fId];
        const relColor = rel > 50 ? 'var(--success)' : rel < -50 ? 'var(--danger)' : 'var(--text-secondary)';
        return `<span style="color:${relColor}">${other?.name || fId}: ${rel}</span>`;
      }).join(' | ');

    content.innerHTML = `
      <div class="detail-section">
        <h3>${faction.name}</h3>
        <table>
          <tr><td>阵营</td><td>${FACTION_TYPE_NAMES[faction.type]}</td></tr>
          <tr><td>掌门</td><td>${leaderHtml}</td></tr>
          <tr><td>稳定度</td><td>${faction.stability || 0}</td></tr>
          <tr><td>领地</td><td>${faction.territoryCount || 0} 格</td></tr>
          <tr><td>灵石</td><td>${formatSpiritStones(faction.resources?.low_spirit_stone)}</td></tr>
          <tr><td>弟子</td><td>${faction.resources?.disciples || 0}</td></tr>
          <tr><td>粮食</td><td>${faction.resources?.food || 0}</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <h3>需求优先级</h3>
        ${needsHtml}
      </div>
      <div class="detail-section">
        <h3>GOAP 规划</h3>
        ${planHtml}
      </div>
      <div class="detail-section">
        <h3>外交关系</h3>
        <div style="font-size:11px;line-height:1.8">${relationsHtml || '无'}</div>
      </div>
    `;
  }
}

const app = new SimulationApp();
app.init().catch(err => {
  console.error('模拟器初始化失败:', err);
  document.getElementById('detail-content').innerHTML =
    `<p style="color:var(--danger)">初始化失败: ${err.message}</p><pre>${err.stack}</pre>`;
});
