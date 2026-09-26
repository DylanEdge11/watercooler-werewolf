import 'server-only';

import { HttpError } from '../lib/http/errors';
import { createClient } from '@libsql/client/node';
import {
  LibsqlDatabase,
  type LibsqlClient,
} from './libsql';

function isLocalDatabaseUrl(url: string): boolean {
  return url === ':memory:' || url.startsWith('file:');
}

let database: LibsqlDatabase | undefined;

export function getDb(): LibsqlDatabase {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url) {
    throw new HttpError(
      503,
      'TURSO_DATABASE_URL is not configured. Run the explicit database migration command and configure the deployment environment.',
    );
  }
  if (
    (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') &&
    isLocalDatabaseUrl(url)
  ) {
    throw new HttpError(
      503,
      'A writable local database URL is not allowed in a deployed function. Configure the remote Turso/libSQL database.',
    );
  }

  database ??= new LibsqlDatabase(
    createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    }) as unknown as LibsqlClient,
  );
  return database;
}

export { LibsqlDatabase } from './libsql';
export type { Database, PreparedStatement, QueryResult, RunResult } from './contracts';
