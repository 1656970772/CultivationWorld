import { eventBus } from '../core/event-bus.js';
import { EVENTS } from '../core/constants.js';

export class EventDialog {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentEvent = null;
    this.onChoice = null;

    this.setupListeners();
  }

  setupListeners() {
    eventBus.subscribe(EVENTS.EVENT_TRIGGERED, (data) => this.show(data));
  }

  show(eventData) {
    this.currentEvent = eventData;
    this.container.style.display = 'block';

    let html = `<h3 style="color:#e94560;margin-bottom:12px;">${eventData.name || '事件'}</h3>`;
    html += `<p style="margin-bottom:16px;line-height:1.8;">${eventData.description || ''}</p>`;
    html += `<div class="event-options">`;

    const options = eventData.playerOptions || eventData.player_options || [];
    for (const option of options) {
      const costText = option.cost > 0 ? `（消耗 ${option.cost} 行动点）` : '（不消耗行动点）';
      html += `<button class="event-option-btn" data-option-id="${option.id}" data-cost="${option.cost || 0}">
        ${option.text} <span class="option-cost">${costText}</span>
      </button>`;
    }

    html += `</div>`;
    this.container.innerHTML = html;

    this.container.querySelectorAll('.event-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const optionId = btn.dataset.optionId;
        const cost = parseInt(btn.dataset.cost) || 0;
        this.handleChoice(optionId, cost);
      });
    });
  }

  handleChoice(optionId, cost) {
    eventBus.publish(EVENTS.EVENT_CHOICE_MADE, {
      event: this.currentEvent,
      choiceId: optionId,
      cost
    });
    this.hide();
  }

  hide() {
    this.container.style.display = 'none';
    this.currentEvent = null;
  }
}
