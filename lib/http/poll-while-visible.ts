/**
 * Runs `run` every `ms` while the page is visible. A background tab skips its
 * turns and catches up once when it becomes visible again, so idle tabs do not
 * keep polling the API. Returns a cleanup function for useEffect.
 */
export function pollWhileVisible(run: () => void, ms: number, doc: Document = document): () => void {
  let missed = false;
  const timer = setInterval(() => {
    if (doc.hidden) missed = true;
    else run();
  }, ms);
  const onVisibility = () => {
    if (doc.hidden || !missed) return;
    missed = false;
    run();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
