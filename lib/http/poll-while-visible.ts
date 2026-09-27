/** How far each wait may stray from the interval, as a fraction of it. */
export const POLL_JITTER = 0.2;

/**
 * Runs `run` every `ms` while the page is visible. `ms` may be a function, read
 * again before each wait, so the pace can follow the game (see poll-interval.ts).
 * A background tab skips its turns and refreshes once when it becomes visible
 * again, so idle tabs do not keep polling the API. Returns a cleanup function
 * for useEffect.
 *
 * Each wait is the interval give or take 20%, so pages opened together (or
 * all sped up by the same deadline) drift apart instead of refreshing in step.
 */
export function pollWhileVisible(
  run: () => void,
  ms: number | (() => number),
  doc: Document = document,
  random: () => number = Math.random,
): () => void {
  const interval = typeof ms === 'function' ? ms : () => ms;
  const wait = () => Math.round(interval() * (1 + POLL_JITTER * (2 * random() - 1)));
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      if (!doc.hidden) run();
      schedule();
    }, wait());
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
