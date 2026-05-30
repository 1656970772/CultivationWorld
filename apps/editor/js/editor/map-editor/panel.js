import { createMapSummary } from '../map-summary.js';
import { TileMapModel } from './model.js';
import { MapEditHistory } from './history.js';
import { MapCanvasView as CanvasView } from './canvas-view.js';

export function createMapEditorPanel({ map, datasets = {}, onChange = () => {}, fallback }) {
  if (!CanvasView.isSupported()) {
    return typeof fallback === 'function' ? fallback() : createFallback();
  }

  const model = new TileMapModel(map);
  const history = new MapEditHistory();
  const state = {
    selectedRect: null,
    selectedTile: null
  };

  const container = createElement('div', 'map-editor');
  const toolbar = createElement('div', 'map-editor-toolbar');
  const terrainSelect = createSelect('map-editor-select', [
    { value: '', label: '不修改地形' },
    ...(datasets.terrains || []).map((terrain) => ({ value: terrain.type, label: terrain.name || terrain.type }))
  ]);
  const ownerSelect = createSelect('map-editor-select', [
    { value: '__keep', label: '不修改归属' },
    { value: '', label: '无主之地' },
    ...(datasets.factions || []).map((faction) => ({ value: faction.id, label: faction.name || faction.id }))
  ]);
  const rectToggle = createElement('label', 'map-editor-check');
  const rectInput = createElement('input');
  rectInput.type = 'checkbox';
  rectInput.checked = true;
  rectToggle.append(rectInput, createElement('span', '', '矩形填充'));

  const undoButton = createElement('button', 'secondary-btn compact', '撤销');
  const redoButton = createElement('button', 'secondary-btn compact', '重做');
  undoButton.type = 'button';
  redoButton.type = 'button';

  toolbar.append(
    createLabeledControl('地形画笔', terrainSelect),
    createLabeledControl('势力归属', ownerSelect),
    rectToggle,
    undoButton,
    redoButton
  );

  const canvasWrap = createElement('div', 'map-editor-canvas-wrap');
  const details = createElement('div', 'map-editor-side');
  const body = createElement('div', 'map-editor-body');
  const selectionCard = createElement('div', 'map-editor-card');
  const statsCard = createElement('div', 'map-editor-card');
  details.append(selectionCard, statsCard);

  const view = new CanvasView({
    model,
    datasets,
    onPreviewSelection: (rect) => {
      state.selectedRect = rect;
      if (!rect) state.selectedTile = null;
      renderSelection();
    },
    onSelect: (rect) => {
      state.selectedRect = rect;
      state.selectedTile = model.getTile(rect.x, rect.y);
      view.setSelectedTile(state.selectedTile);
      applyBrush(rectInput.checked ? rect : { x: rect.x, y: rect.y, width: 1, height: 1 });
    }
  });

  canvasWrap.append(view.getElement());
  body.append(canvasWrap, details);
  container.append(toolbar, body);

  undoButton.addEventListener('click', () => {
    const changes = history.undo(model);
    if (changes.length > 0) afterMutation();
  });

  redoButton.addEventListener('click', () => {
    const changes = history.redo(model);
    if (changes.length > 0) afterMutation();
  });

  function applyBrush(rect) {
    const patch = getBrushPatch(terrainSelect.value, ownerSelect.value);
    if (Object.keys(patch).length === 0) {
      renderSelection();
      return;
    }

    const changes = model.paintRect(rect, patch);
    if (!history.push(changes)) {
      renderSelection();
      return;
    }
    afterMutation();
  }

  function afterMutation() {
    onChange();
    view.draw();
    renderSelection();
    renderStats();
    updateHistoryButtons();
  }

  function renderSelection() {
    const tile = state.selectedTile || (state.selectedRect ? model.getTile(state.selectedRect.x, state.selectedRect.y) : null);
    const rect = state.selectedRect;
    selectionCard.replaceChildren(createElement('h4', '', '选中格详情'));

    if (!tile) {
      selectionCard.append(createElement('p', 'map-editor-muted', '尚未选择地图格。'));
      return;
    }

    const rows = [
      ['坐标', `${tile.x}, ${tile.y}`],
      ['地形', getTerrainLabel(tile.terrain, datasets)],
      ['归属', getOwnerLabel(tile.ownerId, datasets)],
      ['资源', tile.resourceType || '无'],
      ['建筑', Array.isArray(tile.buildings) && tile.buildings.length > 0 ? tile.buildings.join(', ') : '无']
    ];

    if (rect) rows.unshift(['范围', `${rect.width} x ${rect.height}`]);
    selectionCard.append(createRows(rows));
  }

  function renderStats() {
    const summary = createMapSummary(map, datasets);
    statsCard.replaceChildren(
      createElement('h4', '', '统计摘要'),
      createRows([
        ['尺寸', `${summary.width} x ${summary.height}`],
        ['格子', `${summary.tileCount} / ${summary.expectedTileCount}`],
        ['资源格', String(summary.resourceTileCount)],
        ['建筑格', String(summary.buildingTileCount)]
      ]),
      createSummaryPills('地形', summary.terrainCounts, (key) => getTerrainLabel(key, datasets)),
      createSummaryPills('领地', summary.ownerCounts, (key) => getOwnerLabel(key === 'unowned' ? '' : key, datasets), 8)
    );
  }

  function updateHistoryButtons() {
    undoButton.disabled = !history.canUndo();
    redoButton.disabled = !history.canRedo();
  }

  view.draw();
  renderSelection();
  renderStats();
  updateHistoryButtons();

  return container;
}

function getBrushPatch(terrain, ownerId) {
  const patch = {};
  if (terrain) patch.terrain = terrain;
  if (ownerId !== '__keep') patch.ownerId = ownerId || null;
  return patch;
}

function createLabeledControl(label, control) {
  const wrapper = createElement('label', 'map-editor-tool');
  wrapper.append(createElement('span', '', label), control);
  return wrapper;
}

function createSelect(className, options) {
  const select = createElement('select', className);
  for (const option of options) {
    const optionEl = createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.append(optionEl);
  }
  return select;
}

function createRows(rows) {
  const list = createElement('div', 'map-editor-rows');
  for (const [label, value] of rows) {
    const row = createElement('div', 'map-editor-row');
    row.append(createElement('span', '', label), createElement('strong', '', value));
    list.append(row);
  }
  return list;
}

function createSummaryPills(title, values, labeler, limit = Infinity) {
  const section = createElement('div', 'map-editor-summary');
  section.append(createElement('h5', '', title));
  const list = createElement('div', 'map-editor-pills');
  Object.entries(values || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .forEach(([key, value]) => {
      list.append(createElement('span', 'map-editor-pill', `${labeler(key)} ${value}`));
    });
  section.append(list);
  return section;
}

function getTerrainLabel(type, datasets) {
  return (datasets.terrains || []).find((terrain) => terrain.type === type)?.name || type || '未知';
}

function getOwnerLabel(ownerId, datasets) {
  if (!ownerId || ownerId === 'unowned') return '无主之地';
  return (datasets.factions || []).find((faction) => faction.id === ownerId)?.name || ownerId;
}

function createFallback() {
  const fallback = createElement('div', 'tile-summary');
  fallback.append(createElement('p', 'tile-summary-note', '当前环境不支持 Canvas，已切换为地图摘要。'));
  return fallback;
}

function createElement(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}
