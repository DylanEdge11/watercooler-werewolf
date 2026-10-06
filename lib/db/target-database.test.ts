import { describe, expect, test, vi } from 'vitest';
import { resolve } from 'node:path';
import { confirmDatabaseTarget, confirmRemoteHost, describeDatabaseTarget, envSource } from '../../scripts/lib/target-database.mjs';
import { assertPilotTarget } from '../../scripts/lib/http.mjs';

const REMOTE = 'libsql://watercooler-preview-example.turso.io';
const noPrompt = () => {
  throw new Error('should not prompt');
};

describe('describeDatabaseTarget', () => {
  test('a local file is described by its resolved path and needs no confirmation', () => {
    expect(describeDatabaseTarget('file:./work/watercooler.db')).toEqual({
      remote: false,
      display: `the local file ${resolve('./work/watercooler.db')}`,
      host: null,
    });
  });

  test('a remote URL is described by scheme and host only, never credentials or the query string', () => {
    const target = describeDatabaseTarget(`${REMOTE}?authToken=super-secret-token`);
    expect(target).toEqual({ remote: true, display: REMOTE, host: 'watercooler-preview-example.turso.io' });
    expect(JSON.stringify(target)).not.toContain('super-secret-token');
  });

  test('something that is not a URL is refused with a plain message', () => {
    expect(() => describeDatabaseTarget('not a url')).toThrow(/not a valid URL/);
  });
});

describe('envSource', () => {
  test('names the file that supplied a value, or the shell when none did', () => {
    expect(envSource({ TURSO_DATABASE_URL: '.env.local' }, 'TURSO_DATABASE_URL')).toBe('the file .env.local');
    expect(envSource({}, 'TURSO_DATABASE_URL')).toBe('the shell environment');
  });
});

describe('confirmDatabaseTarget', () => {
  test('always prints the target and its source; a local file is not asked about', async () => {
    const log = vi.fn();
    await confirmDatabaseTarget({ url: 'file:./a.db', source: 'the file .env', log, argv: [], env: {}, interactive: false, prompt: noPrompt });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Target database: the local file'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('(from the file .env)'));
  });

  test('a remote database without a terminal and without --confirm-host is refused and says what to pass', async () => {
    await expect(confirmDatabaseTarget({ url: REMOTE, source: 'the shell environment', log: () => {}, argv: [], env: {}, interactive: false, prompt: noPrompt }))
      .rejects.toThrow('--confirm-host=watercooler-preview-example.turso.io');
  });

  test('--confirm-host with the right host lets a remote database through, in both spellings and via CONFIRM_HOST', async () => {
    const base = { url: REMOTE, source: 'the shell environment', log: () => {}, interactive: false, prompt: noPrompt };
    await expect(confirmDatabaseTarget({ ...base, argv: ['--confirm-host=watercooler-preview-example.turso.io'], env: {} })).resolves.toMatchObject({ remote: true });
    await expect(confirmDatabaseTarget({ ...base, argv: ['--confirm-host', 'Watercooler-Preview-Example.turso.io'], env: {} })).resolves.toMatchObject({ remote: true });
    await expect(confirmDatabaseTarget({ ...base, argv: [], env: { CONFIRM_HOST: 'watercooler-preview-example.turso.io' } })).resolves.toMatchObject({ remote: true });
  });

  test('--confirm-host with a different host stops the run', async () => {
    await expect(confirmDatabaseTarget({ url: REMOTE, source: 'x', log: () => {}, argv: ['--confirm-host=other.example.com'], env: {}, interactive: false, prompt: noPrompt }))
      .rejects.toThrow(/not the database host/);
  });

  test('at a terminal, typing the host continues and anything else stops', async () => {
    const base = { url: REMOTE, source: 'x', log: () => {}, argv: [] as string[], env: {}, interactive: true };
    await expect(confirmDatabaseTarget({ ...base, prompt: async () => 'watercooler-preview-example.turso.io\n' })).resolves.toMatchObject({ remote: true });
    await expect(confirmDatabaseTarget({ ...base, prompt: async () => 'yes' })).rejects.toThrow(/not the host name/);
  });
});

describe('confirmRemoteHost', () => {
  test('an empty --confirm-host does not count as confirming', async () => {
    await expect(confirmRemoteHost({ label: 'app', host: 'x.example.com', argv: ['--confirm-host='], env: {}, interactive: false, prompt: noPrompt }))
      .rejects.toThrow(/Nothing was changed/);
  });
});

describe('assertPilotTarget', () => {
  const quiet = { log: () => {}, argv: [] as string[], interactive: false, prompt: noPrompt };

  test('a local app needs nothing', async () => {
    await expect(assertPilotTarget('http://localhost:3000', { ...quiet, env: {} })).resolves.toEqual({ remote: false, host: 'localhost' });
  });

  test('a remote app needs PILOT_ALLOW_REMOTE, https and the confirmed host', async () => {
    const url = 'https://preview-example.vercel.app';
    await expect(assertPilotTarget(url, { ...quiet, env: {} })).rejects.toThrow(/not local/);
    await expect(assertPilotTarget('http://preview-example.vercel.app', { ...quiet, env: { PILOT_ALLOW_REMOTE: 'yes' } })).rejects.toThrow(/https/);
    await expect(assertPilotTarget(url, { ...quiet, env: { PILOT_ALLOW_REMOTE: 'yes' } })).rejects.toThrow('--confirm-host=preview-example.vercel.app');
    await expect(assertPilotTarget(url, { ...quiet, env: { PILOT_ALLOW_REMOTE: 'yes', CONFIRM_HOST: 'preview-example.vercel.app' } }))
      .resolves.toEqual({ remote: true, host: 'preview-example.vercel.app' });
  });

  test('a URL that is not http or https is refused', async () => {
    await expect(assertPilotTarget('ftp://example.com', { ...quiet, env: {} })).rejects.toThrow(/http:\/\/ or https:\/\//);
  });
});
