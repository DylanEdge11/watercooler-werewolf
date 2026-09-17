import { afterEach, describe, expect, test } from 'vitest';
import { assertSameOrigin } from './security';

const originalSiteOrigin = process.env.SITE_ORIGIN;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercel = process.env.VERCEL;

function restore(name: 'SITE_ORIGIN' | 'NODE_ENV' | 'VERCEL', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else (process.env as Record<string, string | undefined>)[name] = value;
}

afterEach(() => {
  restore('SITE_ORIGIN', originalSiteOrigin);
  restore('NODE_ENV', originalNodeEnv);
  restore('VERCEL', originalVercel);
});

describe('mutation origin policy', () => {
  test('requires the configured exact origin', () => {
    (process.env as Record<string, string | undefined>).SITE_ORIGIN = 'https://game.example';
    const valid = new Request('https://game.example/api/mutation', {
      headers: { origin: 'https://game.example' },
    });
    expect(() => assertSameOrigin(valid)).not.toThrow();

    const wrongPort = new Request('https://game.example:8443/api/mutation', {
      headers: { origin: 'https://game.example:8443' },
    });
    expect(() => assertSameOrigin(wrongPort)).toThrow('Cross-origin mutation rejected.');
  });

  test('fails closed for a missing browser origin in a deployed runtime', () => {
    delete process.env.SITE_ORIGIN;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(() => assertSameOrigin(new Request('https://game.example/api/mutation'))).toThrow(
      'Origin header required',
    );
  });

  test('rejects malformed or non-http configured origins', () => {
    (process.env as Record<string, string | undefined>).SITE_ORIGIN = 'javascript:alert(1)';
    expect(() => assertSameOrigin(new Request('https://game.example/api/mutation', {
      headers: { origin: 'https://game.example' },
    }))).toThrow('SITE_ORIGIN must use http or https.');
  });
});
