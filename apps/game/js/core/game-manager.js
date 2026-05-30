import { eventBus } from './event-bus.js';
import { EVENTS, GAME_CONSTANTS, TERRAIN_TYPES } from './constants.js';
import { loadGameConfigs } from './config-loader.js';
import { Renderer } from '../renderer/renderer.js';
import { UIManager } from '../ui/ui-manager.js';
import { SaveManager } from '../storage/save-manager.js';

/** 解析格子坐标键，与引擎 tileIndex 一致使用 "x,y"，兼容旧 "_" 格式 */
function parseTileKey(coordKey) {
  const sep = String(coordKey).includes(',') ? ',' : '_';
  const [x, y] = String(coordKey).split(sep).map(Number);
  return { x, y };
}

export class GameManager {
  constructor() {
    this.worker = null;
    this.renderer = null;
    this.uiManager = null;
    this.saveManager = null;
    this.worldState = null;
    this.playerState = null;
    this.configs = null;
    this.isRunning = false;
    this.currentDay = 0;
    this.tileGrid = null;
  }

  async init() {
    this.configs = await loadGameConfigs();
    this.buildTileGrid();
    this.initPlayerState();
    this.initWorker();
    await this.initRenderer();
    this.initUI();
    this.registerEvents();
    this.bindActionBar();

    this.saveManager = new SaveManager();
    await this.saveManager.init();
    this.uiManager.initSavePanel(this.saveManager, this);

    console.log('GameManager 初始化完成');
    console.log(`势力数量: ${this.configs.factions.length}`);
    console.log(`地图尺寸: ${this.configs.mapData.width}×${this.configs.mapData.height}`);
    console.log(`NPC 数量: ${this.configs.npcs.length}`);
    console.log(`地形类型: ${this.configs.ranks.length} 种境界`);
  }

  // --- 地图网格 ---

  buildTileGrid() {
    const { width, height, tiles } = this.configs.mapData;
    this.tileGrid = new Array(height);
    for (let y = 0; y < height; y++) {
      this.tileGrid[y] = new Array(width).fill(null);
    }
    for (const tile of tiles) {
      this.tileGrid[tile.y][tile.x] = tile;
    }
  }

  // --- 玩家初始化 ---

  initPlayerState() {
    this.playerState = {
      x: GAME_CONSTANTS.PLAYER_INITIAL_X,
      y: GAME_CONSTANTS.PLAYER_INITIAL_Y,
      actionPoints: GAME_CONSTANTS.PLAYER_ACTIONS_PER_DAY,
      actionsPerDay: GAME_CONSTANTS.PLAYER_ACTIONS_PER_DAY,
      senseRange: GAME_CONSTANTS.PLAYER_INITIAL_SENSE_RANGE,
      knownInfoIds: new Set(),
      currentDay: 0,
    };
  }

  // --- Worker ---

  initWorker() {
    this.worker = new Worker('js/engine/world-engine.worker.js', { type: 'module' });

    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      switch (type) {
        case 'INIT_COMPLETE':
          console.log('WorldEngine Worker 初始化完成', payload);
          this.isRunning = true;
          break;
        case 'TICK_RESULT':
          this.handleTickResult(payload);
          break;
        case 'MULTI_TICK_RESULT':
          this.handleMultiTickResult(payload);
          break;
        case 'ERROR':
          console.error('WorldEngine Worker 错误:', payload.message, payload.stack);
          break;
      }
    };

    // 直接传递 v2 configs（与 WorldEngine.init() 期望字段完全一致）
    this.worker.postMessage({
      type: 'INIT',
      payload: { configs: this.configs },
    });
  }

  // --- 渲染器 ---

  async initRenderer() {
    this.renderer = new Renderer('game-canvas');
    await this.renderer.init(
      this.configs.mapData,
      this.configs.terrains || [],
      this.configs.factions,
      this.playerState
    );
    this.renderer.start();

    this.renderer.onTileClick = (x, y) => {
      if (x >= 0 && x < this.configs.mapData.width && y >= 0 && y < this.configs.mapData.height) {
        eventBus.publish('TILE_CLICKED', { x, y });
      }
    };
  }

  // --- UI ---

  initUI() {
    this.uiManager = new UIManager();
    this.uiManager.init(
      this.configs.mapData,
      this.configs.terrains || [],
      this.configs.factions,
      this.playerState
    );
    this.uiManager.logPanel.setHighlightNames(this.configs.factions, this.configs.npcs);
    this.uiManager.initGraphPanel(this.configs);

    this.uiManager.setNavigateCallback((x, y) => {
      this.renderer.camera.centerOn(x, y);
    });
  }

  // --- 事件订阅 ---

  registerEvents() {
    eventBus.subscribe('TILE_CLICKED', (data) => {
      this.movePlayer(data.x, data.y);
    });

    eventBus.subscribe(EVENTS.EVENT_CHOICE_MADE, (data) => {
      if (data.cost > 0) {
        this.consumeActionPoints(data.cost);
      }
    });
  }

  // --- 按钮绑定 ---

  bindActionBar() {
    const btnMeditate = document.getElementById('btn-meditate');
    const btnSave = document.getElementById('btn-save');
    const btnDebug = document.getElementById('btn-debug');
    const btnGraph = document.getElementById('btn-graph');

    btnMeditate?.addEventListener('click', () => {
      const input = prompt('消耗多少行动点打坐？（当前：' + this.playerState.actionPoints + '）', '5');
      if (input === null) return;
      const points = parseInt(input);
      if (isNaN(points) || points <= 0) return;
      this.meditate(points);
    });

    btnSave?.addEventListener('click', () => {
      this.uiManager.savePanel.toggle();
    });

    btnDebug?.addEventListener('click', () => {
      const debugPanel = document.getElementById('debug-panel');
      if (debugPanel) {
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
      }
    });

    btnGraph?.addEventListener('click', () => {
      this.uiManager.graphPanel.toggle();
    });
  }

  // --- BFS 寻路 ---

  findPath(startX, startY, endX, endY) {
    const { width, height } = this.configs.mapData;

    if (endX < 0 || endX >= width || endY < 0 || endY >= height) return [];

    const endTile = this.tileGrid[endY]?.[endX];
    if (!endTile || endTile.terrain === TERRAIN_TYPES.RIVER) return [];

    const visited = new Set();
    const parent = new Map();
    const queue = [{ x: startX, y: startY }];
    const key = (x, y) => `${x}_${y}`;

    visited.add(key(startX, startY));

    const dirs = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    ];

    while (queue.length > 0) {
      const cur = queue.shift();

      if (cur.x === endX && cur.y === endY) {
        const path = [];
        let node = key(endX, endY);
        while (node && node !== key(startX, startY)) {
          const [nx, ny] = node.split('_').map(Number);
          path.unshift({ x: nx, y: ny });
          node = parent.get(node);
        }
        return path;
      }

      for (const { dx, dy } of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

        const nk = key(nx, ny);
        if (visited.has(nk)) continue;

        const tile = this.tileGrid[ny]?.[nx];
        if (!tile || tile.terrain === TERRAIN_TYPES.RIVER) continue;

        visited.add(nk);
        parent.set(nk, key(cur.x, cur.y));
        queue.push({ x: nx, y: ny });
      }
    }

    return [];
  }

  // --- 玩家移动 ---

  async movePlayer(targetX, targetY) {
    if (!this.isRunning) return;
    if (targetX === this.playerState.x && targetY === this.playerState.y) return;

    const path = this.findPath(this.playerState.x, this.playerState.y, targetX, targetY);
    if (path.length === 0) {
      console.log('无法到达目标位置');
      return;
    }

    for (const step of path) {
      const tile = this.tileGrid[step.y]?.[step.x];
      const cost = tile && tile.terrain === TERRAIN_TYPES.SWAMP ? 2 : 1;

      this.playerState.x = step.x;
      this.playerState.y = step.y;

      this.renderer.updatePlayerState(this.playerState);
      this.renderer.camera.centerOn(step.x, step.y);

      await this.consumeActionPoints(cost);
    }

    eventBus.publish(EVENTS.PLAYER_MOVED, { ...this.playerState });
  }

  // --- 打坐 ---

  async meditate(actionPoints) {
    if (!this.isRunning || actionPoints <= 0) return;

    await this.consumeActionPoints(actionPoints);
    eventBus.publish(EVENTS.PLAYER_MOVED, { ...this.playerState });
    console.log(`打坐完毕，当前第 ${this.playerState.currentDay} 天`);
  }

  // --- 行动点消耗 ---

  async consumeActionPoints(cost) {
    this.playerState.actionPoints -= cost;

    while (this.playerState.actionPoints <= 0) {
      await this._requestTickAsync();
      // handleTickResult 由 worker.onmessage 统一处理，避免重复副作用
      this.playerState.actionPoints += this.playerState.actionsPerDay;
      this.playerState.currentDay++;
    }

    this._refreshUI();
  }

  // --- Tick 请求 ---

  _requestTickAsync() {
    return new Promise((resolve) => {
      const handler = (e) => {
        if (e.data.type === 'TICK_RESULT') {
          this.worker.removeEventListener('message', handler);
          resolve(e.data.payload);
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ type: 'TICK', payload: {} });
    });
  }

  requestTick() {
    this.worker?.postMessage({ type: 'TICK', payload: {} });
  }

  // --- Tick 结果处理 ---

  /**
   * 处理来自 Worker 的 TICK_RESULT。
   * Worker 返回格式：{ day, factions, npcs, stats, activeModifiers, tickLog }
   */
  handleTickResult(result) {
    this.currentDay = result.day;
    this.playerState.currentDay = result.day;

    this._applyTerritoryChanges(result.factions);
    this._processInSenseEvents(result.tickLog);

    this.renderer.updateMapData(this.configs.mapData);
    this.renderer.updatePlayerState(this.playerState);

    this._refreshUI(result);

    this.uiManager.graphPanel.updateWorldState({
      factions: result.factions || {},
      npcs: result.npcs || {},
      activeModifiers: result.activeModifiers || [],
    });

    eventBus.publish(EVENTS.WORLD_TICK_COMPLETE, {
      day: result.day,
      playerState: this.playerState,
      activeModifiers: result.activeModifiers || [],
    });

    if (result.day > 0 && result.day % 10 === 0) {
      this.autoSave();
    }
  }

  handleMultiTickResult(payload) {
    // multiTick 只取最终状态更新一次 UI
    this.handleTickResult(payload);
  }

  /**
   * 根据势力快照更新地图 tile 归属
   */
  _applyTerritoryChanges(factions) {
    if (!factions) return;
    for (const [fId, fData] of Object.entries(factions)) {
      if (!fData.territory) continue;
      for (const coordKey of fData.territory) {
        const { x, y } = parseTileKey(coordKey);
        const tile = this.tileGrid[y]?.[x];
        if (tile) tile.ownerId = fId;
      }
    }
  }

  /**
   * 从 tickLog.events 中过滤出玩家神识范围内的事件，发布到 EventBus
   */
  _processInSenseEvents(tickLog) {
    if (!tickLog?.events) return;
    for (const evt of tickLog.events) {
      if (this.isInPlayerSenseRange(evt.x, evt.y)) {
        eventBus.publish(EVENTS.EVENT_TRIGGERED, {
          ...evt,
          playerOptions: evt.playerOptions || evt.player_options || [],
        });
      }
    }
  }

  _refreshUI(result = null) {
    this.uiManager.update({
      playerState: this.playerState,
      activeModifiers: result?.activeModifiers || [],
      timelineEntries: result?.tickLog?.events || [],
      mapData: this.configs.mapData,
    });
  }

  // --- 范围检测 ---

  isInPlayerSenseRange(x, y) {
    if (x == null || y == null) return true;
    const dx = Math.abs(x - this.playerState.x);
    const dy = Math.abs(y - this.playerState.y);
    return (dx * dx + dy * dy) <= (this.playerState.senseRange * this.playerState.senseRange);
  }

  _resolveLocationName(x, y) {
    if (x == null || y == null) return '';
    const tile = this.tileGrid[y]?.[x];
    if (!tile) return `(${x},${y})`;

    if (tile.ownerId) {
      const faction = this.configs.factions.find(f => f.id === tile.ownerId);
      if (faction) return `${faction.name}领地`;
    }

    const terrainDef = (this.configs.terrains || []).find(t => t.type === tile.terrain);
    const terrainName = terrainDef ? terrainDef.name : '未知';
    return `${terrainName}(${x},${y})`;
  }

  // --- 存档 ---

  getWorldSnapshot() {
    return {
      currentDay: this.currentDay,
      playerState: {
        ...this.playerState,
        knownInfoIds: [...this.playerState.knownInfoIds],
      },
      mapTiles: JSON.parse(JSON.stringify(this.configs.mapData.tiles)),
      configs: {
        mapWidth: this.configs.mapData.width,
        mapHeight: this.configs.mapData.height,
      },
    };
  }

  async save(name) {
    if (!this.saveManager) return;
    const snapshot = this.getWorldSnapshot();
    const logHistory = this.uiManager.logPanel.entries.map(el => el.outerHTML);
    return this.saveManager.save(name, snapshot, logHistory);
  }

  async load(saveId) {
    if (!this.saveManager) return;
    const saveData = await this.saveManager.load(saveId);
    if (!saveData) return;
    this.restoreFromSave(saveData);
  }

  restoreFromSave(saveData) {
    const { worldSnapshot, logHistory } = saveData;

    this.currentDay = worldSnapshot.currentDay || 0;
    this.playerState = {
      ...worldSnapshot.playerState,
      knownInfoIds: new Set(worldSnapshot.playerState.knownInfoIds || []),
    };

    if (worldSnapshot.mapTiles) {
      this.configs.mapData.tiles = JSON.parse(JSON.stringify(worldSnapshot.mapTiles));
      this.buildTileGrid();
    }

    this.worker?.terminate();
    this.initWorker();

    this.renderer.updateMapData(this.configs.mapData);
    this.renderer.updatePlayerState(this.playerState);
    this.renderer.camera.centerOn(this.playerState.x, this.playerState.y);

    this.uiManager.logPanel.clear();
    if (logHistory?.length > 0) {
      for (const html of logHistory) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const el = wrapper.firstChild;
        if (el) {
          this.uiManager.logPanel.container.appendChild(el);
          this.uiManager.logPanel.entries.push(el);
        }
      }
    }

    this._refreshUI();
    console.log(`已读取存档：${saveData.name}，第 ${this.currentDay} 天`);
  }

  async autoSave() {
    if (!this.saveManager) return;
    const snapshot = this.getWorldSnapshot();
    const logHistory = this.uiManager.logPanel.entries.map(el => el.outerHTML);
    await this.saveManager.autoSave(snapshot, logHistory);
    console.log(`自动存档完成 - 第 ${this.currentDay} 天`);
  }

  pause() { this.isRunning = false; }
  resume() { this.isRunning = true; }
}
