import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proxyTrustArgs, spkiFingerprint } from '../e2e/proxy-trust';

// A throwaway self-signed CA. The expected fingerprint was computed independently with
// `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`.
const FIXTURE_CA = `-----BEGIN CERTIFICATE-----
MIIBsjCCAVegAwIBAgIUV4niFwquGMhZ5/b8SXhHydb+auYwCgYIKoZIzj0EAwIw
LTErMCkGA1UEAwwiV2F0ZXJjb29sZXIgV2VyZXdvbGYgdGVzdCBwcm94eSBDQTAg
Fw0yNjA5MjQwNDA0MjBaGA8yMTI2MDgzMTA0MDQyMFowLTErMCkGA1UEAwwiV2F0
ZXJjb29sZXIgV2VyZXdvbGYgdGVzdCBwcm94eSBDQTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABAjGtw/9bVaMxD3tjZvVPnQaB3x7n5j87wH97kk/K3PQNt4pIhSH
j8TJk9kbiLaag4R36559Ac694itomky+ep2jUzBRMB0GA1UdDgQWBBTQOv+8exOg
LM58Ls7Vz1KC+gAvKTAfBgNVHSMEGDAWgBTQOv+8exOgLM58Ls7Vz1KC+gAvKTAP
BgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQDigthGEogHi0R9X/Mu
eGo5ickVzBLSpTF5o/4oDr+xFgIhANIc2hNH2i3BHDuz6rYtESLQ/lVk58gM4WoS
cFuuL3S8
-----END CERTIFICATE-----
`;
const FIXTURE_FINGERPRINT = 'MVGA1UxYSEhLTzZ5193FneZIU98J9eKKH+FA98NScm0=';

describe('Playwright proxy trust', () => {
  it('computes the SPKI fingerprint Chromium expects', () => {
    expect(spkiFingerprint(FIXTURE_CA)).toBe(FIXTURE_FINGERPRINT);
  });

  it('trusts only the configured CA and adds nothing when none exists', () => {
    const caPath = join(mkdtempSync(join(tmpdir(), 'proxy-trust-')), 'ca.crt');
    writeFileSync(caPath, FIXTURE_CA);
    expect(proxyTrustArgs(caPath)).toEqual([`--ignore-certificate-errors-spki-list=${FIXTURE_FINGERPRINT}`]);
    expect(proxyTrustArgs(join(tmpdir(), 'no-such-proxy-ca.crt'))).toEqual([]);
  });
});
