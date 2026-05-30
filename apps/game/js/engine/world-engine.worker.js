/**
 * WorldEngine Worker 入口
 *
 * Web Worker 内运行，通过 postMessage 与主线程通信。
 */
import { WorldEngine } from './world-engine.js';

let engine = null;

self.onmessage = function(e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT':
      handleInit(payload);
      break;
    case 'TICK':
      handleTick();
      break;
    case 'MULTI_TICK':
      handleMultiTick(payload);
      break;
    case 'GET_SNAPSHOT':
      handleGetSnapshot();
      break;
    case 'GET_HISTORY':
      handleGetHistory();
      break;
  }
};

function handleInit(payload) {
  try {
    engine = new WorldEngine();
    const result = engine.init(payload.configs);

    self.postMessage({
      type: 'INIT_COMPLETE',
      payload: result,
    });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err.message, stack: err.stack },
    });
  }
}

function handleTick() {
  try {
    if (!engine) {
      self.postMessage({ type: 'ERROR', payload: { message: 'Engine not initialized' } });
      return;
    }

    const tickResult = engine.tick();
    const snapshot = engine.getWorldSnapshot();

    self.postMessage({
      type: 'TICK_RESULT',
      payload: {
        day: snapshot.day,
        factions: snapshot.factions,
        npcs: snapshot.npcs,
        stats: snapshot.stats,
        activeModifiers: snapshot.activeModifiers,
        tickLog: tickResult,
      },
    });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err.message, stack: err.stack },
    });
  }
}

function handleMultiTick(payload) {
  try {
    if (!engine) {
      self.postMessage({ type: 'ERROR', payload: { message: 'Engine not initialized' } });
      return;
    }

    const count = payload.count || 1;
    const results = engine.multiTick(count);
    const snapshot = engine.getWorldSnapshot();

    self.postMessage({
      type: 'MULTI_TICK_RESULT',
      payload: {
        count,
        day: snapshot.day,
        factions: snapshot.factions,
        npcs: snapshot.npcs,
        stats: snapshot.stats,
        activeModifiers: snapshot.activeModifiers,
        results,
      },
    });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err.message, stack: err.stack },
    });
  }
}

function handleGetSnapshot() {
  try {
    if (!engine) {
      self.postMessage({ type: 'ERROR', payload: { message: 'Engine not initialized' } });
      return;
    }

    self.postMessage({
      type: 'SNAPSHOT',
      payload: engine.getWorldSnapshot(),
    });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err.message, stack: err.stack },
    });
  }
}

function handleGetHistory() {
  try {
    if (!engine) {
      self.postMessage({ type: 'ERROR', payload: { message: 'Engine not initialized' } });
      return;
    }

    self.postMessage({
      type: 'HISTORY',
      payload: engine.getTickHistory(),
    });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err.message, stack: err.stack },
    });
  }
}
