const LIVE_MUTATIONS = new Set([
  'OPEN',
  'ENTER_FINAL_SHOWDOWN',
  'LOCK_AND_PROPOSE',
  'FINALIZE_HUNTER',
  'PUBLISH',
  'STOP',
  'RESET',
]);

export function shouldRefreshOperations(action: string | undefined): boolean {
  return action === undefined || LIVE_MUTATIONS.has(action);
}
