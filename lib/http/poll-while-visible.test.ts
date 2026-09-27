import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollWhileVisible } from './poll-while-visible';

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
    const stop = pollWhileVisible(run, 10_000, doc);
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
  });

  it('skips turns while hidden and catches up once on return', () => {
    const { doc, setHidden } = fakeDocument();
    const run = vi.fn();
    const stop = pollWhileVisible(run, 10_000, doc);
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
    const stop = pollWhileVisible(run, 10_000, doc);
    setHidden(true);
    setHidden(false);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reads a changing interval before each wait', () => {
    const { doc } = fakeDocument();
    const run = vi.fn();
    let ms = 30_000;
    const stop = pollWhileVisible(run, () => ms, doc);
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
    const stop = pollWhileVisible(run, 10_000, doc);
    stop();
    setHidden(true);
    vi.advanceTimersByTime(20_000);
    setHidden(false);
    expect(run).not.toHaveBeenCalled();
  });
});
