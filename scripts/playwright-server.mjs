import { mkdir } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, relative, resolve, sep } from 'node:path';
import { createClient } from '@libsql/client/node';
import { loadMigrations, runMigrations } from './db-migration-runner.mjs';

// tsx's temporary-directory helper falls back to os.userInfo() on Windows
// when process.geteuid is absent. Keep the e2e server usable on restricted
// runners where the passwd lookup can fail.
if (typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 1,
  });
}

const { tsImport } = await import('tsx/esm/api');

const projectRoot = process.cwd();
const port = Number(process.env.PORT ?? 3100);
const databasePath = resolve(
  projectRoot,
  process.env.E2E_DATABASE_PATH ?? `work/playwright/watercooler-${process.pid}-${Date.now()}.db`,
);
const databaseUrl = `file:./${relative(projectRoot, databasePath).split(sep).join('/')}`;
const disposableDatabaseFiles = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
const ownerEmail = process.env.E2E_MODERATOR_EMAIL ?? 'playwright-owner@e2e.test';
const ownerPassword = process.env.E2E_MODERATOR_PASSWORD ?? 'playwright-e2e-password-2026';

await mkdir(dirname(databasePath), { recursive: true });
process.env.TURSO_DATABASE_URL = databaseUrl;
const testServerOrigin = process.env.SITE_ORIGIN?.trim() || `http://localhost:${port}`;
process.env.SITE_ORIGIN = testServerOrigin;
process.env.WATERCOOLER_OWNER_EMAIL = ownerEmail;
// Use test mode so Next does not load a developer .env.local origin that can
// disagree with the disposable Playwright server origin.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.__NEXT_PROCESSED_ENV = 'true';

const [{ LibsqlDatabase }, { bootstrapPrimaryModerator, hasModeratorAccountInDatabase }] = await Promise.all([
  tsImport('../db/libsql.ts', import.meta.url),
  tsImport('../lib/auth/bootstrap.ts', import.meta.url),
]);

const client = createClient({ url: databaseUrl });
try {
  await runMigrations(client, await loadMigrations());
  const database = new LibsqlDatabase(client);
  if (!(await hasModeratorAccountInDatabase(database))) {
    await bootstrapPrimaryModerator(database, ownerEmail, ownerPassword);
  }
  await client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
} finally {
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 250));
}

process.once('exit', () => {
  for (const disposableDatabaseFile of disposableDatabaseFiles) {
    try {
      rmSync(disposableDatabaseFile, { force: true });
    } catch {
      // The test database is disposable; a locked file is safe to leave under work/.
    }
  }
});

// Keep Next in this process. The CLI starts a separate server child, which
// Playwright cannot reliably reap on Windows when it tears down webServer.
const { default: next } = await import('next');
const app = next({ dev: true, dir: projectRoot, hostname: '127.0.0.1', port });
const handle = app.getRequestHandler();
let server;
let shuttingDown = false;
let parentWatch;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (parentWatch) clearInterval(parentWatch);
  try {
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    }
    await app.close();
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.prepare();
// Next loads .env.local as part of prepare(). Re-assert the disposable server
// origin so API same-origin checks agree with the browser baseURL.
process.env.SITE_ORIGIN = testServerOrigin;
server = createServer((request, response) => handle(request, response));
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(port, '127.0.0.1', resolveListen);
});

// On Windows Playwright force-kills the intermediate cmd.exe process used by
// webServer, and the Node child can otherwise become orphaned. Reap this
// process when that parent disappears.
const parentPid = process.ppid;
parentWatch = setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    void shutdown();
  }
}, 250);
parentWatch.unref();
