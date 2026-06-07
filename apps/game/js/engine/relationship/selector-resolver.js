function getByPath(root, path) {
  if (!path) return root;
  const parts = path.split('.');
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function resolveMarkFilter(root, path) {
  const match = path.match(/^(.+)\.marks\[type=([A-Za-z0-9_]+)\]$/);
  if (!match) return undefined;
  const owner = getByPath(root, match[1]);
  return Array.isArray(owner?.marks) ? owner.marks.filter(m => m.type === match[2]) : [];
}

export class SelectorResolver {
  resolve(selector, context = {}) {
    if (selector == null) return selector;
    if (typeof selector !== 'string') return selector;
    if (!selector.startsWith('$')) return selector;
    const path = selector.slice(1);
    if (path === 'from') return context.from;
    if (path === 'to') return context.to;
    const filtered = resolveMarkFilter(context, path);
    if (filtered !== undefined) return filtered;
    return getByPath(context, path);
  }

  resolveLedgerRef(spec = {}, context = {}) {
    const ref = { layer: spec.layer };
    if (spec.subject != null) ref.subjectId = this.resolve(spec.subject, context);
    if (spec.object != null) ref.objectId = this.resolve(spec.object, context);
    if (spec.group != null) ref.groupId = this.resolve(spec.group, context);
    if (spec.faction != null) ref.factionId = this.resolve(spec.faction, context);
    return ref;
  }

  resolveLedgerRefs(spec = {}, context = {}) {
    const ref = this.resolveLedgerRef(spec, context);
    const expandableKeys = ['subjectId', 'objectId', 'groupId', 'factionId'];
    let refs = [ref];

    for (const key of expandableKeys) {
      const value = ref[key];
      if (!Array.isArray(value)) continue;
      refs = refs.flatMap(item => value.map(v => ({ ...item, [key]: v })));
    }

    return refs;
  }
}
