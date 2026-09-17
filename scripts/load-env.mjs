import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load local examples for standalone operator scripts without overriding CI/Vercel values. */
export function loadLocalEnv() {
  for (const name of ['.env', '.env.local']) {
    const path = resolve(name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/u, '$2');
      process.env[match[1]] = value;
    }
  }
}
