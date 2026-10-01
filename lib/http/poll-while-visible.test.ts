import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_AFTER_MS, POLL_JITTER, pollWhileVisible } from './poll-while-visible';

/** A random source at the midpoint, so waits equal the interval exactly. */
const steady = () => 0.5;

function fakeDocument() {
  const target = new EventTarget();
  const doc = Object.assign(target, { hidden: false });
  const setHidden = (hidden: boolean) => {
    doc.hidden = hidden;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { doc: doc as unknown as Document, setHidden };
}

describe('pollWhileVisible', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls on the interval while visible', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    const stop = pollWhileVisible(run, 10_000, { doc, random: steady });
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it('skips turns while hidden and catches up once on return', () => {
    const { doc, setHidden } = fakeDocument();
    const run = vi.fn();
    const stop = pollWhileVisible(run, 10_000, { doc, random: steady });
    setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
    setHidden(false);
    expect(run).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('refreshes on return even if the browser suspended timers while hidden', () => {
    const { doc, setHidden } = fakeDocument();
    const run = vi.fn();
    const stop = pollWhileVisible(run, 10_000, { doc, random: steady });
    setHidden(true);
    setHidden(false);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reads a changing interval before each wait', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    let ms = 30_000;
    const stop = pollWhileVisible(run, () => ms, { doc, random: steady });
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    // The deadline got close: the next wait is already scheduled at 30 s, then 10 s after that.
    ms = 10_000;
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(20_000);
    expect(run).toHaveBeenCalledTimes(4);
    stop();
  });

  it('stops polling after cleanup', () => {
    const { doc, setHidden } = fakeDocument();
    const run = vi.fn();
    const stop = pollWhileVisible(run, 10_000, { doc, random: steady });
    stop();
    setHidden(true);
    vi.advanceTimersByTime(20_000);
    setHidden(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('spreads each wait up to 20% either side of the interval', () => {
    const { doc } = fakeDocument();
    const early = vi.fn();
    const late = vi.fn();
    const stopEarly = pollWhileVisible(early, 10_000, { doc, random: () => 0 });
    const stopLate = pollWhileVisible(late, 10_000, { doc, random: () => 0.999_999 });
    vi.advanceTimersByTime(10_000 * (1 - POLL_JITTER));
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000 * 2 * POLL_JITTER);
    expect(late).toHaveBeenCalledTimes(1);
    stopEarly();
    stopLate();
  });

  it('stops polling once nobody has used the page for a while, and says so', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    const idle = vi.fn();
    const stop = pollWhileVisible(run, 30_000, { doc, random: steady, idleAfterMs: 60_000, onIdleChange: idle });
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(idle.mock.calls).toEqual([[true]]);
    stop();
  });

  it('catches up at once on the first tap or key press after going idle, then polls again', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    const idle = vi.fn();
    const stop = pollWhileVisible(run, 30_000, { doc, random: steady, idleAfterMs: 60_000, onIdleChange: idle });
    vi.advanceTimersByTime(10 * 60_000);
    const before = run.mock.calls.length;
    doc.dispatchEvent(new Event('pointerdown'));
    expect(run).toHaveBeenCalledTimes(before + 1);
    expect(idle.mock.calls).toEqual([[true], [false]]);
    doc.dispatchEvent(new Event('keydown'));
    expect(run).toHaveBeenCalledTimes(before + 1);
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(before + 2);
    stop();
  });

  it('input before the page goes idle only keeps it awake', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    const stop = pollWhileVisible(run, 30_000, { doc, random: steady, idleAfterMs: 60_000 });
    for (let minute = 0; minute < 10; minute += 1) {
      vi.advanceTimersByTime(45_000);
      doc.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(15_000);
    }
    expect(run).toHaveBeenCalledTimes(20);
    stop();
  });

  it('coming back to the tab counts as using the page', () => {
    const { doc, setHidden } = fakeDocument();
    const run = vi.fn();
    const idle = vi.fn();
    const stop = pollWhileVisible(run, 30_000, { doc, random: steady, idleAfterMs: 60_000, onIdleChange: idle });
    vi.advanceTimersByTime(10 * 60_000);
    setHidden(true);
    setHidden(false);
    const after = run.mock.calls.length;
    expect(idle.mock.calls).toEqual([[true], [false]]);
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(after + 1);
    stop();
  });

  it('skips its turns while told to stop, but still refreshes once when the tab comes back', () => {
    const { doc, setHidden } = fakeDocument();
    const run = vi.fn();
    let over = false;
    const stop = pollWhileVisible(run, 30_000, { doc, random: steady, stopWhen: () => over });
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(1);
    over = true;
    vi.advanceTimersByTime(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event('pointerdown'));
    expect(run).toHaveBeenCalledTimes(1);
    setHidden(true);
    setHidden(false);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('removes its input listeners on cleanup', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    const idle = vi.fn();
    const stop = pollWhileVisible(run, 30_000, { doc, random: steady, idleAfterMs: 60_000, onIdleChange: idle });
    vi.advanceTimersByTime(10 * 60_000);
    stop();
    doc.dispatchEvent(new Event('pointerdown'));
    expect(idle.mock.calls).toEqual([[true]]);
  });

  it('goes idle after five minutes by default', () => {
    expect(IDLE_AFTER_MS).toBe(5 * 60_000);
  });
});

