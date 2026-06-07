import { SelectorResolver } from './selector-resolver.js';

function flattenHooks(hookFiles = []) {
  const out = [];
  for (const file of hookFiles || []) {
    if (Array.isArray(file?.hooks)) out.push(...file.hooks);
  }
  return out;
}

export class RelationEventEmitter {
  constructor({ hooks = [], selectorResolver = null } = {}) {
    this.hooks = flattenHooks(hooks);
    this.selectorResolver = selectorResolver || new SelectorResolver();
  }

  fromLegacy(hookName, fromId, toId, opts = {}) {
    const hook = this.hooks.find(h => h.hook === hookName);
    if (!hook) return null;
    const context = { from: fromId, to: toId, opts };
    const eventTemplate = hook.event || {};
    const resolveValue = (value) => {
      if (typeof value === 'string' && value.startsWith('$')) return this.selectorResolver.resolve(value, context);
      if (Array.isArray(value)) return value.map(resolveValue);
      if (value && typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) out[key] = resolveValue(child);
        return out;
      }
      return value;
    };
    const event = resolveValue(eventTemplate);
    event.id = opts.id || `${hookName}_${opts.tick ?? opts.day ?? 0}_${fromId || 'none'}_${toId || 'none'}`;
    event.day = opts.tick ?? opts.day ?? 0;
    event.actor = typeof event.actor === 'string' ? { id: event.actor } : event.actor;
    event.target = typeof event.target === 'string' ? { id: event.target } : event.target;
    return event;
  }
}
