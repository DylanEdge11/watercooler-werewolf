export class LatestRoomRequest {
  private roomId: string;
  private requestId = 0;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  select(roomId: string): void {
    if (this.roomId === roomId) return;
    this.roomId = roomId;
    this.requestId += 1;
  }

  async run<T>(
    roomId: string,
    request: () => Promise<T>,
    onSuccess: (result: T) => void,
    onError: (error: unknown) => void,
  ): Promise<void> {
    if (this.roomId !== roomId) return;
    const requestId = ++this.requestId;
    try {
      const result = await request();
      if (this.isCurrent(roomId, requestId)) onSuccess(result);
    } catch (error) {
      if (this.isCurrent(roomId, requestId)) onError(error);
    }
  }

  private isCurrent(roomId: string, requestId: number): boolean {
    return this.roomId === roomId && this.requestId === requestId;
  }
}
