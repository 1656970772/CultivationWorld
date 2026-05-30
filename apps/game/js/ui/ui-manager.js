import { StatusBar } from './status-bar.js';
import { LogPanel } from './log-panel.js';
import { DebugPanel } from './debug-panel.js';
import { Minimap } from './minimap.js';
import { MapLegend } from './map-legend.js';
import { EventDialog } from './event-dialog.js';
import { SavePanel } from './save-panel.js';
import { GraphPanel } from './graph-panel.js';

export class UIManager {
  constructor() {
    this.statusBar = new StatusBar('status-bar');
    this.logPanel = new LogPanel('log-panel');
    this.debugPanel = new DebugPanel('debug-panel');
    this.minimap = new Minimap('minimap-container');
    this.mapLegend = new MapLegend('map-legend');
    this.eventDialog = new EventDialog('event-dialog');
    this.savePanel = new SavePanel('save-panel');
    this.graphPanel = new GraphPanel('graph-panel');
  }

  init(mapData, terrains, factions, playerState) {
    this.minimap.init(mapData, terrains, factions);
    this.statusBar.render(playerState, []);
    this.minimap.render(playerState);
  }

  initGraphPanel(configs) {
    this.graphPanel.init(configs);
  }

  initSavePanel(saveManager, gameManager) {
    this.savePanel.setSaveManager(saveManager);
    this.savePanel.onSave = () => gameManager.getWorldSnapshot();
    this.savePanel.onLoad = (saveData) => gameManager.restoreFromSave(saveData);
  }

  update(gameState) {
    const { playerState, activeModifiers, timelineEntries, mapData } = gameState;
    this.statusBar.render(playerState, activeModifiers || []);
    this.minimap.render(playerState);
    if (timelineEntries) {
      this.debugPanel.renderTimeline(timelineEntries);
    }
  }

  setNavigateCallback(callback) {
    this.minimap.onNavigate = callback;
  }
}
