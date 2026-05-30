import { strict as assert } from 'node:assert';

import { createRecordPreviewText } from '../js/editor/map-summary.js';
import { FieldRenderer } from '../js/editor/field-renderer.js';
import { TileMapModel } from '../js/editor/map-editor/model.js';
import { MapEditHistory } from '../js/editor/map-editor/history.js';

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.classList = {
      add: (...tokens) => this.addClass(tokens),
      remove: (...tokens) => this.removeClass(tokens),
      toggle: (token, force) => this.toggleClass(token, force)
    };
  }

  append(...children) {
    this.children.push(...children.filter((child) => child != null));
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  get text() {
    return [
      this.textContent,
      ...this.children.map((child) => typeof child === 'string' ? child : child.text)
    ].join('');
  }

  addClass(tokens) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    for (const token of tokens) classes.add(token);
    this.className = Array.from(classes).join(' ');
  }

  removeClass(tokens) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    for (const token of tokens) classes.delete(token);
    this.className = Array.from(classes).join(' ');
  }

  toggleClass(token, force) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    const shouldAdd = force ?? !classes.has(token);
    if (shouldAdd) classes.add(token);
    else classes.delete(token);
    this.className = Array.from(classes).join(' ');
    return shouldAdd;
  }
}

globalThis.document = {
  createElement: (tagName) => new TestElement(tagName)
};

globalThis.HTMLCanvasElement = class HTMLCanvasElement {};

const map = {
  width: 3,
  height: 2,
  tiles: [
    { x: 0, y: 0, terrain: 'plain', ownerId: '', resourceType: 'herb', buildings: ['hut'] },
    { x: 1, y: 0, terrain: 'plain', ownerId: 'sect_a', note: 'keep-me' },
    { x: 2, y: 0, terrain: 'water', ownerId: '' },
    { x: 0, y: 1, terrain: 'plain', ownerId: '' },
    { x: 1, y: 1, terrain: 'mountain', ownerId: 'sect_b', spirit: 7 },
    { x: 2, y: 1, terrain: 'plain', ownerId: '' }
  ]
};

const datasets = {
  terrains: [
    { type: 'plain', name: 'Plain', color: '#86a35d' },
    { type: 'forest', name: 'Forest', color: '#2f6f61' },
    { type: 'water', name: 'Water', color: '#2f5f8f' },
    { type: 'mountain', name: 'Mountain', color: '#8d8171' }
  ],
  factions: [
    { id: 'sect_a', name: 'Sect A' },
    { id: 'sect_b', name: 'Sect B' }
  ]
};

const model = new TileMapModel(map);
const history = new MapEditHistory();

const singleTile = model.getTile(1, 0);
const singleChanges = model.paintTile(1, 0, { terrain: 'forest' });
history.push(singleChanges);
assert.equal(model.getTile(1, 0), singleTile, '单格画笔应保留原 tile 对象引用。');
assert.equal(model.getTile(1, 0).terrain, 'forest', '单格画笔应修改目标地形。');
assert.equal(model.getTile(1, 0).note, 'keep-me', '单格画笔不应丢失 tile 既有字段。');

const rectChanges = model.paintRect({ x: 0, y: 0, width: 2, height: 2 }, { terrain: 'water' });
history.push(rectChanges);
assert.equal(rectChanges.length, 4, '矩形填充应覆盖矩形范围内全部格子。');
assert.equal(model.getTile(0, 0).terrain, 'water');
assert.equal(model.getTile(1, 1).terrain, 'water');
assert.deepEqual(model.getTile(0, 0).buildings, ['hut'], '矩形填充不应覆盖未指定字段。');

const ownerChanges = model.paintRect({ x: 0, y: 0, width: 3, height: 2 }, { ownerId: 'sect_b' });
history.push(ownerChanges);
assert.equal(ownerChanges.length, 5, '批量归属修改应跳过已经相同的格子。');
assert.ok(model.getTiles().every((tile) => tile.ownerId === 'sect_b'), '批量归属修改应更新所有格子。');

assert.equal(history.canUndo(), true);
history.undo(model);
assert.equal(model.getTile(0, 0).ownerId, '', '撤销应恢复批量归属修改前的 ownerId。');
history.undo(model);
assert.equal(model.getTile(1, 1).terrain, 'mountain', '撤销应恢复矩形填充前的地形。');
history.redo(model);
assert.equal(model.getTile(1, 1).terrain, 'water', '重做应重新应用矩形填充。');
assert.equal(model.getTile(1, 1).spirit, 7, '撤销/重做不应丢失额外字段。');

const previewText = createRecordPreviewText('map', map, datasets);
assert.ok(!previewText.includes('"tiles"'), '地图预览不应包含完整 tiles JSON。');

let changeCount = 0;
const renderer = new FieldRenderer(datasets);
const control = renderer.createControl({ path: 'tiles', type: 'tileSummary' }, map, () => {
  changeCount++;
});
assert.match(control.className, /map-editor|tile-summary/, 'tileSummary 应挂载专用地图编辑器或摘要回退。');
assert.ok(!control.text.includes('"tiles"'), 'tileSummary 控件不应渲染完整 tiles JSON。');
assert.ok(control.text.length < 5000, 'tileSummary 控件文本应保持轻量。');
assert.equal(changeCount, 0, '初始渲染不应触发 dirty 变更。');

const panelSource = await import('node:fs').then(({ readFileSync }) =>
  readFileSync(new URL('../js/editor/map-editor/panel.js', import.meta.url), 'utf-8')
);
for (const expectedText of ['地形画笔', '势力归属', '矩形填充', '撤销', '重做', '选中格详情', '统计摘要']) {
  assert.ok(panelSource.includes(expectedText), `地图编辑器应包含可识别中文文案：${expectedText}`);
}
assert.ok(!/[�锛鈥鐨鏁]/.test(panelSource), '地图编辑器源码不应包含常见乱码字符。');

console.log('editor map editor tests passed');
