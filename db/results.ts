/** Rows changed by a write, or 0 when the provider reports nothing. A conditional write that changed 0 rows lost a race. */
export function changes(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
}
