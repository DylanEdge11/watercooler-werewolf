/** How far each wait may stray from the interval, as a fraction of it. */
export const POLL_JITTER = 0.2;

/** A page nobody has tapped, clicked, scrolled, or typed on for this long stops refreshing. */
export const IDLE_AFTER_MS = 5 * 60_000;

/** What counts as someone using the page. Pointer movement alone does not. */
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export interface PollOptions {
  doc?: Document;
  random?: () => number;
  /**
   * Stop refreshing once nobody has used the page for this long. The first input
   * afterwards (or coming back to the tab) refreshes at once and restarts the polling.
   * Leave unset to poll for as long as the page is visible.
   */
  idleAfterMs?: number;
  /** Told `true` when the page stops refreshing for idleness, and `false` when input resumes it. */
  onIdleChange?: (idle: boolean) => void;
  /**
   * Read before each turn: while it returns true the timer refreshes nothing (for example,
   * the game is over). Coming back to the tab still refreshes once.
   */
  stopWhen?: () => boolean;
}

/**
 * Runs `run` every `ms` while the page is visible. `ms` may be a function, read
 * again before each wait, so the pace can follow the game (see poll-interval.ts).
 * A background tab skips its turns and refreshes once when it becomes visible
 * again, so idle tabs do not keep polling the API. Returns a cleanup function
 * for useEffect.
 *
 * Each wait is the interval give or take 20%, so pages opened together (or
 * all sped up by the same deadline) drift apart instead of refreshing in step.
 *
 * A window left open on a second screen counts as visible, so pages can also
 * stop when nobody is using them (`idleAfterMs`) or when there is nothing left
 * to refresh (`stopWhen`).
 */
export function pollWhileVisible(
  run: () => void,
  ms: number | (() => number),
  options: PollOptions = {},
): () => void {
  const { doc = document, random = Math.random, idleAfterMs, onIdleChange, stopWhen } = options;
  const interval = typeof ms === 'function' ? ms : () => ms;
  const wait = () => Math.round(interval() * (1 + POLL_JITTER * (2 * random() - 1)));
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  // Set when a turn was skipped (hidden or idle), so the page catches up once when it is back in use.
  let due = false;
  let idle = false;
  let lastInput = Date.now();

  const setIdle = (value: boolean) => {
    if (idle === value) return;
    idle = value;
    onIdleChange?.(value);
  };

  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      if (!doc.hidden && !stopWhen?.()) {
        if (idleAfterMs !== undefined && Date.now() - lastInput > idleAfterMs) {
          due = true;
          setIdle(true);
        } else {
          run();
        }
      }
      schedule();
    }, wait());
  };
  schedule();

  /** Someone is using the page again: catch up at once if a turn was skipped while idle. */
  const resume = () => {
    lastInput = Date.now();
    if (!idle) return;
    setIdle(false);
    if (due) {
      due = false;
      run();
    }
  };

  // Set when the tab is hidden, not from the timer: mobile browsers often
  // suspend timers in background tabs, so a hidden tick may never happen.
  const onVisibility = () => {
    if (doc.hidden) {
      due = true;
      return;
    }
    lastInput = Date.now();
    setIdle(false);
    if (due) {
      due = false;
      run();
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  const listening = idleAfterMs !== undefined;
  if (listening) {
    for (const name of INPUT_EVENTS) doc.addEventListener(name, resume, { capture: true, passive: true });
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (listening) {
      for (const name of INPUT_EVENTS) doc.removeEventListener(name, resume, { capture: true });
    }
  };
}
