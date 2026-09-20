import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { runRemotePreflight } from './playwright-remote-preflight.mjs';

const projectRoot = process.cwd();
const port = Number(process.env.PORT ?? 3100);
const playwrightCli = resolve(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const remoteFlag = process.argv.includes('--remote');
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== '--remote');
const remoteMode = remoteFlag || process.env.E2E_REMOTE === '1';
const runId = (process.env.E2E_RUN_ID?.trim() || `${remoteMode ? 'remote' : 'local'}-${process.pid}-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 80);

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function runPlaywright(args, env) {
  const runner = spawn(process.execPath, [playwrightCli, 'test', ...args], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  return waitForExit(runner);
}

async function waitForServer(child, baseUrl) {
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

async function runRemote() {
  process.env.E2E_REMOTE = '1';
  process.env.E2E_RUN_ID = runId;
  await runRemotePreflight();
  const result = await runPlaywright(playwrightArgs, {
    ...process.env,
    E2E_REMOTE: '1',
    E2E_RUN_ID: runId,
  });
  process.exitCode = result.code ?? 1;
}

async function runLocal() {
  if (process.env.E2E_BASE_URL?.trim() && !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/iu.test(process.env.E2E_BASE_URL.trim())) {
    throw new Error('E2E_BASE_URL points to a remote origin. Use `--remote` or E2E_REMOTE=1 so the local server and database are not started.');
  }
  const baseUrl = process.env.E2E_BASE_URL?.trim() || `http://localhost:${port}`;
  const serverCommand = resolve(projectRoot, 'scripts', 'playwright-server.mjs');
  const databasePath = resolve(projectRoot, 'work', 'playwright', `watercooler-runner-${process.pid}-${Date.now()}.db`);
  const server = spawn(process.execPath, [serverCommand], {
    cwd: projectRoot,
    env: {
      ...process.env,
      E2E_MODERATOR_EMAIL: process.env.E2E_MODERATOR_EMAIL ?? 'playwright-owner@e2e.test',
      E2E_MODERATOR_PASSWORD: process.env.E2E_MODERATOR_PASSWORD ?? 'playwright-e2e-password-2026',
      E2E_DATABASE_PATH: databasePath,
      E2E_RUN_ID: runId,
      PORT: String(port),
      SITE_ORIGIN: baseUrl,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
    windowsHide: true,
  });

  let result = { code: 1, signal: null };
  try {
    await waitForServer(server, baseUrl);
    result = await runPlaywright(playwrightArgs, { ...process.env, PLAYWRIGHT_REUSE_SERVER: '1', E2E_RUN_ID: runId });
  } finally {
    await stopProcess(server);
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      rmSync(path, { force: true });
    }
  }
  process.exitCode = result.code ?? 1;
}

if (remoteMode) await runRemote();
else await runLocal();
