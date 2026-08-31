const encoder = new TextEncoder();
// Cloudflare Workers currently caps WebCrypto PBKDF2 at 100,000 iterations.
// Keep the encoded count explicit so stored hashes remain self-describing.
const ITERATIONS = 100_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  );
  return `pbkdf2-sha256$${ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(derived))}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, hashValue] = stored.split('$');
  if (algorithm !== 'pbkdf2-sha256' || !iterationsValue || !saltValue || !hashValue) return false;
  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = new Uint8Array(
    await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(saltValue), iterations },
      key,
      256,
    ),
  );
  const expected = base64UrlToBytes(hashValue);
  if (derived.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < derived.length; index += 1) mismatch |= derived[index] ^ expected[index];
  return mismatch === 0;
}
