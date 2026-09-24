import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Claude Code cloud sessions route HTTPS through a TLS-intercepting proxy whose
 * CA is not in Chromium's trust store. Node already trusts it through
 * NODE_EXTRA_CA_CERTS; Chromium is told to trust that one CA by its public-key
 * fingerprint. Certificate verification stays on for everything else.
 */
export const CLOUD_PROXY_CA_PATH = '/root/.ccr/agent-proxy-ca.crt';

/** Base64 SHA-256 of a certificate's SubjectPublicKeyInfo, as Chromium expects. */
export function spkiFingerprint(certificatePem: string): string {
  const spki = createPublicKey(certificatePem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('base64');
}

function cloudProxyCaPath(): string {
  return process.env.E2E_PROXY_CA_CERT?.trim() || CLOUD_PROXY_CA_PATH;
}

/** True when this process runs behind the cloud session's proxy. */
export function behindCloudProxy(caPath = cloudProxyCaPath()): boolean {
  return existsSync(caPath);
}

/** Chromium launch arguments for the proxy CA, or none when no proxy CA exists. */
export function proxyTrustArgs(caPath = cloudProxyCaPath()): string[] {
  if (!behindCloudProxy(caPath)) return [];
  return [`--ignore-certificate-errors-spki-list=${spkiFingerprint(readFileSync(caPath, 'utf8'))}`];
}

/**
 * The cloud proxy occasionally answers a browser request itself with a short
 * plain-text 502/504 instead of forwarding Vercel's reply. Vercel stamps every
 * response it serves with x-vercel-id, so a gateway error without that header
 * came from the proxy, never from the application.
 */
export function isProxyGatewayError(status: number, headers: Record<string, string>): boolean {
  return status >= 502 && status <= 504 && !('x-vercel-id' in headers);
}
