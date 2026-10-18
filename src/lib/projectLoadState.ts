export type ProjectLoadState = { scope: string; ready: boolean; error: string };

export function projectLoadStatus(state: ProjectLoadState, scope: string) {
  if (state.scope !== scope) return 'loading';
  if (state.error) return 'error';
  return state.ready ? 'ready' : 'loading';
}
