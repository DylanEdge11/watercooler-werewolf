export function createSecureRandomRolls(count: number): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Random roll count must be a non-negative integer.');
  }
  const values = new Uint32Array(count);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => value / 0x1_0000_0000);
}

