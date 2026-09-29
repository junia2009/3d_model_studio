/**
 * シーン全体のスナップショット（JSON 文字列）を積む単純な Undo / Redo 管理。
 * 部品数が数百程度なら十分に軽い。
 */
export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
  }

  /** 最初の状態を登録（履歴はクリアされる） */
  reset(snapshot) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = snapshot;
  }

  /** 変更後の状態を登録。変化がなければ何もしない */
  push(snapshot) {
    if (snapshot === this.current) return false;
    if (this.current !== null) this.undoStack.push(this.current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = snapshot;
    return true;
  }

  undo() {
    if (!this.undoStack.length) return null;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    return this.current;
  }

  redo() {
    if (!this.redoStack.length) return null;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    return this.current;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
