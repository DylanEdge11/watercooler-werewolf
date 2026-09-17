# Watercooler Werewolf: dummy Vercel setup guide

This is a proof-oriented setup guide for the migration. It uses fictional values where possible and keeps real passwords, database tokens, and recovery codes out of the repository and out of chat.

## What is already done

- Local `main` contains the migration at commit `14c60b5`.
- Vercel project `dyl-edge/watercooler-werewolf` exists with the Next.js preset, Node `22.x`, `npm ci`, and `npm run build`.
- The Vercel project currently has **no deployments**, so there is no live website URL to verify yet.
- The old Sites deployment/database are untouched.

The local `main` branch has not been pushed to GitHub. Either push it when you are ready, or deploy the local checkout with the Vercel CLI as shown below.

## Do I need to keep my home PC running?

No—not after the app is deployed.

| Situation | Does the home PC need to stay on? |
| --- | --- |
| Players and moderators using the deployed game | No. They only need a browser. |
| Vercel serving the web app | No. Vercel runs the application. |
| Turso/libSQL storing game data | No. The remote database is separate from your PC. |
| One-time migrations and first-owner bootstrap | The PC, or any computer with Node/CLI access, is used briefly. |
| Local-only `npm run dev` without Vercel/Turso | Yes. The PC is acting as the server, so it must remain online. |

For the intended setup, your PC is an operator workstation, not the game server. Use it for the initial database setup, migrations, owner bootstrap, and occasional maintenance. The production game continues running if the PC is turned off.

## What you need

1. Access to the Vercel `dyl-edge` team.
2. A free Turso/libSQL account and two separate databases: one for Preview and one for Production. Do not share a Production database with Preview.
3. A computer with Node 22.x and Git for the one-time operator steps.
4. A primary moderator email address.
5. A password manager for the one-time recovery codes. The bootstrap command prints them once; do not save them in Git.
6. A browser. No custom domain, email service, SSO provider, or always-on home server is required.

Turso's official quickstart covers database creation; its token command creates a token scoped to one database: [Turso quickstart](https://docs.turso.tech/quickstart) and [database tokens](https://docs.turso.tech/cli/db/tokens/create). The application uses the documented libSQL client result/batch model: [TypeScript SDK reference](https://docs.turso.tech/sdk/ts/reference).

## Proof A: run everything locally with dummy data

This proof does not touch Vercel, Turso Cloud, the old site, or real player data.

From the repository root (`project`):

```powershell
npm ci

$env:SITE_ORIGIN = 'http://localhost:3000'
$env:TURSO_DATABASE_URL = 'file:./work/watercooler.db'
$env:WATERCOOLER_OWNER_EMAIL = 'owner@example.test'

npm run db:migrate
npm run owner:bootstrap
npm run dev
```

When `owner:bootstrap` prompts, type a fictional password of at least 12 characters. It does not echo the password. Store the displayed recovery codes in a safe temporary place for the proof; they are intentionally displayed only once.

Open these pages:

1. `http://localhost:3000/` — anonymous landing page.
2. `http://localhost:3000/player-login` — player credential screen.
3. `http://localhost:3000/moderator` — moderator sign-in.

In a second PowerShell window, create the fictional 20-player game:

```powershell
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_EMAIL = 'owner@example.test'
$env:PILOT_MODERATOR_PASSWORD = 'fictional-owner-password'
npm run pilot:setup
npm run pilot:rehearsal
```

The rehearsal should report 10/10 checks. Keep the generated invite CSV private, use separate browser profiles for fictional players, and delete the CSV after the proof. Stop the local server with `Ctrl+C` when finished.

## Proof B: create a real Vercel Preview

This proof uses a real remote database but still uses fictional game/player data. It is the first step that needs your Turso account access.

### 1. Create a Preview database

Install and authenticate the Turso CLI using the official instructions, then use a unique name:

```powershell
turso auth login
turso db create watercooler-werewolf-preview
turso db show watercooler-werewolf-preview --url
turso db tokens create watercooler-werewolf-preview
```

The URL and token printed by Turso are secrets/credentials. Put them in a password manager or directly into the Vercel environment-variable prompts. Do not put them in `.env.example`, Git, or chat.

### 2. Link the local checkout to Vercel

```powershell
vercel link --yes --project watercooler-werewolf --scope dyl-edge
```

The project is already linked in this checkout, but running the command again is safe if setting up another computer. Check the target with:

```powershell
vercel project inspect watercooler-werewolf --scope dyl-edge
```

### 3. Add Preview environment variables

Use `vercel env add` interactively so values do not appear in the command history. Select the `preview` environment for each:

```powershell
vercel env add TURSO_DATABASE_URL preview
vercel env add TURSO_AUTH_TOKEN preview
vercel env add SITE_ORIGIN preview
vercel env add WATERCOOLER_OWNER_EMAIL preview
```

For the first proof, set `SITE_ORIGIN` to the exact HTTPS origin you will use for the Preview deployment. If the deployment URL is not known yet, perform one harmless first deployment to obtain it, set `SITE_ORIGIN` to that exact URL, and redeploy before testing mutations. Do not include a trailing path such as `/moderator`; the value is an origin like `https://example.vercel.app`.

Do not add `CRON_SECRET` for the Hobby proof. The moderator Operations panel is the supported deadline fallback. Add it only if you deliberately configure an external authenticated scheduler.

Review variable names without printing values:

```powershell
vercel env ls preview
```

### 4. Initialize the Preview database from the operator PC

In a temporary operator shell, set the Preview URL/token and owner email. The following values are placeholders only:

```powershell
$env:TURSO_DATABASE_URL = '<preview-turso-url>'
$env:TURSO_AUTH_TOKEN = '<preview-database-token>'
$env:WATERCOOLER_OWNER_EMAIL = 'owner@example.test'

npm run db:migrate
npm run owner:bootstrap
```

Use the hidden password prompt. Run this once for the fresh Preview database. The scripts refuse to run from Vercel and do not run migrations from normal requests or builds.

### 5. Deploy the Preview

Before pushing to GitHub, you can deploy the current local `main` checkout directly:

```powershell
vercel deploy --yes --scope dyl-edge
```

Copy the URL returned by Vercel into your notes. That is the URL to verify in the browser. If `SITE_ORIGIN` was changed after the first deployment, deploy once more after updating the Preview variable.

If you prefer Git-based deployments, push the already-merged local branch after reviewing it:

```powershell
git push origin main
```

Vercel can then build from the connected repository. This push is a separate GitHub action from the local merge already completed.

### 6. Run the fictional Preview proof

Open the exact Preview URL and verify:

1. Landing and player-login pages load anonymously.
2. `/api/games` rejects an anonymous request with HTTP 401.
3. `/moderator` accepts the bootstrapped moderator credentials.
4. `pilot:setup` can target the Preview only with explicit fictional-data flags:

```powershell
$env:PILOT_BASE_URL = 'https://<preview-url>'
$env:PILOT_ALLOW_REMOTE = 'yes'
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_EMAIL = 'owner@example.test'
$env:PILOT_MODERATOR_PASSWORD = 'fictional-owner-password'
npm run pilot:setup
npm run pilot:rehearsal
```

Replace the angle-bracket placeholder with the actual URL. The two commands create and exercise disposable game data; they do not send email or invite real players.

If the Preview deployment has Vercel Authentication or Deployment Protection enabled, the terminal helper will receive a 401 Protected deployment response before it reaches the app. In the project dashboard, open **Settings → Deployment Protection → Protection Bypass for Automation**, create a bypass secret, and keep it private. In the temporary operator shell, set it alongside the pilot variables:

    $env:VERCEL_AUTOMATION_BYPASS_SECRET = '<vercel-automation-bypass-secret>'

The pilot helpers send this value only as Vercel's x-vercel-protection-bypass request header. Do not commit it, add it to a client-visible environment variable, or use it with the Production URL. Remove it from the shell after the rehearsal with Remove-Item Env:VERCEL_AUTOMATION_BYPASS_SECRET.

Inspect the deployment after the proof:

```powershell
vercel inspect <preview-url> --scope dyl-edge
vercel logs <preview-url> --scope dyl-edge
```

Do not call the Preview production-ready until remote persistence, authentication isolation, player privacy, reset/recovery behavior, and the browser checks in `MIGRATION_PROGRESS.md` have passed.

## Production setup after Preview approval

1. Create a separate database, for example `watercooler-werewolf-production`.
2. Generate a separate database token.
3. Add the following variables to the Vercel `production` environment, never to Preview:

   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `SITE_ORIGIN` (the exact final `https://...vercel.app` origin)
   - `WATERCOOLER_OWNER_EMAIL`
   - optional `CRON_SECRET`

4. Run `npm run db:migrate` from the operator PC against the Production database.
5. Run `npm run owner:bootstrap` once against the Production database and store its recovery codes.
6. Deploy with `vercel deploy --prod --yes --scope dyl-edge` only after the Preview proof passes.
7. Run a small fictional smoke test. Do not copy Preview data into Production.

Vercel environment variables are scoped independently to Preview and Production; the [Vercel environment-variable guide](https://vercel.com/docs/environment-variables) documents the dashboard and CLI workflow. Keep all database credentials server-only; never prefix them with `NEXT_PUBLIC_`.

## What happens during normal play

- Vercel serves the UI and API routes.
- Turso/libSQL stores games, claims, sessions, roles, ballots, chat, audit events, and backups.
- Players use private claim links/PINs in their browsers.
- Moderators use the app-owned moderator login.
- Server-side deadlines remain enforced even when the Operations polling fallback is used.
- The moderator console can reconcile due phases; no always-on home computer is involved.

## If you do not want to use Turso yet

Use Proof A locally. In that mode, the home PC is the temporary server and must stay on while people play. Do not expose that local server to the public internet, and do not treat it as durable production hosting. The Vercel deployment requires a remote database because deployed functions must not write to a local `file:` database.

## Stop, rollback, and recovery

- Stop a local proof with `Ctrl+C`.
- Roll back the application by selecting a previous Vercel deployment or redeploying a known-good commit.
- Application rollback does not roll back Turso data or schema. Keep backups and inspect the migration ledger before changing a database.
- Keep the old Sites deployment/database untouched until the new Production proof is accepted.
