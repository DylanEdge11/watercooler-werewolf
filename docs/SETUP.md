# Setup and deployment

For the site operator: the person who installs Watercooler Werewolf, manages Vercel and Turso, and creates the first moderator account. Players and moderators should read the in-app guide at `/guide` instead.

Keep real passwords, database tokens, and recovery codes out of Git and out of chat. Every value below is a placeholder.

## How the pieces fit

| Piece | Role |
| --- | --- |
| Vercel (project `watercooler-werewolf`, team `dyl-edge`) | Hosts the Next.js app. Preview deployments are built from every pushed branch; Production is built from `main`. |
| Turso/libSQL | Stores all game data. Preview and Production each have their own database and credentials. |
| Operator computer | Used briefly for migrations, the first moderator account, and maintenance. It does not need to stay on while people play. |

Local development (`npm run dev` with a `file:` database) is the only mode where your computer is the server.

## Requirements

- Node.js 24.x LTS and Git. `.nvmrc` pins 24.
- Access to the Vercel `dyl-edge` team and the Vercel CLI.
- A Turso account and the Turso CLI ([quickstart](https://docs.turso.tech/quickstart)).
- A password manager for recovery codes, which are shown once.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | Yes | libSQL URL. Use `file:./work/watercooler.db` locally; deployed functions refuse `file:` URLs and reach Turso over HTTP with the libSQL web client, so they don't ship the native SQLite binary. |
| `TURSO_AUTH_TOKEN` | Remote only | Token scoped to that one database. |
| `SITE_ORIGIN` | Recommended | Exact origin players use, such as `https://watercooler-werewolf.vercel.app`, with no path. Browser writes from any other origin are rejected. If unset, each request's own origin is used, which still blocks other sites; set it in Production so writes through any other hostname are refused. Claim links always use the address the moderator is on. |
| `WATERCOOLER_OWNER_EMAIL` | For bootstrap | Email for the first moderator account. |
| `CRON_SECRET` | Optional | Enables `/api/scheduler/deadlines` for Vercel Cron or an external scheduler. See [Scheduler](#scheduler). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | Optional | Turns on **Email invites**. `SMTP_PORT` defaults to 465. Without all of them, moderators use the invite CSV. See [Invite email](#invite-email). |

Set variables separately for `preview` and `production` in Vercel. Never prefix database credentials with `NEXT_PUBLIC_`. See `.env.example` for local and test variables.

## Run locally

```powershell
npm ci
$env:SITE_ORIGIN = 'http://localhost:3000'
$env:TURSO_DATABASE_URL = 'file:./work/watercooler.db'
$env:WATERCOOLER_OWNER_EMAIL = 'owner@example.test'
npm run db:migrate
npm run owner:bootstrap
npm run dev
```

`owner:bootstrap` prompts for a password (12+ characters, not echoed) and prints eight recovery codes once. Then open `http://localhost:3000/`, `/player-login`, `/moderator`, and `/guide`.

To fill the local game with 20 fictional players, see [Testing](TESTING.md#rehearse-a-game).

## Set up a Preview environment

Do this once per fresh environment. Do not repeat migrations or bootstrap against a database that already hosts games unless you are applying a new migration.

1. **Create the database.**

   ```powershell
   turso auth login
   turso db create watercooler-werewolf-preview
   turso db show watercooler-werewolf-preview --url
   turso db tokens create watercooler-werewolf-preview
   ```

   Treat the URL and token as secrets.

2. **Link the checkout and add variables.** `vercel env add` prompts for each value, which keeps it out of shell history.

   ```powershell
   vercel link --yes --project watercooler-werewolf --scope dyl-edge
   vercel env add TURSO_DATABASE_URL preview
   vercel env add TURSO_AUTH_TOKEN preview
   vercel env add SITE_ORIGIN preview
   vercel env add WATERCOOLER_OWNER_EMAIL preview
   vercel env ls preview
   ```

   If you don't know the Preview URL yet, deploy once, set `SITE_ORIGIN` to that exact origin, and redeploy.

3. **Migrate and create the first moderator** from a temporary shell pointed at the Preview database:

   ```powershell
   $env:TURSO_DATABASE_URL = '<preview-turso-url>'
   $env:TURSO_AUTH_TOKEN = '<preview-database-token>'
   $env:WATERCOOLER_OWNER_EMAIL = 'owner@example.test'
   npm run db:migrate
   npm run owner:bootstrap
   ```

   Both scripts refuse to run inside Vercel. `scripts/load-env.mjs` also reads `.env` and `.env.local` for unset variables, so set both database variables explicitly.

4. **Deploy.** Push a branch; the Vercel Git integration builds a Preview.

5. **Check it.** The landing page and `/player-login` load, anonymous `GET /api/games` returns 401, and `/moderator` accepts the bootstrapped account. For a fuller check, see [Testing](TESTING.md).

If Deployment Protection is on, scripts need a **Protection Bypass for Automation** secret (Vercel project **Settings → Deployment Protection**), sent as `VERCEL_AUTOMATION_BYPASS_SECRET`. Never use it with Production.

## Invite email

The moderator console can email each unclaimed player their private claim link. It sends through any SMTP account, so changing sender later is a settings change, not a code change. Set the variables for `preview` and `production` separately, and prefer a test account for Preview.

**With a Gmail account (no domain needed):**

1. Turn on 2-Step Verification for the Google account, then create an **App password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Google shows the 16-character password once.
2. Add the variables (each command prompts for the value):

   ```powershell
   vercel env add SMTP_HOST production      # smtp.gmail.com
   vercel env add SMTP_USER production      # the full Gmail address
   vercel env add SMTP_PASSWORD production  # the app password
   vercel env add EMAIL_FROM production     # Watercooler Werewolf <the same Gmail address>
   ```

3. Redeploy so the new values take effect. The console's **Email invites** button is enabled once all four are set.

Gmail sends at most about 500 messages a day and always shows the Gmail address as the sender. Anyone holding the app password can send mail as that account; revoke it from the same Google page if it leaks.

**Moving to your own domain later:** create an account with a sending provider (for example Resend), verify the domain with the DNS records the provider gives you, and replace the values. For Resend: `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`, `SMTP_PASSWORD` = an API key, `EMAIL_FROM=Watercooler Werewolf <werewolf@your-domain>`. Redeploy, then remove the Gmail app password.

**Behaviour to know:**

- Sending gives the player a fresh link. Their previous link, including the one in the invite CSV, stops working.
- The app signs in to the mail server before changing any links, so a wrong password changes nothing.
- Addresses on reserved test domains (`.test`, `.example`, `.invalid`, `.localhost`, `example.com`) are never emailed, so rehearsal rosters don't bounce into the sender's inbox.

## Set up Production

1. Create a separate database, such as `watercooler-werewolf-production`, and its own token.
2. Add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SITE_ORIGIN`, `WATERCOOLER_OWNER_EMAIL`, and optionally `CRON_SECRET` and the [invite email](#invite-email) variables to the `production` environment only.
3. Run `npm run db:migrate`, then `npm run owner:bootstrap` once, against the Production database. Store the recovery codes.
4. Confirm `main` is the Vercel Production Branch. Production deploys are built from `main`; never promote a Preview deployment, because Preview uses a different database.
5. Run a small fictional smoke test. Never copy Preview data into Production.

## Release a change

Work happens on a version branch named `version-X.Y`, never directly on `main`. Feature branches start from the version branch and merge back into it. After a release, the next version branch is created from `main`.

Routine releases go through `main`:

1. Verify the candidate on Preview. See [Testing](TESTING.md#release-checks).
2. **If the change adds a migration, migrate Production first.** Every API route refuses to serve when the database lacks a migration listed in `db/readiness.ts`, so deploying first takes the site down until the migration runs. Keep migrations additive, such as new tables or nullable columns, so the code already on `main` keeps working against the migrated schema.
3. Merge to `main`. Vercel builds and deploys Production.
4. Confirm the deployment is `READY`, the landing page loads, anonymous `GET /api/games` returns 401, and runtime logs are clean.

## Scheduler

Automatic results never depend on a cron: each due step runs on the next visit to the moderator console or a player dashboard. A scheduler only makes steps happen when nobody is looking, for example a result that should publish overnight.

`vercel.json` asks Vercel Cron to call `/api/scheduler/deadlines` once a day, which is all the Hobby plan allows. Vercel sends `CRON_SECRET` as a Bearer token, so set `CRON_SECRET` in the Production environment. For timely automatic results without visits, point a free external scheduler (for example cron-job.org) at `GET https://<your-site>/api/scheduler/deadlines` every five minutes with the header `Authorization: Bearer <CRON_SECRET>`. Never paste the secret into chat or commit it.

## Schema changes

1. Edit `db/schema.ts` and run `npm run db:generate`. Inspect the SQL under `drizzle/`.
2. Add the new file to `MIGRATION_FILES` in `scripts/db-migration-runner.mjs` **and** its version to `MIGRATION_VERSIONS` in `db/readiness.ts`. `db:generate` does not update these lists.
3. Run `lib/db/migrations.test.ts`.
4. Apply with `npm run db:migrate` to Preview, then to Production before release.

The migration runner records each version in `__app_migrations` and refuses to repair a partially applied initial schema.

## Claude Code cloud sessions

Cloud sessions start from a fresh container, so the environment needs this configuration. Set it from the cloud environment menu in the session's title bar, under **Edit**:

- **Network access:** allow `*.vercel.app`, `vercel.com`, `api.vercel.com`, `*.turso.io`, and, for the Playwright browser download, `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`.
- **Environment variables:** `VERCEL_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `E2E_MODERATOR_EMAIL`, `E2E_MODERATOR_PASSWORD`, `PREVIEW_TURSO_DATABASE_URL`, and `PREVIEW_TURSO_AUTH_TOKEN`. The `PREVIEW_` prefix keeps local test runs from picking up the real Preview database. Never add Production database credentials.
- **Setup script:** install Node 24 and the Vercel CLI:

  ```sh
  set -euxo pipefail
  # The image's Node 22 in /opt/node22/bin comes first on PATH, so upgrade it in place.
  N_PREFIX=/opt/node22 npx -y n 24
  node --version
  npm install -g vercel
  ```

  The folder keeps its `node22` name but contains Node 24. The setup script does not run inside the repository, so project steps belong in the hook below.

The repository's SessionStart hook (`.claude/settings.json`, `scripts/claude-session-start.sh`) runs `npm ci` when `node_modules` is missing or out of date, then installs the matching Playwright Chromium.

## Roll back

Select an earlier deployment in Vercel, or redeploy a known-good commit. **A rollback does not undo database changes.** Take a backup (see [Operations](OPERATIONS.md#backups)) and check the migration ledger before changing a database.
