import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnv } from '../../scripts/load-env.mjs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'load-env-test-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function files(entries: Record<string, string>) {
  for (const [name, text] of Object.entries(entries)) writeFileSync(join(dir, name), text);
}

describe('loadLocalEnv', () => {
  test('reports which file supplied each value, and leaves a value already in the environment alone', () => {
    files({ '.env': 'TURSO_DATABASE_URL=file:./from-env.db\nOTHER=1\n', '.env.local': 'LOCAL_ONLY=2\n' });
    const env: Record<string, string> = { OTHER: 'from-shell' };
    const { sources } = loadLocalEnv({ dir, env, warn: () => {} });
    expect(env).toMatchObject({ TURSO_DATABASE_URL: 'file:./from-env.db', OTHER: 'from-shell', LOCAL_ONLY: '2' });
    expect(sources).toEqual({ TURSO_DATABASE_URL: '.env', LOCAL_ONLY: '.env.local' });
  });

  test('warns, without printing either value, when .env and .env.local disagree on the database address', () => {
    files({ '.env': 'TURSO_DATABASE_URL=file:./a.db\n', '.env.local': 'TURSO_DATABASE_URL=libsql://secret-host.turso.io?authToken=abc\n' });
    const warn = vi.fn();
    const env: Record<string, string> = {};
    loadLocalEnv({ dir, env, warn });
    expect(env.TURSO_DATABASE_URL).toBe('file:./a.db');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('.env and .env.local set different values for TURSO_DATABASE_URL');
    expect(warn.mock.calls[0][0]).not.toContain('secret-host');
    expect(warn.mock.calls[0][0]).not.toContain('authToken');
  });

  test('says nothing when the two files agree, or when the shell already set the address', () => {
    const warn = vi.fn();
    files({ '.env': 'TURSO_DATABASE_URL=file:./a.db\n', '.env.local': 'TURSO_DATABASE_URL=file:./a.db\n' });
    loadLocalEnv({ dir, env: {}, warn });
    files({ '.env': 'TURSO_DATABASE_URL=file:./a.db\n', '.env.local': 'TURSO_DATABASE_URL=file:./b.db\n' });
    loadLocalEnv({ dir, env: { TURSO_DATABASE_URL: 'libsql://from-shell.example.io' }, warn });
    expect(warn).not.toHaveBeenCalled();
  });

  test('strips an unquoted trailing comment and surrounding quotes, but keeps a # that is part of a value', () => {
    files({ '.env': [
      'A=value-one # preview database',
      'B="quoted # kept"',
      "C='single'",
      'D=has#hash',
      'E=  spaced  ',
    ].join('\n') });
    const env: Record<string, string> = {};
    loadLocalEnv({ dir, env, warn: () => {} });
    expect(env).toEqual({ A: 'value-one', B: 'quoted # kept', C: 'single', D: 'has#hash', E: 'spaced' });
  });

  test('a missing file is fine', () => {
    const env: Record<string, string> = {};
    expect(loadLocalEnv({ dir, env, warn: () => {} })).toEqual({ sources: {} });
  });
});
