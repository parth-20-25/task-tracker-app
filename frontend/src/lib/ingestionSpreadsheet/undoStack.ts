export interface UndoEntry<T> {
  label: string;
  state: T;
}

export function createUndoStack<T>(limit = 40) {
  const past: UndoEntry<T>[] = [];
  const future: UndoEntry<T>[] = [];

  return {
    push(label: string, state: T) {
      past.push({ label, state });
      if (past.length > limit) {
        past.shift();
      }
      future.length = 0;
    },
    undo(current: T): { state: T; label: string } | null {
      const entry = past.pop();
      if (!entry) {
        return null;
      }
      future.push({ label: entry.label, state: current });
      return { state: entry.state, label: entry.label };
    },
    redo(current: T): { state: T; label: string } | null {
      const entry = future.pop();
      if (!entry) {
        return null;
      }
      past.push({ label: entry.label, state: current });
      return { state: entry.state, label: entry.label };
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
