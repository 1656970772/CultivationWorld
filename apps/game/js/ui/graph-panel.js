import { GraphBuilder, NODE_TYPES, EDGE_TYPES } from '../core/graph-builder.js';

const NODE_RADIUS = {
  [NODE_TYPES.FACTION]: 28,
  [NODE_TYPES.NPC]: 20,
  [NODE_TYPES.EVENT]: 22,
  [NODE_TYPES.RULE]: 18,
  [NODE_TYPES.MODIFIER]: 20
};

const NODE_LABELS_CN = {
  [NODE_TYPES.FACTION]: '势力',
  [NODE_TYPES.NPC]: 'NPC',
  [NODE_TYPES.EVENT]: '事件',
  [NODE_TYPES.RULE]: '规则',
  [NODE_TYPES.MODIFIER]: '世界状态'
};

export class GraphPanel {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.graphBuilder = new GraphBuilder();
    this.simulation = null;
    this.svg = null;
    this.g = null;
    this.configs = null;
    this.isVisible = false;
    this.isRealtime = false;
    this.selectedNodeId = null;
    this.showEdgeLabels = true;
    this.pinNodes = true;

    this.filters = {
      [NODE_TYPES.FACTION]: true,
      [NODE_TYPES.NPC]: true,
      [NODE_TYPES.EVENT]: true,
      [NODE_TYPES.RULE]: true,
      [NODE_TYPES.MODIFIER]: true
    };
  }

  init(configs) {
    this.configs = configs;
    this.graphBuilder.buildFromConfigs(configs);
    this._buildUI();
    this._bindKeyboard();
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
  }

  _buildUI() {
    this.container.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'graph-toolbar';

    const title = document.createElement('span');
    title.className = 'graph-title';
    title.textContent = '数据影响图谱';
    toolbar.appendChild(title);

    const filterGroup = document.createElement('div');
    filterGroup.className = 'graph-filter-group';

    for (const [type, label] of Object.entries(NODE_LABELS_CN)) {
      const checkbox = document.createElement('label');
      checkbox.className = 'graph-filter-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = this.filters[type];
      input.dataset.nodeType = type;
      input.addEventListener('change', () => {
        this.filters[type] = input.checked;
        this._updateGraph();
      });
      const swatch = document.createElement('span');
      swatch.className = 'graph-filter-swatch';
      swatch.style.background = this._getTypeColor(type);
      checkbox.appendChild(input);
      checkbox.appendChild(swatch);
      checkbox.appendChild(document.createTextNode(label));
      filterGroup.appendChild(checkbox);
    }
    toolbar.appendChild(filterGroup);

    const controls = document.createElement('div');
    controls.className = 'graph-controls';

    const toggleRealtime = document.createElement('label');
    toggleRealtime.className = 'graph-toggle';
    const rtInput = document.createElement('input');
    rtInput.type = 'checkbox';
    rtInput.checked = this.isRealtime;
    rtInput.addEventListener('change', () => {
      this.isRealtime = rtInput.checked;
      rtLabel.textContent = this.isRealtime ? '实时' : '静态';
    });
    const rtLabel = document.createElement('span');
    rtLabel.textContent = '静态';
    toggleRealtime.appendChild(rtInput);
    toggleRealtime.appendChild(rtLabel);
    controls.appendChild(toggleRealtime);

    const toggleLabels = document.createElement('label');
    toggleLabels.className = 'graph-toggle';
    const lblInput = document.createElement('input');
    lblInput.type = 'checkbox';
    lblInput.checked = this.showEdgeLabels;
    lblInput.addEventListener('change', () => {
      this.showEdgeLabels = lblInput.checked;
      if (this.g) {
        this.g.selectAll('.edge-label').style('display', this.showEdgeLabels ? 'block' : 'none');
      }
    });
    toggleLabels.appendChild(lblInput);
    toggleLabels.appendChild(document.createTextNode('边标签'));
    controls.appendChild(toggleLabels);

    const togglePin = document.createElement('label');
    togglePin.className = 'graph-toggle';
    const pinInput = document.createElement('input');
    pinInput.type = 'checkbox';
    pinInput.checked = this.pinNodes;
    pinInput.addEventListener('change', () => {
      this.pinNodes = pinInput.checked;
      if (!this.pinNodes) {
        this._releaseAllNodes();
      }
    });
    togglePin.appendChild(pinInput);
    togglePin.appendChild(document.createTextNode('锁定拖拽'));
    controls.appendChild(togglePin);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'graph-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.hide());
    controls.appendChild(closeBtn);

    toolbar.appendChild(controls);
    this.container.appendChild(toolbar);

    const graphArea = document.createElement('div');
    graphArea.className = 'graph-area';
    graphArea.id = 'graph-svg-area';
    this.container.appendChild(graphArea);

    const detailPanel = document.createElement('div');
    detailPanel.className = 'graph-detail-panel';
    detailPanel.id = 'graph-detail';
    detailPanel.innerHTML = '<div class="graph-detail-hint">点击节点查看影响链路</div>';
    this.container.appendChild(detailPanel);
  }

  _getTypeColor(type) {
    const colors = {
      [NODE_TYPES.FACTION]: '#2ecc71',
      [NODE_TYPES.NPC]: '#e67e22',
      [NODE_TYPES.EVENT]: '#e67e22',
      [NODE_TYPES.RULE]: '#95a5a6',
      [NODE_TYPES.MODIFIER]: '#1abc9c'
    };
    return colors[type] || '#888';
  }

  show() {
    this.isVisible = true;
    this.container.style.display = 'flex';
    this._renderGraph();
  }

  hide() {
    this.isVisible = false;
    this.container.style.display = 'none';
    if (this.simulation) {
      this.simulation.stop();
    }
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  updateWorldState(worldState) {
    if (!this.isRealtime || !this.isVisible) return;
    this.graphBuilder.updateFromWorldState(worldState);
    // 关系网边（ADR-027）：来自世界快照的运行时关系，刷新注入图。
    if (worldState && Array.isArray(worldState.relationships)) {
      this.graphBuilder.buildRelationshipEdges(worldState.relationships);
    }
    this._refreshRuntimeData();
  }

  _renderGraph() {
    const area = document.getElementById('graph-svg-area');
    if (!area) return;
    area.innerHTML = '';

    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }

    for (const node of this.graphBuilder.nodes) {
      delete node.x;
      delete node.y;
      delete node.vx;
      delete node.vy;
      delete node.fx;
      delete node.fy;
      delete node.index;
    }

    const width = area.clientWidth || 900;
    const height = area.clientHeight || 600;

    this.svg = d3.select(area)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    this.svg.append('defs').selectAll('marker')
      .data(['arrow-positive', 'arrow-negative', 'arrow-neutral'])
      .enter().append('marker')
      .attr('id', d => d)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', d => {
        if (d === 'arrow-positive') return '#2ecc71';
        if (d === 'arrow-negative') return '#e74c3c';
        return '#7f8c8d';
      });

    this.g = this.svg.append('g');

    const zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });
    this.svg.call(zoom);

    this._updateGraph();
  }

  _computeEdgeCurvatures(edges) {
    const pairCount = new Map();
    const pairIndex = new Map();
    for (const e of edges) {
      const key = [e.source, e.target].sort().join('||');
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
    for (const e of edges) {
      const key = [e.source, e.target].sort().join('||');
      const total = pairCount.get(key);
      const idx = pairIndex.get(key) || 0;
      pairIndex.set(key, idx + 1);
      if (total === 1) {
        e._curvature = 0;
      } else {
        const spread = 0.3;
        e._curvature = (idx - (total - 1) / 2) * spread;
      }
    }
  }

  _edgePath(d) {
    const sx = d.source.x, sy = d.source.y;
    const tx = d.target.x, ty = d.target.y;
    if (!d._curvature || d._curvature === 0) {
      return `M${sx},${sy}L${tx},${ty}`;
    }
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const mx = (sx + tx) / 2, my = (sy + ty) / 2;
    const nx = -dy / dist, ny = dx / dist;
    const offset = dist * d._curvature;
    const cx = mx + nx * offset, cy = my + ny * offset;
    return `M${sx},${sy}Q${cx},${cy},${tx},${ty}`;
  }

  _edgeLabelPos(d) {
    const sx = d.source.x, sy = d.source.y;
    const tx = d.target.x, ty = d.target.y;
    if (!d._curvature || d._curvature === 0) {
      return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
    }
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const mx = (sx + tx) / 2, my = (sy + ty) / 2;
    const nx = -dy / dist, ny = dx / dist;
    const offset = dist * d._curvature * 0.5;
    return { x: mx + nx * offset, y: my + ny * offset };
  }

  _updateGraph() {
    if (!this.g) return;

    const { nodes, edges } = this.graphBuilder.getVisibleData(this.filters);

    this.g.selectAll('*').remove();

    if (nodes.length === 0) return;

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const validEdges = edges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target));

    this._computeEdgeCurvatures(validEdges);

    const edgeGroup = this.g.append('g').attr('class', 'edges');
    const nodeGroup = this.g.append('g').attr('class', 'nodes');

    const linkElements = edgeGroup.selectAll('.edge')
      .data(validEdges, d => d.id)
      .enter().append('g')
      .attr('class', 'edge');

    linkElements.append('path')
      .attr('class', 'edge-line')
      .attr('fill', 'none')
      .attr('stroke', d => {
        if (d.influence === 'positive') return 'rgba(46,204,113,0.5)';
        if (d.influence === 'negative') return 'rgba(231,76,60,0.5)';
        return 'rgba(127,140,141,0.4)';
      })
      .attr('stroke-width', d => {
        if (d.edgeType === EDGE_TYPES.DIPLOMACY) return Math.max(1, Math.abs(d.value || 0) / 30);
        return 1.5;
      })
      .attr('stroke-dasharray', d => d.lineStyle === 'dashed' ? '5,3' : null)
      .attr('marker-end', d => `url(#arrow-${d.influence || 'neutral'})`);

    linkElements.append('text')
      .attr('class', 'edge-label')
      .attr('text-anchor', 'middle')
      .attr('dy', -4)
      .attr('font-size', 9)
      .attr('fill', d => {
        if (d.influence === 'positive') return '#2ecc71';
        if (d.influence === 'negative') return '#e74c3c';
        return '#7f8c8d';
      })
      .style('display', this.showEdgeLabels ? 'block' : 'none')
      .text(d => d.label || '');

    const nodeElements = nodeGroup.selectAll('.node')
      .data(nodes, d => d.id)
      .enter().append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (event, d) => this._dragStarted(event, d))
        .on('drag', (event, d) => this._dragged(event, d))
        .on('end', (event, d) => this._dragEnded(event, d))
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        this._onNodeClick(d);
      });

    nodeElements.each((d, i, elems) => {
      const el = d3.select(elems[i]);
      const r = NODE_RADIUS[d.type] || 18;

      switch (d.type) {
        case NODE_TYPES.FACTION:
          el.append('circle')
            .attr('r', r)
            .attr('fill', d.color)
            .attr('fill-opacity', 0.25)
            .attr('stroke', d.color)
            .attr('stroke-width', 2);
          break;
        case NODE_TYPES.NPC:
          el.append('circle')
            .attr('r', r)
            .attr('fill', d.color)
            .attr('fill-opacity', 0.15)
            .attr('stroke', d.color)
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '3,2');
          break;
        case NODE_TYPES.EVENT:
          this._drawHexagon(el, r, d.color);
          break;
        case NODE_TYPES.RULE:
          this._drawDiamond(el, r, d.color);
          break;
        case NODE_TYPES.MODIFIER:
          el.append('rect')
            .attr('x', -r)
            .attr('y', -r * 0.7)
            .attr('width', r * 2)
            .attr('height', r * 1.4)
            .attr('rx', 4)
            .attr('fill', d.color)
            .attr('fill-opacity', d.active ? 0.4 : 0.15)
            .attr('stroke', d.color)
            .attr('stroke-width', d.active ? 2.5 : 1.5);
          break;
        default:
          el.append('circle')
            .attr('r', r)
            .attr('fill', '#555')
            .attr('fill-opacity', 0.2)
            .attr('stroke', '#555')
            .attr('stroke-width', 1);
      }

      el.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', r + 14)
        .attr('font-size', 11)
        .attr('fill', '#c8d6e5')
        .attr('class', 'node-label')
        .text(d.label);
    });

    const area = document.getElementById('graph-svg-area');
    const width = area ? area.clientWidth : 900;
    const height = area ? area.clientHeight : 600;

    this.simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(validEdges).id(d => d.id).distance(d => {
        if (d.edgeType === EDGE_TYPES.LEADER_OF) return 80;
        if (d.edgeType === EDGE_TYPES.PERSONALITY_INFLUENCE) return 80;
        if (d.edgeType === EDGE_TYPES.DIPLOMACY) return 180;
        return 150;
      }))
      .force('charge', d3.forceManyBody().strength(d => {
        if (d.type === NODE_TYPES.FACTION) return -500;
        return -300;
      }))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(d => (NODE_RADIUS[d.type] || 18) + 20))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03));

    this.simulation.on('tick', () => {
      linkElements.select('.edge-line')
        .attr('d', d => this._edgePath(d));

      linkElements.select('.edge-label')
        .attr('x', d => this._edgeLabelPos(d).x)
        .attr('y', d => this._edgeLabelPos(d).y);

      nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    this.svg.on('click', () => {
      this.selectedNodeId = null;
      this._clearHighlight();
      this._showDefaultDetail();
    });
  }

  _drawHexagon(el, r, color) {
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      points.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
    }
    el.append('polygon')
      .attr('points', points.join(' '))
      .attr('fill', color)
      .attr('fill-opacity', 0.2)
      .attr('stroke', color)
      .attr('stroke-width', 1.5);
  }

  _drawDiamond(el, r, color) {
    const points = `0,${-r} ${r},0 0,${r} ${-r},0`;
    el.append('polygon')
      .attr('points', points)
      .attr('fill', color)
      .attr('fill-opacity', 0.2)
      .attr('stroke', color)
      .attr('stroke-width', 1.5);
  }

  _dragStarted(event, d) {
    if (!event.active) this.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  _dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  _dragEnded(event, d) {
    if (!event.active) this.simulation.alphaTarget(0);
    if (!this.pinNodes) {
      d.fx = null;
      d.fy = null;
    }
  }

  _releaseAllNodes() {
    if (!this.graphBuilder) return;
    for (const node of this.graphBuilder.nodes) {
      node.fx = null;
      node.fy = null;
    }
    if (this.simulation) {
      this.simulation.alpha(0.3).restart();
    }
  }

  _resolveEdgeId(ref) {
    if (ref === null || ref === undefined) return null;
    return typeof ref === 'object' ? ref.id : ref;
  }

  _onNodeClick(node) {
    this.selectedNodeId = node.id;
    this._applyHighlight(node.id);
    this._showNodeDetail(node);
  }

  _applyHighlight(selectedId) {
    const connectedNodes = new Set([selectedId]);
    const connectedEdgeIds = new Set();

    this.g.selectAll('.edge').each(d => {
      const src = this._resolveEdgeId(d.source);
      const tgt = this._resolveEdgeId(d.target);
      if (src === selectedId || tgt === selectedId) {
        connectedEdgeIds.add(d.id);
        connectedNodes.add(src);
        connectedNodes.add(tgt);
      }
    });

    this.g.selectAll('.node')
      .transition().duration(200)
      .style('opacity', d => connectedNodes.has(d.id) ? 1 : 0.25);

    this.g.selectAll('.edge').each((d, i, elems) => {
      const el = d3.select(elems[i]);
      const isConn = connectedEdgeIds.has(d.id);
      el.transition().duration(200)
        .style('opacity', isConn ? 1 : 0.15);
      el.select('.edge-line')
        .transition().duration(200)
        .attr('stroke-width', isConn
          ? (d.edgeType === EDGE_TYPES.DIPLOMACY ? Math.max(2, Math.abs(d.value || 0) / 20) : 3)
          : (d.edgeType === EDGE_TYPES.DIPLOMACY ? Math.max(1, Math.abs(d.value || 0) / 30) : 1.5));
    });
  }

  _clearHighlight() {
    this.g.selectAll('.node').transition().duration(200).style('opacity', 1);
    this.g.selectAll('.edge').transition().duration(200).style('opacity', 1);
    this.g.selectAll('.edge').each((d, i, elems) => {
      d3.select(elems[i]).select('.edge-line')
        .transition().duration(200)
        .attr('stroke-width', d.edgeType === EDGE_TYPES.DIPLOMACY ? Math.max(1, Math.abs(d.value || 0) / 30) : 1.5);
    });
  }

  _showNodeDetail(node) {
    const detail = document.getElementById('graph-detail');
    if (!detail) return;

    let html = `<div class="graph-detail-header" style="border-left-color:${node.color}">`;
    html += `<span class="graph-detail-type">${NODE_LABELS_CN[node.type] || node.type}</span>`;
    html += `<span class="graph-detail-name">${node.label}</span>`;
    html += `</div>`;

    if (node.type === NODE_TYPES.FACTION && node.runtimeData) {
      const rd = node.runtimeData;
      html += `<div class="graph-detail-section">`;
      html += `<div class="graph-detail-title">势力属性</div>`;
      html += `<div class="graph-detail-row">稳定度: <span class="${rd.stability < 30 ? 'val-danger' : 'val-safe'}">${rd.stability}</span></div>`;
      html += `<div class="graph-detail-row">弟子: ${rd.disciples ?? '-'}</div>`;
      html += `<div class="graph-detail-row">灵石: ${rd.spiritStone ?? '-'}</div>`;
      html += `<div class="graph-detail-row">粮草: ${rd.food ?? '-'}</div>`;
      if (rd.territoryCount !== undefined) {
        html += `<div class="graph-detail-row">领地: ${rd.territoryCount}格</div>`;
      }
      html += `</div>`;
    }

    if (node.type === NODE_TYPES.NPC && node.runtimeData) {
      const rd = node.runtimeData;
      html += `<div class="graph-detail-section">`;
      html += `<div class="graph-detail-title">NPC 属性</div>`;
      html += `<div class="graph-detail-row">存活: ${rd.alive ? '是' : '已陨落'}</div>`;
      if (rd.personality) {
        const p = rd.personality;
        html += `<div class="graph-detail-row">野心: <span class="${p.ambition > 60 ? 'val-danger' : ''}">${p.ambition}</span></div>`;
        html += `<div class="graph-detail-row">谨慎: ${p.caution}</div>`;
        html += `<div class="graph-detail-row">忠诚: <span class="${p.loyalty < 40 ? 'val-danger' : 'val-safe'}">${p.loyalty}</span></div>`;
        html += `<div class="graph-detail-row">外交: ${p.diplomacy}</div>`;
      }
      html += `</div>`;
    }

    if (node.type === NODE_TYPES.RULE) {
      html += `<div class="graph-detail-section">`;
      html += `<div class="graph-detail-title">规则信息</div>`;
      html += `<div class="graph-detail-row">${node.description || ''}</div>`;
      html += `<div class="graph-detail-row">触发概率: ${((node.probability || 0) * 100).toFixed(0)}%</div>`;
      html += `<div class="graph-detail-row">冷却: ${node.cooldown || 0}天</div>`;
      html += `</div>`;
    }

    if (node.type === NODE_TYPES.MODIFIER) {
      html += `<div class="graph-detail-section">`;
      html += `<div class="graph-detail-title">世界状态</div>`;
      html += `<div class="graph-detail-row">${node.description || ''}</div>`;
      html += `<div class="graph-detail-row">当前: ${node.active ? '<span class="val-active">激活中</span>' : '未激活'}</div>`;
      html += `</div>`;
    }

    if (node.type === NODE_TYPES.EVENT) {
      html += `<div class="graph-detail-section">`;
      html += `<div class="graph-detail-title">事件模板</div>`;
      html += `<div class="graph-detail-row">${node.description || ''}</div>`;
      html += `</div>`;
    }

    const resolveId = (ref) => ref === null || ref === undefined ? null : (typeof ref === 'object' ? ref.id : ref);
    const connEdges = this.graphBuilder.edges.filter(
      e => resolveId(e.source) === node.id || resolveId(e.target) === node.id
    );
    if (connEdges.length > 0) {
      html += `<div class="graph-detail-section">`;
      html += `<div class="graph-detail-title">影响链路 (${connEdges.length})</div>`;
      for (const edge of connEdges.slice(0, 15)) {
        const color = edge.influence === 'positive' ? '#2ecc71' :
                     edge.influence === 'negative' ? '#e74c3c' : '#7f8c8d';
        html += `<div class="graph-detail-edge" style="border-left-color:${color}">`;
        html += `<span class="graph-detail-edge-label">${edge.label || ''}</span>`;
        if (edge.description) {
          html += `<span class="graph-detail-edge-desc">${edge.description}</span>`;
        }
        if (edge.runtimeValue !== undefined) {
          html += `<span class="graph-detail-edge-val">当前值: ${edge.runtimeValue}</span>`;
        }
        html += `</div>`;
      }
      if (connEdges.length > 15) {
        html += `<div class="graph-detail-more">...还有 ${connEdges.length - 15} 条链路</div>`;
      }
      html += `</div>`;
    }

    detail.innerHTML = html;
  }

  _showDefaultDetail() {
    const detail = document.getElementById('graph-detail');
    if (!detail) return;
    detail.innerHTML = '<div class="graph-detail-hint">点击节点查看影响链路</div>';
  }

  _refreshRuntimeData() {
    if (!this.g) return;

    this.g.selectAll('.node').each((d, i, elems) => {
      const el = d3.select(elems[i]);
      if (d.type === NODE_TYPES.MODIFIER) {
        el.select('rect')
          .attr('fill-opacity', d.active ? 0.4 : 0.15)
          .attr('stroke-width', d.active ? 2.5 : 1.5);
      }
    });

    this.g.selectAll('.edge').each((d, i, elems) => {
      if (d.edgeType === EDGE_TYPES.DIPLOMACY && d.runtimeValue !== undefined) {
        const el = d3.select(elems[i]);
        const val = d.runtimeValue;
        el.select('.edge-line')
          .attr('stroke', val > 0 ? 'rgba(46,204,113,0.5)' : 'rgba(231,76,60,0.5)')
          .attr('stroke-width', Math.max(1, Math.abs(val) / 30));
        el.select('.edge-label')
          .text(`${val > 0 ? '+' : ''}${val}`);
      }
    });

    if (this.selectedNodeId) {
      const node = this.graphBuilder.nodes.find(n => n.id === this.selectedNodeId);
      if (node) this._showNodeDetail(node);
    }
  }
}
