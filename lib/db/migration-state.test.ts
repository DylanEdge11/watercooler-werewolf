import { describe, expect, it } from 'vitest';
import {
  alteredColumn,
  classifyInitialSchema,
  extractCreatedTableNames,
  makeCreateStatementIdempotent,
  splitMigrationStatements,
} from './migration-state';

describe('database migration state', () => {
  const sql = [
    'CREATE TABLE `games` (`id` text PRIMARY KEY NOT NULL);',
    'CREATE TABLE `action_submissions` (`id` text PRIMARY KEY NOT NULL);',
  ].join('\n--> statement-breakpoint\n');

  it('recognizes a hosted schema that was provisioned before the app ledger', () => {
    const expected = extractCreatedTableNames(sql);
    expect(expected).toEqual(['games', 'action_submissions']);
    expect(classifyInitialSchema(expected, ['games', 'action_submissions', '__app_migrations'])).toEqual({
      kind: 'COMPLETE',
    });
  });

  it('distinguishes an empty database from a dangerous partial schema', () => {
    const expected = extractCreatedTableNames(sql);
    expect(classifyInitialSchema(expected, ['__app_migrations'])).toEqual({ kind: 'EMPTY' });
    expect(classifyInitialSchema(expected, ['games'])).toEqual({
      kind: 'PARTIAL',
      present: ['games'],
      missing: ['action_submissions'],
    });
  });

  it('makes fresh-schema creates safe to repeat during concurrent startup', () => {
    expect(makeCreateStatementIdempotent('CREATE TABLE `games` (`id` text);')).toMatch(
      /^CREATE TABLE IF NOT EXISTS/,
    );
    expect(makeCreateStatementIdempotent('CREATE UNIQUE INDEX `idx_games` ON `games` (`id`);')).toMatch(
      /^CREATE UNIQUE INDEX IF NOT EXISTS/,
    );
    expect(makeCreateStatementIdempotent('CREATE INDEX IF NOT EXISTS idx_existing ON games(id);')).toBe(
      'CREATE INDEX IF NOT EXISTS idx_existing ON games(id);',
    );
  });

  it('identifies additive columns and preserves migration statement boundaries', () => {
    const statements = splitMigrationStatements(
      'ALTER TABLE games ADD COLUMN stopped_at TEXT;\n--> statement-breakpoint\nUPDATE games SET status = status;',
    );
    expect(alteredColumn(statements[0])).toEqual({ table: 'games', column: 'stopped_at' });
    expect(alteredColumn(statements[1])).toBeNull();
  });
});
