export class DebugPanel {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.isVisible = false;
    this.container.style.display = 'none';

    document.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === 'F12') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle() {
    this.isVisible = !this.isVisible;
    this.container.style.display = this.isVisible ? 'block' : 'none';
  }

  renderTimeline(timelineEntries) {
    this.container.innerHTML = '';

    const grouped = new Map();
    for (const entry of timelineEntries) {
      const day = entry.day ?? 0;
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day).push(entry);
    }

    const sortedDays = [...grouped.keys()].sort((a, b) => b - a);
    for (const day of sortedDays) {
      this.container.appendChild(this.renderDaySection(day, grouped.get(day)));
    }
  }

  renderDaySection(day, entries) {
    const section = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'debug-day-header';
    header.textContent = `第 ${day} 天 (${entries.length} 条)`;

    const body = document.createElement('div');
    body.className = 'debug-entries';
    body.style.display = 'none';

    header.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    for (const entry of entries) {
      body.appendChild(this.renderEntry(entry));
    }

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  renderEntry(entry) {
    const el = document.createElement('div');
    el.className = 'debug-entry';
    el.setAttribute('data-category', entry.category || '');
    el.textContent = entry.summary || entry.message || JSON.stringify(entry).slice(0, 80);

    const detail = document.createElement('div');
    detail.className = 'debug-detail';
    detail.textContent = JSON.stringify(entry, null, 2);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      detail.classList.toggle('expanded');
    });

    el.appendChild(detail);
    return el;
  }
}
