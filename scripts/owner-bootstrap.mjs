import './lib/stable-euid.mjs';
import { stdin, stdout } from 'node:process';
import { loadLocalEnv } from './load-env.mjs';
import { confirmDatabaseTarget, envSource } from './lib/target-database.mjs';

const { sources } = loadLocalEnv();

function readHiddenSecret(prompt) {
  if (!stdin.isTTY || !stdout.isTTY) {
    const value = process.env.WATERCOOLER_OWNER_PASSWORD;
    if (!value) {
      throw new Error(
        'Run owner:bootstrap interactively, or provide WATERCOOLER_OWNER_PASSWORD through a secure operator-only environment.',
      );
    }
    return Promise.resolve(value);
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Operator bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          stdout.write('\n');
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

const ownerEmail = process.env.WATERCOOLER_OWNER_EMAIL?.trim();
const url = process.env.TURSO_DATABASE_URL?.trim();
if (!ownerEmail) throw new Error('Set WATERCOOLER_OWNER_EMAIL before bootstrapping the primary moderator.');
if (!url) throw new Error('Set TURSO_DATABASE_URL before bootstrapping the primary moderator.');
if (process.env.VERCEL === '1') {
  throw new Error('Run the one-time bootstrap from a trusted operator machine, not inside a deployed function.');
}

await confirmDatabaseTarget({ url, source: envSource(sources, 'TURSO_DATABASE_URL') });

const password = await readHiddenSecret('Primary moderator password: ');
const confirmation = await readHiddenSecret('Repeat password: ');
if (password !== confirmation) throw new Error('The password entries do not match.');

const { tsImport } = await import('tsx/esm/api');
const [{ createClient }, { LibsqlDatabase }, { bootstrapPrimaryModerator }, { loadMigrations, runMigrations }] = await Promise.all([
  import('@libsql/client'),
  tsImport('../db/libsql.ts', import.meta.url),
  tsImport('../lib/auth/bootstrap.ts', import.meta.url),
  import('./db-migration-runner.mjs'),
]);

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
});

try {
  await runMigrations(client, await loadMigrations());
  const moderator = await bootstrapPrimaryModerator(
    new LibsqlDatabase(client),
    ownerEmail,
    password,
  );
  console.log(`Primary moderator created for ${moderator.email}.`);
  console.log('Store these one-time recovery codes in the approved operator secret store:');
  console.log(moderator.recoveryCodes.join('\n'));
  console.log('The recovery codes will not be displayed again.');
} finally {
  client.close();
}
