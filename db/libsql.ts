import type {
  Database,
  PreparedStatement,
  QueryResult,
  RunResult,
  SqlValue,
} from './contracts';

export interface LibsqlStatement {
  sql: string;
  args: Array<
    | string
    | number
    | bigint
    | boolean
    | null
    | Uint8Array
    | ArrayBuffer
  >;
}

export interface LibsqlResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
  lastInsertRowid?: bigint | number | string;
}

export interface LibsqlClient {
  execute(statement: string | LibsqlStatement): Promise<LibsqlResult>;
  batch(
    statements: LibsqlStatement[],
    mode?: 'write' | 'read' | 'deferred',
  ): Promise<LibsqlResult[]>;
}

function normalizeArgument(value: SqlValue): LibsqlStatement['args'][number] {
  return value === undefined ? null : value;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint' && Number.isSafeInteger(Number(value))) {
    return Number(value);
  }
  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]),
  );
}

function resultMeta(result: LibsqlResult) {
  return {
    changes: Number(result.rowsAffected ?? 0),
    lastRowId:
      result.lastInsertRowid === undefined
        ? undefined
        : (normalizeValue(result.lastInsertRowid) as number | bigint | string),
  };
}

function toQueryResult(result: LibsqlResult): QueryResult {
  return {
    results: result.rows.map(normalizeRow),
    columns: result.columns,
    meta: resultMeta(result),
    success: true,
  };
}

function toRunResult(result: LibsqlResult): RunResult {
  return {
    results: [],
    columns: result.columns,
    meta: resultMeta(result),
    success: true,
  };
}

class LibsqlPreparedStatement implements PreparedStatement {
  private values: LibsqlStatement['args'] = [];

  constructor(
    private readonly client: LibsqlClient,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): this {
    this.values = values.map(normalizeArgument);
    return this;
  }

  async first<Row = Record<string, unknown>>(): Promise<Row | null> {
    const result = await this.client.execute(this.statement());
    const row = result.rows[0];
    return row ? (normalizeRow(row) as Row) : null;
  }

  async all<Row = Record<string, unknown>>(): Promise<QueryResult<Row>> {
    return toQueryResult(
      await this.client.execute(this.statement()),
    ) as QueryResult<Row>;
  }

  async run(): Promise<RunResult> {
    return toRunResult(await this.client.execute(this.statement()));
  }

  toLibsqlStatement(): LibsqlStatement {
    return this.statement();
  }

  private statement(): LibsqlStatement {
    return { sql: this.sql, args: this.values };
  }
}

export class LibsqlDatabase implements Database {
  constructor(private readonly client: LibsqlClient) {}

  prepare(sql: string): LibsqlPreparedStatement {
    return new LibsqlPreparedStatement(this.client, sql);
  }

  async batch(statements: PreparedStatement[], mode: 'write' | 'read' = 'write'): Promise<Array<QueryResult | RunResult>> {
    const requests = statements.map((statement) => {
      if (!(statement instanceof LibsqlPreparedStatement)) {
        throw new TypeError(
          'LibsqlDatabase.batch only accepts statements created by this database.',
        );
      }
      return statement.toLibsqlStatement();
    });

    const results = await this.client.batch(requests, mode);
    return results.map((result) =>
      result.rows.length || result.columns.length
        ? toQueryResult(result)
        : toRunResult(result),
    );
  }
}
