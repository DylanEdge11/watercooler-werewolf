import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A ballot ticket that moves on hover can slide out from under a resting
// pointer, lose the hover, slide back, and jitter every frame. Players see a
// flicker, and automated clicks wait forever for a still target.
describe('ballot ticket hover styles', () => {
  it('never move a candidate ticket', () => {
    const appDirectory = new URL('../app/', import.meta.url);
    const moving: string[] = [];
    for (const file of readdirSync(appDirectory).filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(new URL(file, appDirectory), 'utf8');
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        const hoverTicket = selector.split(',').some((part) => /\.candidate\b/u.test(part) && /:hover\b/u.test(part));
        const moves = /(^|;)\s*(transform|translate|rotate|scale)\s*:\s*(?!none\b)/u.test(body);
        if (hoverTicket && moves) moving.push(`${file}: ${selector.trim()}`);
      }
    }
    expect(moving).toEqual([]);
  });
});
