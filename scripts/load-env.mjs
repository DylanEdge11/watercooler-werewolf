import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function cleanValue(raw) {
  const value = raw.trim();
  if (/^(['"]).*\1$/u.test(value)) return value.slice(1, -1);
  return value.replace(/\s+#.*$/u, '');
}

/**
 * Load local examples for standalone operator scripts without overriding CI/Vercel values.
 * Returns which file supplied each variable it set, so a script can say where a value came from.
 * `.env` is read first and wins over `.env.local` (the reverse of Next.js), so a disagreement on the
 * database address is reported rather than left silent.
 * @param {{ dir?: string, env?: Record<string, string | undefined>, warn?: (message: string) => void }} [options]
 * @returns {{ sources: Record<string, string> }}
 */
export function loadLocalEnv({ dir = process.cwd(), env = process.env, warn = console.warn } = {}) {
  /** @type {Record<string, string>} */
  const sources = {};
  /** @type {Record<string, string>} */
  const databaseUrls = {};
  for (const name of ['.env', '.env.local']) {
    const path = resolve(dir, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
      if (!match) continue;
      const value = cleanValue(match[2]);
      if (match[1] === 'TURSO_DATABASE_URL') databaseUrls[name] = value;
      if (env[match[1]] !== undefined) continue;
      env[match[1]] = value;
      sources[match[1]] = name;
    }
  }
  if (sources.TURSO_DATABASE_URL && databaseUrls['.env'] !== undefined && databaseUrls['.env.local'] !== undefined
    && databaseUrls['.env'] !== databaseUrls['.env.local']) {
    warn('Warning: .env and .env.local set different values for TURSO_DATABASE_URL. This script uses .env (Next.js would use .env.local). Set the variable in your shell to be sure which database you mean.');
  }
  return { sources };
}
