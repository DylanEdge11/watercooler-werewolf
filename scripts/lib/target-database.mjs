// Says which database (or app) an operator script is about to change, and makes the operator confirm a
// remote one. Nothing here ever prints a token or the query string of a URL.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

/** What a libSQL URL points at, described without credentials. */
export function describeDatabaseTarget(rawUrl) {
  const url = String(rawUrl).trim();
  if (url === ':memory:') return { remote: false, display: 'an in-memory database', host: null };
  if (url.startsWith('file:')) {
    const path = url.slice('file:'.length).replace(/^\/\//u, '').split('?', 1)[0];
    return { remote: false, display: `the local file ${resolve(path)}`, host: null };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TURSO_DATABASE_URL is not a valid URL. It must start with libsql://, https://, wss:// or file:.');
  }
  return { remote: true, display: `${parsed.protocol}//${parsed.host}`, host: parsed.hostname };
}

/** "the file .env.local", or "the shell environment" when the variable was already set there. */
export function envSource(sources, name) {
  return sources?.[name] ? `the file ${sources[name]}` : 'the shell environment';
}

function givenHost(argv, env) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--confirm-host=')) return argv[i].slice('--confirm-host='.length);
    if (argv[i] === '--confirm-host') return argv[i + 1] ?? '';
  }
  return env.CONFIRM_HOST;
}

async function askOnTerminal(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** @typedef {Record<string, string | undefined>} Env */

/**
 * @typedef {object} ConfirmOptions
 * @property {string[]} [argv]
 * @property {Env} [env]
 * @property {boolean} [interactive]
 * @property {(question: string) => Promise<string>} [prompt]
 */

/**
 * Makes the operator name a remote host before a script changes it: pass `--confirm-host=<host>` (or set
 * CONFIRM_HOST) when running without a terminal, or type the host at the prompt. A mismatch stops the run.
 * @param {ConfirmOptions & { label: string, host: string }} options
 */
export async function confirmRemoteHost({
  label,
  host,
  argv = process.argv.slice(2),
  env = process.env,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prompt = askOnTerminal,
}) {
  const given = givenHost(argv, env);
  if (given !== undefined && given !== '') {
    if (given.trim().toLowerCase() !== host.toLowerCase()) {
      throw new Error(`The confirmed host (${given}) is not the ${label} host (${host}). Nothing was changed.`);
    }
    return;
  }
  if (!interactive) {
    throw new Error(`The ${label} is remote (${host}). Pass --confirm-host=${host} (or set CONFIRM_HOST=${host}) to say you mean it. Nothing was changed.`);
  }
  const typed = await prompt(`The ${label} is remote. Type its host name (${host}) to continue: `);
  if (typed.trim().toLowerCase() !== host.toLowerCase()) throw new Error('That is not the host name. Nothing was changed.');
}

/**
 * Prints the target database and its source, and asks for confirmation when it is remote.
 * @param {ConfirmOptions & { url: string, source: string, log?: (message: string) => void }} options
 */
export async function confirmDatabaseTarget({ url, source, log = console.log, ...options }) {
  const target = describeDatabaseTarget(url);
  log(`Target database: ${target.display} (from ${source}).`);
  if (target.remote) await confirmRemoteHost({ label: 'database', host: target.host, ...options });
  return target;
}
