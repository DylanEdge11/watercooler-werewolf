/**
 * Runs `run` every `ms` while the page is visible. A background tab skips its
 * turns and refreshes once when it becomes visible again, so idle tabs do not
 * keep polling the API. Returns a cleanup function for useEffect.
 */
export function pollWhileVisible(run: () => void, ms: number, doc: Document = document): () => void {
  const timer = setInterval(() => {
    if (!doc.hidden) run();
  }, ms);
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
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
