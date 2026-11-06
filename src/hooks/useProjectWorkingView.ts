import { useMemo, useSyncExternalStore } from 'react';
import { projectWorkingViewMemory } from '../lib/projectWorkingViewMemory';

export function useProjectWorkingView<T>(userId: string | undefined, projectId: string | undefined, field: string, initial: T | (() => T)) {
  // The initializer only applies when this scope has no working view yet.
  const entry = useMemo(() => projectWorkingViewMemory.entry(userId, projectId, field, initial), [userId, projectId, field]);
  const value = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
  return [value, entry.set] as const;
}
