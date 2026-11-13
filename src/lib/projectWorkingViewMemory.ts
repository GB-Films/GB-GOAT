type Update<T> = T | ((previous: T) => T);
export type WorkingViewEntry<T> = {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  set: (update: Update<T>) => void;
};

function createEntry<T>(initial: T | (() => T)): WorkingViewEntry<T> {
  let value = typeof initial === 'function' ? (initial as () => T)() : initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: update => {
      const next = typeof update === 'function' ? (update as (previous: T) => T)(value) : update;
      if (Object.is(value, next)) return;
      value = next;
      listeners.forEach(listener => listener());
    },
  };
}

// One instance per loaded page. Route changes reuse it; a full reload starts
// empty. Nothing is written to browser storage or sent to another user/device.
export function createProjectWorkingViewMemory() {
  const entries = new Map<string, unknown>();
  return {
    entry<T>(userId: string | undefined, projectId: string | undefined, field: string, initial: T | (() => T)): WorkingViewEntry<T> {
      if (!userId || !projectId) return createEntry(initial);
      const key = JSON.stringify([userId, projectId, field]);
      if (!entries.has(key)) entries.set(key, createEntry(initial));
      return entries.get(key) as WorkingViewEntry<T>;
    },
  };
}

export const projectWorkingViewMemory = createProjectWorkingViewMemory();
