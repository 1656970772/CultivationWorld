export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  subscribe(eventType, callback) {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, new Set());
    }
    this._listeners.get(eventType).add(callback);

    return () => this.unsubscribe(eventType, callback);
  }

  publish(eventType, data) {
    const listeners = this._listeners.get(eventType);
    if (!listeners) return;

    for (const callback of listeners) {
      try {
        callback(data);
      } catch (err) {
        console.error(`EventBus: 事件 [${eventType}] 的监听器执行出错:`, err);
      }
    }
  }

  unsubscribe(eventType, callback) {
    const listeners = this._listeners.get(eventType);
    if (!listeners) return;

    listeners.delete(callback);
    if (listeners.size === 0) {
      this._listeners.delete(eventType);
    }
  }
}

export const eventBus = new EventBus();
