import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const port = Number(process.env.PORT ?? 3100);
const baseUrl = process.env.E2E_BASE_URL?.trim() || `http://localhost:${port}`;
const serverCommand = resolve(projectRoot, 'scripts', 'playwright-server.mjs');
const playwrightCli = resolve(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const databasePath = resolve(projectRoot, 'work', 'playwright', `watercooler-runner-${process.pid}-${Date.now()}.db`);

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playwright server exited before becoming ready (code ${child.exitCode ?? 'unknown'}).`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/moderators/bootstrap`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

async function stopProcess(child) {
  if (!child.pid || child.exitCode !== null) return;
  const exit = waitForExit(child);
  if (process.platform === 'win32') {
    child.kill();
    await Promise.race([
      exit,
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
    ]);
  }
  if (child.exitCode === null && process.platform === 'win32') {
    await new Promise((resolveKill) => {
      const killer = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Stop-Process -Id ${child.pid} -Force -ErrorAction SilentlyContinue`,
      ], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', resolveKill);
      killer.once('error', resolveKill);
    });
  } else if (child.exitCode === null) {
    child.kill('SIGTERM');
  }
  await Promise.race([
    exit,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
}

const server = spawn(process.execPath, [serverCommand], {
  cwd: projectRoot,
  env: {
    ...process.env,
    E2E_MODERATOR_EMAIL: process.env.E2E_MODERATOR_EMAIL ?? 'playwright-owner@e2e.test',
    E2E_MODERATOR_PASSWORD: process.env.E2E_MODERATOR_PASSWORD ?? 'playwright-e2e-password-2026',
    E2E_DATABASE_PATH: databasePath,
    PORT: String(port),
    SITE_ORIGIN: baseUrl,
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
  windowsHide: true,
});

let result = { code: 1, signal: null };
try {
  await waitForServer(server);
  const runner = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: { ...process.env, PLAYWRIGHT_REUSE_SERVER: '1' },
    stdio: 'inherit',
    windowsHide: true,
  });
  result = await waitForExit(runner);
} finally {
  await stopProcess(server);
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    rmSync(path, { force: true });
  }
}

process.exitCode = result.code ?? 1;
