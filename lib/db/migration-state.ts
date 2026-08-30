export type InitialSchemaState =
  | { kind: 'EMPTY' }
  | { kind: 'COMPLETE' }
  | { kind: 'PARTIAL'; present: string[]; missing: string[] };

export function splitMigrationStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function extractCreatedTableNames(sql: string): string[] {
  return splitMigrationStatements(sql)
    .map((statement) => statement.match(/^CREATE TABLE(?: IF NOT EXISTS)?\s+[`"]?([\w]+)[`"]?/i)?.[1])
    .filter((name): name is string => Boolean(name));
}

export function classifyInitialSchema(expectedTables: string[], existingTables: Iterable<string>): InitialSchemaState {
  const existing = new Set(existingTables);
  const present = expectedTables.filter((table) => existing.has(table));
  if (present.length === 0) return { kind: 'EMPTY' };

  const missing = expectedTables.filter((table) => !existing.has(table));
  if (missing.length === 0) return { kind: 'COMPLETE' };
  return { kind: 'PARTIAL', present, missing };
}

export function makeCreateStatementIdempotent(statement: string): string {
  return statement
    .replace(/^CREATE TABLE\s+(?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE UNIQUE INDEX\s+(?!IF NOT EXISTS)/i, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/^CREATE INDEX\s+(?!IF NOT EXISTS)/i, 'CREATE INDEX IF NOT EXISTS ');
}

export function alteredColumn(statement: string): { table: string; column: string } | null {
  const match = statement.match(
    /^ALTER TABLE\s+[`"]?([\w]+)[`"]?\s+ADD COLUMN\s+[`"]?([\w]+)[`"]?/i,
  );
  return match ? { table: match[1], column: match[2] } : null;
}
