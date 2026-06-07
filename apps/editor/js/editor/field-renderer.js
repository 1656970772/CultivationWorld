import { getReferenceOptions, getValueAtPath, setValueAtPath } from './validation.js';
import { createMapSummary } from './map-summary.js';
import { createMapEditorPanel } from './map-editor/panel.js';

export class FieldRenderer {
  constructor(datasets) {
    this.datasets = datasets;
  }

  updateDatasets(datasets) {
    this.datasets = datasets;
  }

  renderField(field, item, onChange) {
    const wrapper = createElement('section', 'field-row');
    const header = createElement('div', 'field-header');
    const label = createElement('label', 'field-label', field.label);
    const path = createElement('code', 'field-path', field.path);
    header.append(label, path);

    const help = createElement('p', 'field-help', field.help || '');
    const control = createElement('div', 'field-control');
    control.append(this.createControl(field, item, onChange));

    wrapper.append(header, control, help);
    return wrapper;
  }

  createControl(field, item, onChange) {
    switch (field.type) {
      case 'textarea':
        return this.createTextarea(field, item, onChange);
      case 'number':
        return this.createNumber(field, item, onChange);
      case 'range':
        return this.createRange(field, item, onChange);
      case 'boolean':
        return this.createBoolean(field, item, onChange);
      case 'select':
        return this.createSelect(field, item, onChange);
      case 'reference':
        return this.createReference(field, item, onChange);
      case 'color':
        return this.createColor(field, item, onChange);
      case 'tags':
        return this.createTags(field, item, onChange);
      case 'relations':
        return this.createRelations(field, item, onChange);
      case 'keyValueNumber':
        return this.createKeyValueNumber(field, item, onChange);
      case 'json':
        return this.createJson(field, item, onChange);
      case 'options':
        return this.createOptions(field, item, onChange);
      case 'tileSummary':
        return this.createTileSummary(field, item, onChange);
      case 'object':
        return this.createObject(field, item, onChange);
      case 'objectArray':
        return this.createObjectArray(field, item, onChange);
      default:
        return this.createText(field, item, onChange);
    }
  }

  createText(field, item, onChange) {
    const input = createElement('input', 'input');
    input.type = 'text';
    input.value = getValueAtPath(item, field.path) ?? '';
    input.addEventListener('input', () => {
      setValueAtPath(item, field.path, input.value);
      onChange();
    });
    return input;
  }

  createTextarea(field, item, onChange) {
    const textarea = createElement('textarea', 'textarea');
    textarea.rows = 3;
    textarea.value = getValueAtPath(item, field.path) ?? '';
    textarea.addEventListener('input', () => {
      setValueAtPath(item, field.path, textarea.value);
      onChange();
    });
    return textarea;
  }

  createNumber(field, item, onChange) {
    const input = createElement('input', 'input');
    input.type = 'number';
    if (field.min != null) input.min = field.min;
    if (field.max != null) input.max = field.max;
    if (field.step != null) input.step = field.step;
    input.value = getValueAtPath(item, field.path) ?? '';
    input.addEventListener('input', () => {
      if (input.value === '' && field.optional) {
        deleteValueAtPath(item, field.path);
        onChange();
        return;
      }
      setValueAtPath(item, field.path, Number(input.value));
      onChange();
    });
    return input;
  }

  createRange(field, item, onChange) {
    const group = createElement('div', 'range-group');
    const slider = createElement('input', 'range');
    const number = createElement('input', 'range-number');
    const value = getValueAtPath(item, field.path) ?? field.min ?? 0;

    slider.type = 'range';
    slider.min = field.min ?? 0;
    slider.max = field.max ?? 100;
    slider.step = field.step ?? 1;
    slider.value = value;

    number.type = 'number';
    number.min = slider.min;
    number.max = slider.max;
    number.step = slider.step;
    number.value = value;

    const sync = (nextValue) => {
      const numericValue = Number(nextValue);
      slider.value = numericValue;
      number.value = numericValue;
      setValueAtPath(item, field.path, numericValue);
      onChange();
    };

    slider.addEventListener('input', () => sync(slider.value));
    number.addEventListener('input', () => sync(number.value));
    group.append(slider, number);
    return group;
  }

  createBoolean(field, item, onChange) {
    const label = createElement('label', 'toggle');
    const input = createElement('input');
    const switchEl = createElement('span', 'toggle-track');
    const text = createElement('span', 'toggle-text');

    input.type = 'checkbox';
    input.checked = Boolean(getValueAtPath(item, field.path));
    text.textContent = input.checked ? '开启' : '关闭';
    input.addEventListener('change', () => {
      setValueAtPath(item, field.path, input.checked);
      text.textContent = input.checked ? '开启' : '关闭';
      onChange();
    });

    label.append(input, switchEl, text);
    return label;
  }

  createSelect(field, item, onChange) {
    return this.createSelectFromOptions(field, field.options || [], item, onChange);
  }

  createReference(field, item, onChange) {
    const options = getReferenceOptions(this.datasets, field.target, field.targetKey);
    return this.createSelectFromOptions(field, options, item, onChange, true);
  }

  createSelectFromOptions(field, options, item, onChange, allowEmpty = false) {
    const select = createElement('select', 'select');
    const currentValue = getValueAtPath(item, field.path) ?? '';

    if (allowEmpty) {
      const emptyOption = createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '未选择';
      select.append(emptyOption);
    }

    for (const option of options) {
      const optionEl = createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      select.append(optionEl);
    }

    select.value = currentValue;
    select.addEventListener('change', () => {
      setValueAtPath(item, field.path, select.value);
      onChange();
    });
    return select;
  }

  createColor(field, item, onChange) {
    const group = createElement('div', 'color-group');
    const swatch = createElement('input', 'color-input');
    const text = createElement('input', 'input color-text');
    const value = getValueAtPath(item, field.path) || '#ffffff';

    swatch.type = 'color';
    swatch.value = value;
    text.type = 'text';
    text.value = value;

    const sync = (nextValue) => {
      swatch.value = normalizeColor(nextValue, swatch.value);
      text.value = nextValue;
      setValueAtPath(item, field.path, nextValue);
      onChange();
    };

    swatch.addEventListener('input', () => sync(swatch.value));
    text.addEventListener('input', () => sync(text.value));
    group.append(swatch, text);
    return group;
  }

  createTags(field, item, onChange) {
    const group = createElement('div', 'tag-group');
    const value = new Set(getValueAtPath(item, field.path) || []);

    for (const option of field.options || []) {
      const chip = createElement('button', value.has(option.value) ? 'tag active' : 'tag', option.label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        if (value.has(option.value)) value.delete(option.value);
        else value.add(option.value);
        setValueAtPath(item, field.path, Array.from(value));
        onChange({ rerender: true });
      });
      group.append(chip);
    }

    return group;
  }

  createRelations(field, item, onChange) {
    const relations = getValueAtPath(item, field.path) || {};
    const options = getReferenceOptions(this.datasets, field.target);
    const container = createElement('div', 'relations-grid');

    for (const option of options) {
      if (option.value === item.id) continue;
      const row = createElement('label', 'relation-row');
      const name = createElement('span', 'relation-name', option.label);
      const input = createElement('input', 'relation-input');
      input.type = 'number';
      input.min = field.min ?? -100;
      input.max = field.max ?? 100;
      input.step = 1;
      input.value = relations[option.value] ?? 0;
      input.addEventListener('input', () => {
        relations[option.value] = Number(input.value);
        setValueAtPath(item, field.path, relations);
        onChange();
      });
      row.append(name, input);
      container.append(row);
    }

    return container;
  }

  createKeyValueNumber(field, item, onChange) {
    const objectValue = getValueAtPath(item, field.path) || {};
    const container = createElement('div', 'kv-editor');

    const renderRows = () => {
      container.replaceChildren();
      for (const [key, value] of Object.entries(objectValue)) {
        const row = createElement('div', 'kv-row');
        const keyInput = createElement('input', 'input kv-key');
        const valueInput = createElement('input', 'input kv-value');
        const remove = createElement('button', 'icon-btn danger', '删');

        keyInput.value = key;
        valueInput.type = 'number';
        valueInput.step = 0.01;
        valueInput.value = value;

        keyInput.addEventListener('change', () => {
          const nextKey = keyInput.value.trim();
          if (!nextKey || nextKey === key) return;
          objectValue[nextKey] = objectValue[key];
          delete objectValue[key];
          setValueAtPath(item, field.path, objectValue);
          onChange({ rerender: true });
        });
        valueInput.addEventListener('input', () => {
          objectValue[key] = Number(valueInput.value);
          setValueAtPath(item, field.path, objectValue);
          onChange();
        });
        remove.type = 'button';
        remove.addEventListener('click', () => {
          delete objectValue[key];
          setValueAtPath(item, field.path, objectValue);
          onChange({ rerender: true });
        });

        row.append(keyInput, valueInput, remove);
        container.append(row);
      }

      const add = createElement('button', 'secondary-btn compact', '添加参数');
      add.type = 'button';
      add.addEventListener('click', () => {
        let index = 1;
        let key = `effect_${index}`;
        while (objectValue[key] != null) {
          index++;
          key = `effect_${index}`;
        }
        objectValue[key] = 0;
        setValueAtPath(item, field.path, objectValue);
        onChange({ rerender: true });
      });
      container.append(add);
    };

    renderRows();
    return container;
  }

  createJson(field, item, onChange) {
    const textarea = createElement('textarea', 'textarea code-editor');
    const value = getValueAtPath(item, field.path);
    textarea.rows = field.path === 'tiles' ? 12 : 7;
    textarea.spellcheck = false;
    textarea.value = JSON.stringify(value ?? {}, null, 2);

    textarea.addEventListener('input', () => {
      try {
        const parsed = JSON.parse(textarea.value || 'null');
        textarea.classList.remove('invalid');
        setValueAtPath(item, field.path, parsed);
        onChange();
      } catch (error) {
        textarea.classList.add('invalid');
      }
    });

    return textarea;
  }

  createOptions(field, item, onChange) {
    const options = getValueAtPath(item, field.path) || [];
    const container = createElement('div', 'options-editor');

    const renderRows = () => {
      container.replaceChildren();
      options.forEach((option, index) => {
        const row = createElement('div', 'option-row');
        const id = createElement('input', 'input');
        const text = createElement('input', 'input option-text');
        const cost = createElement('input', 'input option-cost-input');
        const effect = createElement('input', 'input');
        const remove = createElement('button', 'icon-btn danger', '删');

        id.placeholder = 'id';
        text.placeholder = '选项文本';
        cost.placeholder = '消耗';
        effect.placeholder = 'effect';

        id.value = option.id || '';
        text.value = option.text || '';
        cost.type = 'number';
        cost.min = 0;
        cost.step = 1;
        cost.value = option.cost ?? 0;
        effect.value = option.effect || '';

        id.addEventListener('input', () => { option.id = id.value; onChange(); });
        text.addEventListener('input', () => { option.text = text.value; onChange(); });
        cost.addEventListener('input', () => { option.cost = Number(cost.value); onChange(); });
        effect.addEventListener('input', () => { option.effect = effect.value; onChange(); });
        remove.type = 'button';
        remove.addEventListener('click', () => {
          options.splice(index, 1);
          setValueAtPath(item, field.path, options);
          onChange({ rerender: true });
        });

        row.append(id, text, cost, effect, remove);
        container.append(row);
      });

      const add = createElement('button', 'secondary-btn compact', '添加选项');
      add.type = 'button';
      add.addEventListener('click', () => {
        options.push({ id: 'new_option', text: '新选项', cost: 0, effect: 'none' });
        setValueAtPath(item, field.path, options);
        onChange({ rerender: true });
      });
      container.append(add);
    };

    renderRows();
    return container;
  }

  /**
   * 嵌套对象（ADR-031 schema-inferrer 推断 type=object）。
   * 渲染为可折叠面板 + 递归 createControl。
   * @param {{path:string,label:string,fields:Array}} field
   * @param {Object} item 父对象（item[field.path] 是当前对象）
   * @param {Function} onChange
   */
  createObject(field, item, onChange) {
    const container = createElement('div', 'object-editor');
    const value = getValueAtPath(item, field.path) || {};
    // 写入 item：如果还没有，初始化为空对象
    if (typeof value !== 'object' || Array.isArray(value)) {
      setValueAtPath(item, field.path, {});
    }

    const header = createElement('div', 'object-header');
    const toggle = createElement('button', 'object-toggle', '▾');
    toggle.type = 'button';
    const title = createElement('span', 'object-title', field.label);
    header.append(toggle, title);

    const body = createElement('div', 'object-body');
    const fields = field.fields || [];
    for (const sub of fields) {
      body.append(this.renderField(sub, item, onChange));
    }
    if (fields.length === 0) {
      body.append(createElement('p', 'object-empty', '（无子字段）'));
    }

    toggle.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▾' : '▸';
    });

    container.append(header, body);
    return container;
  }

  /**
   * 对象数组（ADR-031 schema-inferrer 推断 type=objectArray）。
   * 渲染为表格行，每行是对象的一个实例。
   * @param {{path:string,label:string,itemFields:Array}} field
   * @param {Object} item 父对象（item[field.path] 是数组）
   * @param {Function} onChange
   */
  createObjectArray(field, item, onChange) {
    const arr = getValueAtPath(item, field.path) || [];
    if (!Array.isArray(arr)) {
      setValueAtPath(item, field.path, []);
    }
    const container = createElement('div', 'object-array-editor');

    const renderRows = () => {
      container.replaceChildren();
      const itemFields = field.itemFields || [];
      arr.forEach((row, index) => {
        const wrap = createElement('div', 'object-array-row');
        const head = createElement('div', 'object-array-row-head');
        const title = createElement('span', 'object-array-row-title', `#${index + 1}`);
        const moveUp = createElement('button', 'icon-btn', '↑');
        const moveDown = createElement('button', 'icon-btn', '↓');
        const remove = createElement('button', 'icon-btn danger', '删');
        head.append(title, moveUp, moveDown, remove);

        const body = createElement('div', 'object-array-row-body');
        for (const sub of itemFields) {
          body.append(this.renderField(sub, row, onChange));
        }
        if (itemFields.length === 0) {
          // 没有推断字段（样本太小），用 JSON 编辑
          const json = createElement('textarea', 'textarea code-editor');
          json.rows = 4;
          json.spellcheck = false;
          json.value = JSON.stringify(row, null, 2);
          json.addEventListener('input', () => {
            try {
              const parsed = JSON.parse(json.value || 'null');
              arr[index] = parsed;
              setValueAtPath(item, field.path, arr);
              json.classList.remove('invalid');
              onChange();
            } catch { json.classList.add('invalid'); }
          });
          body.append(json);
        }

        moveUp.type = 'button';
        moveDown.type = 'button';
        remove.type = 'button';
        moveUp.addEventListener('click', () => {
          if (index === 0) return;
          [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
          setValueAtPath(item, field.path, arr);
          onChange({ rerender: true });
        });
        moveDown.addEventListener('click', () => {
          if (index === arr.length - 1) return;
          [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
          setValueAtPath(item, field.path, arr);
          onChange({ rerender: true });
        });
        remove.addEventListener('click', () => {
          arr.splice(index, 1);
          setValueAtPath(item, field.path, arr);
          onChange({ rerender: true });
        });

        wrap.append(head, body);
        container.append(wrap);
      });

      const add = createElement('button', 'secondary-btn compact', '添加一项');
      add.type = 'button';
      add.addEventListener('click', () => {
        // 复制第一行作为模板，否则空对象
        let next;
        if (arr.length > 0) {
          next = JSON.parse(JSON.stringify(arr[0]));
          // 去掉 id/unique 字段以避免冲突
          if ('id' in next) delete next.id;
        } else {
          next = {};
          // 按 itemFields 给个空模板
          for (const sub of (field.itemFields || [])) {
            if (sub.type === 'number' || sub.type === 'range') next[sub.path] = 0;
            else if (sub.type === 'boolean') next[sub.path] = false;
            else if (sub.type === 'text' || sub.type === 'textarea') next[sub.path] = '';
            else if (sub.type === 'tags') next[sub.path] = [];
            else if (sub.type === 'object') next[sub.path] = {};
            else if (sub.type === 'objectArray') next[sub.path] = [];
            else next[sub.path] = null;
          }
        }
        arr.push(next);
        setValueAtPath(item, field.path, arr);
        onChange({ rerender: true });
      });
      container.append(add);
    };

    renderRows();
    return container;
  }

  createTileSummary(field, item, onChange) {
    const map = { ...item, tiles: getValueAtPath(item, field.path) || [] };
    return createMapEditorPanel({
      map,
      datasets: this.datasets,
      adapter: field.adapterConfig || null,
      onChange,
      fallback: () => this.createTileSummaryFallback(field, item)
    });
  }

  createTileSummaryFallback(field, item) {
    const map = { ...item, tiles: getValueAtPath(item, field.path) || [] };
    const summary = createMapSummary(map, this.datasets, field.adapterConfig || null);
    const container = createElement('div', 'tile-summary');

    const stats = [
      ['地图尺寸', `${summary.width} × ${summary.height}`],
      ['格子总数', `${summary.tileCount} / ${summary.expectedTileCount}`],
      ['资源格', String(summary.resourceTileCount)],
      ['建筑格', String(summary.buildingTileCount)]
    ];

    const statGrid = createElement('div', 'tile-summary-stats');
    for (const [label, value] of stats) {
      const stat = createElement('div', 'tile-stat');
      stat.append(createElement('span', 'tile-stat-label', label), createElement('strong', '', value));
      statGrid.append(stat);
    }

    const terrainLabels = Object.fromEntries((this.datasets.terrains || []).map((terrain) => [terrain.type, terrain.name]));
    const ownerLabels = {
      unowned: '无主之地',
      ...Object.fromEntries((this.datasets.factions || []).map((faction) => [faction.id, faction.name]))
    };
    const terrainList = createSummaryList('地形分布', summary.terrainCounts, Infinity, terrainLabels);
    const ownerList = createSummaryList('领地分布', summary.ownerCounts, 12, ownerLabels);
    const note = createElement(
      'p',
      'tile-summary-note',
      '当前版本不在表单中直接编辑 10000 格原始 JSON。要批量改地形和领地，建议后续做专门的地图画笔工具。'
    );

    container.append(statGrid, terrainList, ownerList, note);
    return container;
  }
}

export function createElement(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function createSummaryList(title, values, limit = Infinity, labels = {}) {
  const section = createElement('div', 'tile-summary-section');
  section.append(createElement('h4', '', title));

  const list = createElement('div', 'tile-summary-list');
  const entries = Object.entries(values || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  for (const [label, value] of entries) {
    const row = createElement('div', 'tile-summary-row');
    row.append(createElement('span', '', labels[label] || label), createElement('strong', '', String(value)));
    list.append(row);
  }

  section.append(list);
  return section;
}

function deleteValueAtPath(target, path) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor = cursor?.[parts[i]];
    if (cursor == null) return;
  }
  delete cursor[parts[parts.length - 1]];
}
