import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function inspectInvocation(args) {
  if (process.platform !== 'win32') return { command: 'vercel', args };
  const candidates = [
    join(process.cwd(), 'node_modules', 'vercel', 'dist', 'vc.js'),
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'vercel', 'dist', 'vc.js') : '',
    process.env.npm_config_prefix ? join(process.env.npm_config_prefix, 'node_modules', 'vercel', 'dist', 'vc.js') : '',
  ].filter(Boolean);
  const cliPath = candidates.find((candidate) => existsSync(candidate));
  if (!cliPath) throw new Error('Windows remote preflight could not locate the Vercel CLI JavaScript entry point.');
  return { command: process.execPath, args: [cliPath, ...args] };
}

function normalizedOrigin(rawValue) {
  if (!rawValue?.trim()) throw new Error('Remote Playwright mode requires E2E_BASE_URL.');
  const parsed = new URL(rawValue.trim());
  if (parsed.protocol !== 'https:') throw new Error('Remote Playwright mode requires an https:// Preview origin.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new Error('E2E_BASE_URL must be an exact origin without credentials, a path, a query, or a fragment.');
  }
  return parsed.origin;
}

function runVercelInspect(origin) {
  const cliArgs = ['inspect', origin, '--json'];
  if (process.env.VERCEL_TOKEN?.trim()) cliArgs.push('--token', process.env.VERCEL_TOKEN.trim());
  const invocation = inspectInvocation(cliArgs);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Vercel deployment metadata lookup failed with exit code ${code ?? 'unknown'}${stderr.trim() ? '.' : ''}`));
        return;
      }
      const jsonStart = stdout.indexOf('{');
      if (jsonStart < 0) {
        reject(new Error('Vercel deployment metadata was not JSON.'));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(jsonStart)));
      } catch {
        reject(new Error('Vercel deployment metadata could not be parsed as JSON.'));
      }
    });
  });
}

async function checkedFetch(origin, path, headers) {
  const response = await fetch(`${origin}${path}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Remote preflight received a protection redirect for ${path}; provide the scoped VERCEL_AUTOMATION_BYPASS_SECRET.`);
  }
  return { response, contentType, body };
}

function parseJson(result, path) {
  if (!result.contentType.toLowerCase().includes('application/json')) {
    throw new Error(`Remote preflight received a non-JSON response for ${path} (HTTP ${result.response.status}).`);
  }
  try {
    return JSON.parse(result.body);
  } catch {
    throw new Error(`Remote preflight received invalid JSON for ${path} (HTTP ${result.response.status}).`);
  }
}

export async function runRemotePreflight() {
  const origin = normalizedOrigin(process.env.E2E_BASE_URL);
  const moderatorEmail = process.env.E2E_MODERATOR_EMAIL?.trim();
  const moderatorPassword = process.env.E2E_MODERATOR_PASSWORD ?? '';
  if (!moderatorEmail || !moderatorPassword || moderatorPassword.length < 12) {
    throw new Error('Remote Playwright mode requires E2E_MODERATOR_EMAIL and an E2E_MODERATOR_PASSWORD of at least 12 characters.');
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!bypass && process.env.E2E_ALLOW_UNPROTECTED_REMOTE !== 'yes') {
    throw new Error('Remote Playwright mode requires VERCEL_AUTOMATION_BYPASS_SECRET; set E2E_ALLOW_UNPROTECTED_REMOTE=yes only for a deliberately unprotected Preview.');
  }

  const metadata = await runVercelInspect(origin);
  if (metadata?.name !== 'watercooler-werewolf' || metadata?.target !== 'preview' || metadata?.readyState !== 'READY') {
    throw new Error(`Remote preflight refused deployment ${metadata?.id ?? 'unknown'}: target=${metadata?.target ?? 'unknown'}, state=${metadata?.readyState ?? 'unknown'}.`);
  }
  const expectedDeploymentId = process.env.E2E_VERCEL_DEPLOYMENT_ID?.trim();
  if (expectedDeploymentId && metadata.id !== expectedDeploymentId) {
    throw new Error(`Remote preflight deployment mismatch: expected ${expectedDeploymentId}, received ${metadata.id}.`);
  }

  const headers = {
    Origin: origin,
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
  };
  const publicEntry = await checkedFetch(origin, '/', headers);
  if (publicEntry.response.status !== 200 || !publicEntry.contentType.toLowerCase().includes('text/html')) {
    throw new Error(`Remote preflight public entry check failed with HTTP ${publicEntry.response.status}.`);
  }
  const bootstrapResponse = await checkedFetch(origin, '/api/moderators/bootstrap', headers);
  if (bootstrapResponse.response.status !== 200) {
    throw new Error(`Remote preflight bootstrap check failed with HTTP ${bootstrapResponse.response.status}.`);
  }
  const bootstrap = parseJson(bootstrapResponse, '/api/moderators/bootstrap');
  if (bootstrap.ok !== true || bootstrap.needsBootstrap === true) {
    throw new Error('Remote Preview is not provisioned with the fictional moderator account; run the existing operator bootstrap workflow before tests.');
  }
  const protectedApi = await checkedFetch(origin, '/api/games', headers);
  if (protectedApi.response.status !== 401) {
    throw new Error(`Remote preflight authentication check expected application HTTP 401 for /api/games, received ${protectedApi.response.status}.`);
  }
  parseJson(protectedApi, '/api/games');

  console.log(JSON.stringify({
    preflight: 'passed',
    deploymentId: metadata.id,
    target: metadata.target,
    readyState: metadata.readyState,
    origin,
    databaseMutation: 'not performed by preflight',
  }));
}
