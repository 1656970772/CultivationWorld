const TERRAIN_ITEMS = [
  { type: 'plain', name: '平原', color: '#A0C468', icon: 'plain' },
  { type: 'mountain', name: '山脉', color: '#9A8462', icon: 'mountain' },
  { type: 'forest', name: '森林', color: '#367030', icon: 'forest' },
  { type: 'river', name: '河流', color: '#5A9DE5', icon: 'river' },
  { type: 'swamp', name: '沼泽', color: '#6B7A48', icon: 'swamp' },
  { type: 'desert', name: '沙漠', color: '#D4B85A', icon: 'desert' },
  { type: 'low_spirit_vein',  name: '低级矿脉', color: '#B89FD4', icon: 'spirit_vein' },
  { type: 'mid_spirit_vein',  name: '中级矿脉', color: '#A45EC0', icon: 'spirit_vein' },
  { type: 'high_spirit_vein', name: '高级矿脉', color: '#7B2FA0', icon: 'spirit_vein' },
  { type: 'top_spirit_vein',  name: '极品矿脉', color: '#5A107A', icon: 'spirit_vein' },
];

const FACTION_ITEMS = [
  { id: 'sect_001', name: '青云宗', color: '#5DADE2', badge: '☁' },
  { id: 'sect_002', name: '天剑宗', color: '#BDC3C7', badge: '⚔' },
  { id: 'sect_003', name: '玄真观', color: '#F4D03F', badge: '☯' },
  { id: 'sect_004', name: '血煞门', color: '#E74C3C', badge: '☠' },
  { id: 'sect_005', name: '幽冥教', color: '#8E44AD', badge: '👁' },
  { id: 'sect_006', name: '毒蝎帮', color: '#27AE60', badge: '☣' },
  { id: 'sect_007', name: '药王谷', color: '#2ECC71', badge: '⚕' },
  { id: 'sect_008', name: '天机阁', color: '#3498DB', badge: '⚙' },
  { id: 'sect_009', name: '万妖山', color: '#E67E22', badge: '🐾' },
  { id: 'sect_010', name: '蛮蛟族', color: '#795548', badge: '🐉' },
];

function _drawVeinIcon(ctx, cx, cy, color) {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
  grad.addColorStop(0, color);
  grad.addColorStop(0.6, color.replace('1)', '0.4)').replace(')', ', 0.4)'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();
  for (let a = 0; a < 6; a++) {
    const angle = (a / 6) * Math.PI * 2;
    const dx = Math.cos(angle) * 5;
    const dy = Math.sin(angle) * 5;
    ctx.fillStyle = 'rgba(220,200,255,0.5)';
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrainIcon(canvas, type, bgColor) {
  const s = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, s, s);

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(0, 0, s, s, 3);
  ctx.fill();

  const cx = s / 2;
  const cy = s / 2;

  switch (type) {
    case 'plain': {
      ctx.strokeStyle = '#d4f0a0';
      ctx.lineWidth = 1.2;
      const blades = [[cx - 4, cy + 4], [cx, cy + 3], [cx + 4, cy + 4]];
      for (const [bx, by] of blades) {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx, by - 3);
        ctx.lineTo(bx - 1.5, by - 1.5);
        ctx.stroke();
      }
      ctx.fillStyle = '#6b9030';
      ctx.fillRect(0, cy + 5, s, 2);
      break;
    }
    case 'mountain': {
      ctx.fillStyle = '#706050';
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy + 5);
      ctx.lineTo(cx - 1, cy - 5);
      ctx.lineTo(cx + 5, cy + 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#504030';
      ctx.beginPath();
      ctx.moveTo(cx + 1, cy + 5);
      ctx.lineTo(cx + 7, cy - 3);
      ctx.lineTo(cx + 11, cy + 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8e4dc';
      ctx.beginPath();
      ctx.moveTo(cx - 1, cy - 5);
      ctx.lineTo(cx - 3, cy - 2);
      ctx.lineTo(cx + 1, cy - 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'forest': {
      const trees = [
        [cx - 4, cy + 1, 4.5],
        [cx + 3, cy + 2, 3.5],
        [cx, cy - 1, 5],
      ];
      for (const [tx, ty, r] of trees) {
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(tx - 0.7, ty + 1, 1.4, 4);
        ctx.beginPath();
        ctx.arc(tx, ty, r, 0, Math.PI * 2);
        ctx.fillStyle = '#1a6b1a';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tx - 1, ty - 1, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#2a8a2a';
        ctx.fill();
      }
      break;
    }
    case 'river': {
      ctx.strokeStyle = '#a0d4ff';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 5);
      ctx.quadraticCurveTo(cx - 2, cy - 2, cx + 1, cy);
      ctx.quadraticCurveTo(cx + 4, cy + 2, cx + 6, cy + 5);
      ctx.stroke();
      ctx.strokeStyle = '#c0e8ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 3);
      ctx.quadraticCurveTo(cx, cy, cx + 4, cy + 3);
      ctx.stroke();
      break;
    }
    case 'swamp': {
      ctx.fillStyle = '#8a9a5e';
      ctx.fillRect(1, cy + 3, s - 2, 3);
      ctx.fillStyle = '#556b2f';
      for (const dx of [-4, 0, 5]) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy + 3, 2.5, Math.PI, 0);
        ctx.fill();
      }
      ctx.strokeStyle = '#7a8a50';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy - 3);
      ctx.lineTo(cx - 2, cy + 2);
      ctx.stroke();
      ctx.fillStyle = '#3a5a20';
      ctx.beginPath();
      ctx.ellipse(cx - 2, cy - 4, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 3, cy - 1);
      ctx.lineTo(cx + 3, cy + 2);
      ctx.stroke();
      ctx.fillStyle = '#3a5a20';
      ctx.beginPath();
      ctx.ellipse(cx + 3, cy - 2, 2.5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'desert': {
      ctx.fillStyle = '#e8c860';
      ctx.beginPath();
      ctx.moveTo(0, cy + 4);
      ctx.quadraticCurveTo(cx - 3, cy - 2, cx + 2, cy + 1);
      ctx.quadraticCurveTo(cx + 7, cy + 4, s, cy + 2);
      ctx.lineTo(s, cy + 6);
      ctx.lineTo(0, cy + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c4a040';
      ctx.beginPath();
      ctx.moveTo(0, cy + 6);
      ctx.quadraticCurveTo(cx, cy + 2, s, cy + 5);
      ctx.lineTo(s, cy + 8);
      ctx.lineTo(0, cy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffd040';
      ctx.beginPath();
      ctx.arc(s - 4, 4, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'spirit_vein': {
      _drawVeinIcon(ctx, cx, cy, bgColor);
      break;
    }
  }
}

export class MapLegend {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.terrainExpanded = true;
    this.factionExpanded = false;
    this._render();
  }

  _render() {
    this.container.innerHTML = '';

    const terrainSection = this._createTerrainSection(this.terrainExpanded, (expanded) => {
      this.terrainExpanded = expanded;
    });
    this.container.appendChild(terrainSection);

    const factionSection = this._createFactionSection(this.factionExpanded, (expanded) => {
      this.factionExpanded = expanded;
    });
    this.container.appendChild(factionSection);
  }

  _createTerrainSection(expanded, onToggle) {
    const section = document.createElement('div');
    section.className = 'legend-section';

    const header = document.createElement('div');
    header.className = 'legend-header';
    header.innerHTML = `<span class="legend-arrow">${expanded ? '▾' : '▸'}</span><span>地形</span>`;
    header.addEventListener('click', () => {
      onToggle(!expanded);
      this._render();
    });
    section.appendChild(header);

    if (expanded) {
      const grid = document.createElement('div');
      grid.className = 'legend-grid';
      for (const item of TERRAIN_ITEMS) {
        const entry = document.createElement('div');
        entry.className = 'legend-item';

        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 20;
        iconCanvas.height = 20;
        iconCanvas.className = 'legend-icon-canvas';
        drawTerrainIcon(iconCanvas, item.icon, item.color);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'legend-name';
        nameSpan.textContent = item.name;

        entry.appendChild(iconCanvas);
        entry.appendChild(nameSpan);
        grid.appendChild(entry);
      }
      section.appendChild(grid);
    }

    return section;
  }

  _createFactionSection(expanded, onToggle) {
    const section = document.createElement('div');
    section.className = 'legend-section';

    const header = document.createElement('div');
    header.className = 'legend-header';
    header.innerHTML = `<span class="legend-arrow">${expanded ? '▾' : '▸'}</span><span>势力</span>`;
    header.addEventListener('click', () => {
      onToggle(!expanded);
      this._render();
    });
    section.appendChild(header);

    if (expanded) {
      const grid = document.createElement('div');
      grid.className = 'legend-grid';
      for (const item of FACTION_ITEMS) {
        const entry = document.createElement('div');
        entry.className = 'legend-item';

        const badge = document.createElement('span');
        badge.className = 'legend-faction-badge';
        badge.style.borderColor = item.color;
        badge.style.color = item.color;
        badge.textContent = item.badge;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'legend-name';
        nameSpan.textContent = item.name;

        entry.appendChild(badge);
        entry.appendChild(nameSpan);
        grid.appendChild(entry);
      }
      section.appendChild(grid);
    }

    return section;
  }
}
