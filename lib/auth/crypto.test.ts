import { describe, expect, it } from 'vitest';
import { hashSecret, randomToken, sha256, verifySecret } from './crypto';

describe('credential primitives', () => {
  it('hashes and verifies secrets without storing plaintext', async () => {
    const stored = await hashSecret('correct horse battery staple');
    expect(stored).not.toContain('correct horse battery staple');
    await expect(verifySecret('correct horse battery staple', stored)).resolves.toBe(true);
    await expect(verifySecret('incorrect', stored)).resolves.toBe(false);
  });

  it('creates high-entropy tokens and stable SHA-256 hashes', async () => {
    expect(randomToken()).not.toBe(randomToken());
    await expect(sha256('seat-token')).resolves.toBe(await sha256('seat-token'));
  });
});

