import 'server-only';

import { createRequire } from 'node:module';
import { HttpError } from '../lib/http/errors';
import { createClient as createWebClient } from '@libsql/client/web';
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

  database ??= new LibsqlDatabase(createRawClient(url));
  return database;
}

/**
 * Deployed functions talk to Turso over HTTP with the web client, which has no
 * native code. Only a local `file:` or `:memory:` URL (development and local
 * test servers, refused above when deployed) loads the Node client and its
 * native SQLite binary, so it is required here rather than imported.
 */
function createRawClient(url: string): LibsqlClient {
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;
  if (isLocalDatabaseUrl(url)) {
    const { createClient } = createRequire(import.meta.url)('@libsql/client/node') as typeof import('@libsql/client/node');
    return createClient({ url, authToken }) as unknown as LibsqlClient;
  }
  return createWebClient({ url, authToken }) as unknown as LibsqlClient;
}

export { LibsqlDatabase } from './libsql';
export type { Database, PreparedStatement, QueryResult, RunResult } from './contracts';
