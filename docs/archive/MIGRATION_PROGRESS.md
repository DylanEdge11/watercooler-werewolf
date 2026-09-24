# Vercel migration progress

Last updated: 2026-09-23

## Current status

The application has been migrated to a native Next.js App Router application with a server-only libSQL database boundary. Local checks pass, and the hosted Preview environment now has a remote Turso database, environment variables, a Ready Vercel deployment, a working moderator login, and a fictional automated 20-player rehearsal with every check passing. A separate Production deployment exists but has no Production database credentials yet; it is not ready for real play.

The old Sites deployment and database were not modified or deleted. No paid plan, add-on, custom domain, live-data copy, email service, SSO provider, AI feature, or WebSocket was added. The operator-facing next-step proof is in [VERCEL_SETUP_GUIDE.md](VERCEL_SETUP_GUIDE.md).

## Decisions

- Target: native Next.js App Router on the Vercel Node.js runtime. The supported minimum is Node.js `>=24`; `.nvmrc` and CI use Node 24.x LTS as the verified baseline. Vercel deploys use the Node 24.x version selected by the package engine range.
- Database: free Turso/libSQL is the selected candidate. The application uses `@libsql/client` 0.18.0 through an application-owned contract. The ordered batch API, rollback behavior, affected-row metadata, SQLite SQL, foreign keys, and result mapping were exercised against an isolated real libSQL client/database. A remote Turso Preview database has now been created and exercised; a separate Production database remains an external gate.
- Cost: Vercel Hobby plus a free remote SQLite-compatible database remains the target for this personal, non-commercial pilot. No billable provisioning was performed.
- Scheduling: moderator-driven Operations reconciliation remains the supported low-cost path. Server-enforced cutoffs remain in the action endpoints. No minute-frequency cron was configured; the scheduler route accepts authenticated `GET` with `Bearer CRON_SECRET` and retains `POST` compatibility for an external caller.
- Data: start with a fresh database. Existing games are disposable, and no live-data migration was implemented.
- Bootstrap: initial moderator creation is an operator-only one-time command. Public first-owner creation and the former Sites identity-header trust path are disabled.

## Stage 1 — Inventory and target contract

Status: complete.

Implemented:

- Confirmed the actual Git repository root is `C:\Users\dylan\Documents\ChatGPT\Werewolf\project`, with `package.json` at that root; the outer `Werewolf` directory is only the workspace container.
- Created and switched to `codex/vercel-migration` from the assessment checkout. Unrelated user files were preserved.
- Recorded the starting baseline from the assessment: 73 tests in 23 files passed; lint, strict TypeScript, and the existing Vinext build passed. That build was not evidence of a native Next.js deployment.
- Audited the existing Cloudflare/Sites/Vinext integration, D1-shaped prepared statements, raw SQL, four migrations, environment names, authentication paths, scheduler route, and public/private API surface.
- Replaced the hosting-specific target with native Next.js + Node + remote SQLite-compatible persistence while preserving the existing routes, UI, game engine, permissions, and assets.
- Checked the current Vercel and Turso/libSQL documentation before choosing the provider candidate. The relevant references are [Vercel Node.js runtimes](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), and [Turso/libSQL TypeScript SDK reference](https://docs.turso.tech/sdk/ts/reference).

Key target-contract files: `db/contracts.ts`, `db/libsql.ts`, `db/index.ts`, `db/readiness.ts`, and `db/migrate.ts`.

## Stage 2 — Database implementation and migrations

Status: complete for local and hosted Preview verification; Production provider provisioning remains pending.

Implemented:

- Added a narrow application-owned `Database`/`PreparedStatement` contract preserving `bind`, `first`, `all`, `run`, row names, null handling, numeric conversion, and affected-row metadata.
- Implemented the libSQL adapter with `@libsql/client/node`. `Database.batch()` submits one ordered provider batch with write transaction semantics; it rejects statements from another adapter instance and does not emulate atomicity with independent requests.
- Replaced Cloudflare D1 types and imports in runtime code with the application contract. `server-only` prevents accidental client use of the database module.
- Added `scripts/db-migration-runner.mjs`, `scripts/db-migrate.mjs`, and `scripts/load-env.mjs`. Migrations are explicit, versioned in `__app_migrations`, repeat-safe, foreign-key aware, and never run from a request handler. Production/Vercel request paths only verify readiness; they do not execute DDL.
- Preserved the four existing migration semantics and added `0004_operator_bootstrap.sql` for the singleton bootstrap marker.
- Added real-provider tests for successful ordered batches, mid-batch rollback, duplicate claims, concurrent bootstrap, rate-limit increments, competing phase transitions, double publication, and recovery-code single use. Existing domain/API tests remain in the suite.

Checks completed:

- `npm run db:migrate` — passed against the hosted Preview Turso database; the database reports all 5 migrations current.
- `npx drizzle-kit check` — passed (`Everything's fine`).
- `npm test -- --run` — provider and domain suite passed: 26 files, 83 tests.
- `pilot:setup` and `pilot:rehearsal` used separate command processes against the hosted Preview deployment with fictional data. The rehearsal passed all checks, including 20 seat claims, stale-preview rejection, role composition, Hunter follow-up, private investigation, Stop visibility, Reset session invalidation, and reset/reimport.

Not yet verified: remote network failure behavior and remote restart persistence. Local restart persistence is verified by reopening a file-backed database with a second provider client, and the local application path is also exercised by the separate setup/rehearsal invocations and repeat migration command.

## Stage 3 — Native Next.js build

Status: complete locally.

Implemented:

- Changed `dev`, `build`, and `start` scripts to `next dev`, `next build`, and `next start`.
- Removed `vite.config.ts`, `.openai/hosting.json`, Vinext/Sites/Cloudflare runtime dependencies and bindings, and Vite-only SQL loading assumptions. Vite/Vitest test tooling remains.
- Added standard `postcss.config.mjs` for Tailwind and `vercel.json` with the Next.js framework, `npm ci` install command, and `npm run build` build command.
- Updated TypeScript, CI, environment examples, and lockfile; kept existing CSS, favicon, social image, pages, API routes, and accessibility structure.
- Removed the build-time Google font fetch so an offline/clean build does not depend on external font retrieval; the existing visual styling uses the documented system fallback.
- Added private `no-store` and `Vary: Cookie, Origin` headers for API responses. Database-backed routes remain dynamic and no production data is queried, seeded, bootstrapped, or migrated during a build.

Checks completed:

- `npm run build` — native Next.js 16.3.3/Turbopack build passed, including TypeScript and static-page generation; all application API routes were emitted.
- `npm run start -- --port 3001` — production server started and anonymous `/` returned HTTP 200.
- `/api/games` under the production process rejected the development `file:` database with the intentional safety error requiring a remote Turso/libSQL URL. This confirms the deployed-function guard rather than a false production-data fallback.

## Stage 4 — Credentials, owner setup, and environment

Status: complete locally and for the hosted Preview deployment; Production remains pending.

Implemented:

- Removed `oai-authenticated-user-email` and the Sites owner-verification path.
- Added `scripts/owner-bootstrap.mjs` with hidden TTY password entry or a secure operator-provided environment value, confirmation, minimum password length, atomic singleton marker/account creation, one-time recovery-code output, and no password/token logging. The command refuses Vercel/production execution and requires an explicit database URL.
- Disabled public first-owner bootstrap: `GET /api/moderators/bootstrap` reports operator bootstrap status; `POST` returns `410` with the operator-command instruction after same-origin validation.
- Preserved hashed moderator passwords, recovery codes, player claims/PIN login, opaque session cookies, session invalidation, co-moderator permissions, and setup-only restore semantics.
- Normalized environment names to `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SITE_ORIGIN`, `WATERCOOLER_OWNER_EMAIL`, and optional `CRON_SECRET`. `.env.example` contains placeholders only; local values remain ignored.
- Updated IP handling to use Vercel's `x-vercel-forwarded-for` only in Vercel and local `x-forwarded-for` outside Vercel. The arbitrary `cf-connecting-ip` header is ignored. Origin checks compare the exact configured origin and fail closed for production/Vercel requests without an Origin header.

Checks completed:

- `npm run owner:bootstrap` — passed on the isolated fictional local database; the recovery codes were displayed once to the operator and are intentionally not repeated in this file or the final response.
- `lib/auth/bootstrap.test.ts` — simultaneous first-owner attempts produce exactly one account/marker.
- `lib/http/security.test.ts` and `lib/http/rate-limit.test.ts` — exact-origin, missing-origin, non-HTTP-origin, trusted-IP, and former-Cloudflare-header cases pass.
- `lib/api-bootstrap.test.ts` — public bootstrap is disabled and operator guidance is returned.

## Stage 5 — Deadlines and cost

Status: complete for the accepted moderator-driven operating model.

Implemented:

- Kept server-side phase deadlines and cutoff enforcement independent of scheduler availability.
- Kept the Operations polling/manual reconciliation workflow and did not add automatic phase creation or publication.
- Adapted the scheduler to `GET` and `POST`, requiring `Authorization: Bearer <CRON_SECRET>`. Missing configuration returns `503`; an incorrect token returns `401`; the sweep remains retry-safe through the existing domain logic.
- Did not configure Vercel Cron because the accepted Hobby pilot does not need unattended scheduling and minute-frequency scheduling is outside Hobby's current model. Current limits are documented by [Vercel's cron usage and pricing page](https://vercel.com/docs/cron-jobs/usage-and-pricing); Hobby eligibility is documented [here](https://vercel.com/docs/plans/hobby).

Checks completed:

- `lib/api-scheduler.test.ts` — missing/incorrect secret and authenticated `GET`/retained `POST` behavior pass.
- The 20-player rehearsal passed deadline fallback and scheduler-related checks without relying on an unattended cron.

## Stage 6 — Verification gate

Status: complete for local and hosted Preview automated verification; manual browser show-and-play and Production remain pending.

| Command or check | Result |
| --- | --- |
| `npm ci` | Passed after the sandbox cache raised a Windows permissions error and the install was rerun with the required elevated package access; 420 packages added, 421 audited. |
| `npm test -- --run` | Passed: 26 test files, 83 tests. |
| `npm run lint` | Passed with no warnings/errors. |
| `npx tsc --noEmit --incremental false` | Passed. |
| `npm run build` | Passed using native Next.js 16.3.3. |
| `npx drizzle-kit check` | Passed. |
| `npm audit --omit=dev --audit-level=moderate` | Passed: 0 production vulnerabilities. |
| `npm audit --json` | Exit 1 because of 4 moderate development-only advisories in the Drizzle-kit/esbuild toolchain; no high/critical finding. The full report's suggested fix is a breaking toolchain change, so it was not applied without a need. |
| `npm run db:migrate` | Passed against the hosted Preview database; all 5 migrations are current. |
| Fictional 20-player setup/rehearsal | Passed: 10/10 rehearsal checks. |
| File-backed provider restart check | Passed: a second `@libsql/client/node` client reopened the database after the first client closed and read the previously inserted `persisted` row; the temporary probe file was removed. |
| Desktop browser | In-app CUA verified landing, player-login, moderator sign-in, and anonymous protected-endpoint rejection. API response included `Cache-Control: private, no-store, max-age=0` and `Vary: Cookie, Origin`. |
| Hosted Preview deployment | Passed: Vercel deployment is Ready at https://watercooler-werewolf-a0oxuxxn7-dyl-edge.vercel.app; the operator signed in to the moderator console. |
| Hosted Preview fictional rehearsal | Passed: remote pilot rehearsal completed with every check true after the protected-deployment automation bypass was supplied. |

The restart check command was `node --input-type=module -e 'import { createClient } from "@libsql/client/node"; const url = "file:./work/restart-persistence-check-2.db"; const first = createClient({ url }); await first.execute("CREATE TABLE restart_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"); await first.execute({ sql: "INSERT INTO restart_probe (value) VALUES (?)", args: ["persisted"] }); first.close(); const second = createClient({ url }); const result = await second.execute("SELECT value FROM restart_probe"); console.log(JSON.stringify({ rows: result.rows })); second.close();'`; it returned `{"rows":[{"value":"persisted"}]}` and the ignored probe file was then removed.

Browser limitations:

- The requested 390x844 mobile viewport, keyboard-action pass, and browser-console inspection are not claimed. The prescribed `agent-browser` executable was unavailable in the environment; the available in-app browser fallback verified the desktop flow but did not expose viewport/devtools controls.
- Manual 20-player browser show-and-play, mobile viewport/devtools inspection, and a separate remote restart check remain unclaimed.
- The migration checks ran on Node 24.20.0. The runtime policy was updated on 2026-09-23: Node.js `>=24` is supported and the Node 24.x LTS line is the CI and release-verification baseline; no Node 22 rerun is required.

## Stage 7 — Vercel preview and production

Status: hosted Preview access, deployment, remote database initialization, moderator login, and fictional automated rehearsal complete; Production database and release verification remain pending.

Verified through the authenticated Vercel CLI:

- CLI version: 59.20.0.
- Account: `dylandedgar-7714`.
- Team: `dyl-edge`, team ID `team_cWAZtu2II5dnYoaUv41t2eHB`.
- Initial project listing under the team returned no projects.
- Created project `watercooler-werewolf`, project ID `prj_tEikbfoGxw8rzZBkMKtfTzJZdPVW`, owned by `dyl-edge`.
- Project inspection confirmed root `.`, Next.js framework preset, Node `22.x`, install `npm ci`, build `npm run build`, and framework-managed Next.js output.
- Linked the local repository to that project; the temporary local OIDC value was removed from the ignored `.env.local` after linking. No secret was committed.

Remaining gates / intentionally not claimed:

- Preview deployment is Ready at https://watercooler-werewolf-a0oxuxxn7-dyl-edge.vercel.app (target `preview`); the operator verified moderator sign-in.
- Preview has `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `WATERCOOLER_OWNER_EMAIL` configured; Production has no environment variables yet. `SITE_ORIGIN` is intentionally still pending until the final origin policy is set. The application correctly refuses a local writable `file:` URL in a deployed function.
- GitHub import/integration was not exercised; the authenticated CLI project path was used instead.
- The Production deployment is Ready at https://watercooler-werewolf.vercel.app but is not configured for gameplay; the Preview automation bypass was used only for fictional testing and should be revoked after the rehearsal. Production database setup, manual 20-player browser play, runtime-log review, remote restart persistence, and Preview/Production isolation remain pending.

## Resume runbook for the external gates

1. Preview database provisioning, environment configuration, migrations, owner bootstrap, deployment, moderator login, and the hosted fictional rehearsal are complete. Keep Preview data fictional.
2. Create a separate free Turso/libSQL Production database only after Preview approval. Keep its URL and auth token out of chat and source control.
3. Configure Production separately with `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `WATERCOOLER_OWNER_EMAIL`, and `SITE_ORIGIN=https://watercooler-werewolf.vercel.app`; add `CRON_SECRET` only if an external authenticated scheduler is actually used.
4. From a controlled operator environment, run `npm run db:migrate` and `npm run owner:bootstrap` once for the fresh Production database. Do not run either command from a Vercel request/build.
5. Revoke the Preview automation-bypass secret, deploy Production with `vercel --prod`, and run the fictional-data smoke checks plus the remaining manual browser, runtime-log, restart, and isolation checks. Do not promote Preview secrets or data into Production.

## Rollback and recovery

- Application rollback is a Vercel deployment rollback or redeploy of the previous known-good commit. It does not roll back database contents or schema.
- Keep the old Sites deployment and database available until the replacement passes the remote preview and production gates.
- Treat database restore/recovery separately: use an application backup to restore into a controlled fresh database, validate its checksum and setup-only restore rules, then point a deployment at that database. Do not run destructive down-migrations or delete the old database as part of this migration.
- If provider credentials are invalid, fix the environment configuration or redeploy the previous application; never fall back to a writable local database in Vercel.

## Files changed by area

- Native runtime/config: `package.json`, `package-lock.json`, `next.config.ts`, `postcss.config.mjs`, `vercel.json`, `.nvmrc`, `tsconfig.json`, `.github/workflows/ci.yml`, `.gitignore`.
- Database/migrations: `db/contracts.ts`, `db/libsql.ts`, `db/index.ts`, `db/readiness.ts`, `db/migrate.ts`, `db/schema.ts`, `drizzle/0004_operator_bootstrap.sql`, `scripts/db-migrate.mjs`, `scripts/db-migration-runner.mjs`, `scripts/load-env.mjs`.
- Auth/security: `lib/auth/bootstrap.ts`, `scripts/owner-bootstrap.mjs`, moderator/session/authorization modules, `lib/http/security.ts`, `lib/http/rate-limit.ts`, and the bootstrap/security tests.
- Routes/UI: API handlers were moved to the provider boundary; moderator/player navigation and bootstrap instructions were updated without redesigning the existing application.
- Operations/docs: `README.md`, `BUILD_STATUS.md`, `.env.example`, this file, and the pilot/rehearsal tooling.
