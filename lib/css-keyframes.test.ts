import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Keyframes are global: a second @keyframes with the same name silently
// replaces the first everywhere, as when the curtain call's stamp
// hijacked the saved-response stamp.
describe('stylesheet animations', () => {
  it('never define the same @keyframes name twice', () => {
    const appDirectory = new URL('../app/', import.meta.url);
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of readdirSync(appDirectory).filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(new URL(file, appDirectory), 'utf8');
      for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/gu)) {
        const first = seen.get(name);
        if (first) duplicates.push(`${name} (${first} and ${file})`);
        else seen.set(name, file);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
