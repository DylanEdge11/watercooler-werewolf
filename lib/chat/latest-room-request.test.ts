import { describe, expect, it } from 'vitest';
import { LatestRoomRequest } from './latest-room-request';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('latest room message request', () => {
  it('ignores an earlier room response that completes after the selected room', async () => {
    const requestGate = new LatestRoomRequest('werewolf-room');
    const earlierFetch = deferred<string[]>();
    const selectedFetch = deferred<string[]>();
    let displayedMessages: string[] = [];
    const reportError = (error: unknown) => {
      throw error;
    };

    const earlierRequest = requestGate.run(
      'werewolf-room',
      () => earlierFetch.promise,
      (messages) => { displayedMessages = messages; },
      reportError,
    );
    requestGate.select('mason-room');
    const selectedRequest = requestGate.run(
      'mason-room',
      () => selectedFetch.promise,
      (messages) => { displayedMessages = messages; },
      reportError,
    );

    selectedFetch.resolve(['Mason message']);
    await selectedRequest;
    expect(displayedMessages).toEqual(['Mason message']);

    earlierFetch.resolve(['Earlier werewolf message']);
    await earlierRequest;
    expect(displayedMessages).toEqual(['Mason message']);
  });
});
