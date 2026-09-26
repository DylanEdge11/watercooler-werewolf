/**
 * The application-facing SQLite contract.
 *
 * Routes deliberately depend on this small interface instead of a hosting
 * provider's request or result types. The production implementation adapts
 * Turso/libSQL's HTTP client while the domain tests can use an in-memory
 * implementation with the same transaction semantics.
 */
export type SqlValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Uint8Array
  | ArrayBuffer;

export interface ResultMeta {
  changes: number;
  lastRowId?: number | bigint | string;
}

export interface QueryResult<Row = Record<string, unknown>> {
  results: Row[];
  columns?: string[];
  meta?: ResultMeta;
  success?: boolean;
}

export interface RunResult {
  results: unknown[];
  columns?: string[];
  meta: ResultMeta;
  success?: boolean;
}

export interface PreparedStatement {
  bind(...values: SqlValue[]): PreparedStatement;
  first<Row = Record<string, unknown>>(): Promise<Row | null>;
  all<Row = Record<string, unknown>>(): Promise<QueryResult<Row>>;
  run(): Promise<RunResult>;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  /**
   * Execute all statements sequentially in one database transaction. A `read`
   * batch is a read-only transaction: every statement sees the same snapshot.
   */
  batch(statements: PreparedStatement[], mode?: 'write' | 'read'): Promise<Array<QueryResult | RunResult>>;
}
