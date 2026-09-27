/**
 * Runs `run` every `ms` while the page is visible. `ms` may be a function, read
 * again before each wait, so the pace can follow the game (see poll-interval.ts).
 * A background tab skips its turns and refreshes once when it becomes visible
 * again, so idle tabs do not keep polling the API. Returns a cleanup function
 * for useEffect.
 */
export function pollWhileVisible(run: () => void, ms: number | (() => number), doc: Document = document): () => void {
  const interval = typeof ms === 'function' ? ms : () => ms;
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      if (!doc.hidden) run();
      schedule();
    }, interval());
  };
  schedule();
  // Set when the tab is hidden, not from the timer: mobile browsers often
  // suspend timers in background tabs, so a hidden tick may never happen.
  let due = false;
  const onVisibility = () => {
    if (doc.hidden) {
      due = true;
    } else if (due) {
      due = false;
      run();
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
