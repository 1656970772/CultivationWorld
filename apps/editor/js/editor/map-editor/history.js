export class MapEditHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return false;
    this.undoStack.push(changes);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  undo(model) {
    if (!this.canUndo()) return [];
    const changes = this.undoStack.pop();
    model.applyChanges(changes, 'before');
    this.redoStack.push(changes);
    return changes;
  }

  redo(model) {
    if (!this.canRedo()) return [];
    const changes = this.redoStack.pop();
    model.applyChanges(changes, 'after');
    this.undoStack.push(changes);
    return changes;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }
}
