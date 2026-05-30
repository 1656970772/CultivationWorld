import { eventBus } from '../core/event-bus.js';
import { EVENTS } from '../core/constants.js';

export class StatusBar {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.setupListeners();
  }

  setupListeners() {
    eventBus.subscribe(EVENTS.WORLD_TICK_COMPLETE, (data) => this.update(data));
    eventBus.subscribe(EVENTS.PLAYER_MOVED, (data) => this.updatePosition(data));
  }

  update(gameState) {
    const { playerState, activeModifiers } = gameState;
    this.render(playerState, activeModifiers || []);
  }

  updatePosition(playerState) {
    const posEl = this.container.querySelector('[data-field="position"]');
    if (posEl) {
      posEl.textContent = `(${playerState.x}, ${playerState.y})`;
    }
  }

  render(playerState, activeModifiers) {
    const day = playerState.day ?? 1;
    const ap = playerState.actionPoints ?? 0;
    const maxAp = playerState.maxActionPoints ?? 5;
    const x = playerState.x ?? 0;
    const y = playerState.y ?? 0;

    let html = `
      <span class="status-item">
        <span class="status-label">日</span>
        <span class="status-value">${day}</span>
      </span>
      <span class="status-item">
        <span class="status-label">行动点</span>
        <span class="status-value">${ap}/${maxAp}</span>
      </span>
      <span class="status-item">
        <span class="status-label">坐标</span>
        <span class="status-value" data-field="position">(${x}, ${y})</span>
      </span>
    `;

    if (activeModifiers.length > 0) {
      const tags = activeModifiers.map(m => `<span class="modifier-tag">${m.name || m.type}</span>`).join('');
      html += `<span class="status-item">${tags}</span>`;
    }

    this.container.innerHTML = html;
  }
}
