# Copy-and-use migration prompt

Give the implementing coding model this entire document and access to the repository. It is written as small verified stages so it can be used with Luna Max or another coding model without relying on prior conversation. A chat-only model without file, shell, and deployment access cannot perform the migration; it should identify those missing capabilities rather than claim completion.

---

Migrate the existing **Watercooler Werewolf** application to Vercel. Implement the migration in the existing codebase; preserve its design, routes, game rules, permissions, and working features. Do not replace it with a mockup or rebuild only the frontend.

## Confirmed user requirements

- Start with a fresh database. Existing games are disposable; do not build a live-data migration.
- Minimize cost. Present options and obtain agreement before any paid service, upgrade, or billable provisioning.
- The user delegated database selection: use whatever is easiest and cheapest. Proceed with a free SQLite-compatible candidate if compatibility checks pass; do not ask the user to choose the provider again. Account access may still require their participation.
- Initially use a Vercel-provided URL; no custom domain is required.
- Destination account/team scope: `dyl-edge`, supplied via `https://vercel.com/new?teamSlug=dyl-edge`. Connector project listing failed during assessment; verify deployment access without asking the user to choose the destination again.
- Confirmed team ID from the user: `team_cWAZtu2II5dnYoaUv41t2eHB`. Listing projects with this exact ID also failed; use it for subsequent access verification.
- Latest verification supersedes the connector blocker: global Vercel CLI 59.20.0 authenticated as `dylandedgar-7714`; CLI team access succeeded and project listing returned no projects under `dyl-edge`. Use the authenticated CLI for project setup. The direct MCP connection has been configured but its OAuth verification was still pending at this checkpoint.
- Final setup update: direct MCP OAuth succeeded; Codex lists `vercel` enabled with OAuth at `https://mcp.vercel.com`. Direct tool invocation awaits loading those tools into a session; do not confuse the old plugin's failed lookup with the now-verified CLI access. No additional login is currently needed.
- This is personal, non-commercial use. Target Hobby within current limits.
- Moderator-driven deadline reconciliation is accepted. Retain server-enforced cutoffs and Operations checks; do not add paid or minute-frequency cron.
- Preserve the old site/database until the replacement is verified. Fresh-start permission is not a request to delete them.
- Do not introduce email delivery, external SSO, AI features, WebSockets, or a redesign as part of hosting migration.

## Inputs to resolve

Read the assessment and any newer user replies before asking questions. Carry confirmed answers forward.

1. Authenticated deployment access to confirmed scope `dyl-edge`, and new versus existing project selection after inspecting that scope.
2. Verify current Hobby limits against the confirmed personal/non-commercial use; no need to ask the use category again.
3. Database provider/account: proposed first choice is a free remote SQLite-compatible service such as Turso, contingent on SDK/transaction compatibility. Propose PostgreSQL only with its broader rewrite explained.
4. Use the confirmed moderator-driven deadline reconciliation; no unattended scheduler is required.
5. Owner email and secure operator bootstrap procedure. Never request passwords/tokens in conversation.

Continue local implementation that does not depend on missing answers; stop only the dependent external action. Do not spend money, invent account IDs, or claim inaccessible resources were verified.

## Source map and baseline

Local source during assessment: `C:/Users/dylan/Documents/ChatGPT/Werewolf/project`. Git remote: `https://github.com/DylanEdge11/watercooler-werewolf.git`. Assessment commit: `5cf80adca09403a37383e7fe860268bd3700973f`; inspect the current checkout instead of resetting to it. The nested project is the actual repository; verify root with Git. Use Vercel Root Directory `.` if package.json is at the imported repository root.

Read `VERCEL_MIGRATION_ASSESSMENT.md`, README.md, BUILD_STATUS.md, package.json, vite.config.ts, next.config.ts, tsconfig.json, db/index.ts, db/migrate.ts, db/schema.ts, drizzle migrations, lib/auth, lib/http, lib/game/scheduling.ts, bootstrap/scheduler routes, API tests, and pilot scripts. Follow applicable AGENTS.md instructions. Preserve unrelated edits.

Existing scripts use Vinext despite Next.js-style App Router source. Cloudflare D1 is accessed via raw prepared statements and ordered atomic batches throughout the backend. There are 22 application tables and four existing migration files. Existing tests use node:sqlite to simulate D1. On 2026-09-16 the original build, lint, TypeScript, and all 73 tests passed; this does not establish native Next.js or provider integration success.

## Work in these stages

Complete one stage, run its relevant checks, and record results before moving on. Maintain `MIGRATION_PROGRESS.md` with decisions, changed files, exact commands/results, blockers, and the next action. If context runs out, this file must permit another model to resume. Do not drop tests or weaken authorization to make a stage pass.

### 1. Inventory and target contract

- Confirm repository root, branch/status, current baseline, framework versions, all Cloudflare/Sites imports, raw SQL patterns, D1 result methods, environment names, and public/private routes.
- Create a migration branch using the repository's branch convention when permitted.
- Set the target to native Next.js App Router with Node runtime and a remote database; no writable local database file in deployed functions.
- Select a provider only after verifying current docs and compatibility. For the SQLite candidate, explicitly verify ordered atomic write batches, rollback, affected-row counts, supported SQL, foreign keys, and consistency. Implement a narrow server-only database contract instead of spreading a vendor SDK across all routes.

### 2. Database implementation and migrations

- Port getD1/getDb to the chosen provider contract. Replace Cloudflare types with application-owned interfaces or provider types. Preserve first/all/run/bind behavior, null handling, row names, numeric conversion, and metadata actually consumed by callers.
- Preserve batch order and transaction boundaries using real provider transactions. A loop of independent HTTP calls or Promise.all is not an atomic batch. Roll back all writes on failure.
- Preserve optimistic versions, guarded writes, unique indexes, stable event IDs, and affected-row conflict detection in roster import, assignment release, claims, action revisions, phase transitions, publication, recovery, Stop, Reset, and restore.
- Replace raw SQL imports with a portable explicit migration command. Track versions and validate repeat execution. Do not run DDL on every request or touch production from preview builds.
- For SQLite, reuse the schema/migration semantics after validation. For PostgreSQL, port every SQLite-specific construct and test; do not merely change the connection string or Drizzle dialect.
- Add real-provider integration tests on an isolated disposable database: successful batches, mid-batch rollback, duplicate claims, simultaneous bootstrap, rate-limit increments, competing phase transitions, double publication, and recovery-code single use. Retain the existing domain tests.

### 3. Native Next.js build

- Use `next dev`, `next build`, `next start`; choose compatible supported versions and lock them reproducibly. Pin a supported Node major consistently across local instructions, CI, and Vercel.
- Remove Sites/Cloudflare/Vinext runtime build plugins and dependencies no longer used. Keep Vitest and necessary test tooling; do not remove Vite blindly.
- Add standard Tailwind PostCSS configuration. Preserve CSS, favicon, social image, pages, API handlers, and accessibility.
- Remove Vite-only SQL loading and Worker binding assumptions; update TypeScript, lint configuration, environment declarations, CI, and scripts.
- Keep database-backed request paths dynamic and private. Builds must not query, bootstrap, seed, or migrate production. Ensure secrets never appear in client bundles or NEXT_PUBLIC variables.

### 4. Credentials, owner setup, and environment

- Remove trust in `oai-authenticated-user-email` and all Sites owner-verification instructions. Email equality alone is not authentication.
- Prefer a one-time operator bootstrap command over adding an auth vendor: fail unless no owner exists; securely read initial password; atomically enforce a singleton bootstrap marker and account creation; display recovery codes once; never log credentials. Disable public account bootstrap on this path and update the moderator screen and rehearsal scripts.
- Preserve moderator passwords/recovery, player claims/PIN login, hashed session cookies, and session invalidation. Verify concurrent bootstrap cannot create two initial owners.
- Update environment examples with names and descriptions only. Candidate SQLite names: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, subject to selected SDK; common names: SITE_ORIGIN, WATERCOOLER_OWNER_EMAIL, optional CRON_SECRET. Use separate values/databases per environment.
- Verify trusted client IP handling against Vercel documentation; do not trust an arbitrary cf-connecting-ip header. Preserve atomic persistent rate limits and Retry-After.
- Validate browser mutation origins against the actual trusted origin/proxy setup. Explicitly set private/no-store behavior for sensitive responses and test isolation across sessions.

### 5. Deadlines and cost

- Preserve server-enforced submission cutoffs independently of scheduler availability. Preserve moderator review/publication; do not invent automatic phase opening or publication.
- If moderator-driven reconciliation is accepted, retain Operations polling/manual checks and omit unsupported minute-frequency Vercel cron. Document that state reconciliation may wait until the console is active.
- If unattended scheduling is required, present a concrete supported scheduler/plan option before any paid action. Vercel Cron uses GET and CRON_SECRET; current app exposes POST with WATERCOOLER_SCHEDULER_TOKEN. Adapt intentionally, reject missing/incorrect authorization, and test retries/concurrent runs.
- Never put a minute cron on Hobby. Check current limits before configuring it.
- Explain polling costs with assumptions; no load-readiness claim. Avoid adding paid monitoring/services by default.

### 6. Verification gate

Run clean install, tests, lint, strict type checking, native production build, and production dependency audit. Record exact results and any unresolved vulnerabilities. Verify from a clean checkout or CI that ignored/generated files are not required. Update CI to perform the same checks.

Use the existing fictional 20-player fixture in an isolated environment. Verify:

- Anonymous landing and credential screens; protected endpoints reject anonymous users.
- Secure owner provisioning, moderator sign-in/recovery, co-moderator permissions.
- Roster import, one-time claim links, six-digit PIN login, role composition and release.
- Only the current player's role/results/allowed rooms are exposed; cross-game and cross-seat access fail.
- Day ballot revisions, latest-vote tally, lock/propose/review/publish, ties and no-votes.
- Night attack, Bodyguard protection, private exact-role Seer result, Hunter follow-up.
- Explicit Final Showdown and Final Ballot, victory completion, frozen rooms.
- Chat membership and moderation, announcements, feedback, deadline fallback/scheduler.
- Stop/Reset/restore authorization, backup checksum, fresh invite links, invalidated sessions. Preserve existing setup-only restore semantics; do not claim it restores a running game.
- Real-provider concurrency tests and restart persistence.
- Desktop and 390x844 mobile views, navigation, keyboard actions, and browser console.

Do not claim browser/provider verification unless actually run. If access is missing, list that gate as blocked and keep the reproducible test procedure.

### 7. Vercel preview and production

- Confirm destination and GitHub access; use Next.js preset, actual repo root, npm ci, npm run build, framework-managed output, and supported Node major. Do not deploy the old dist folder as a static site.
- Provision/configure the agreed database and secrets separately for preview and production. Confirm preview mutations cannot reach production.
- Deploy preview and run the verification gate there, including provider persistence and runtime-log inspection. Check deployment protection does not prevent the intended participants or scheduler from using the final site.
- Report the concrete preview URL, commit, checks, cost/plan choice, and unresolved issues before production release if release authorization has not already been given.
- Build/deploy production with production configuration. A tested preview is not proof that promoting its preview-configured artifact is correct. Run production smoke checks with fictional data.
- Deliver the Vercel URL, setup/runbook, environment-variable names, database/migration operations, cost assumptions, remaining limits, and rollback instructions. Leave old Sites hosting untouched unless separately instructed.

## Completion criteria

The migration is complete only when the native Vercel deployment runs the existing full application with durable remote data, secure owner provisioning, working permissions and game workflows, passing local/provider/browser checks, and documented operations. Clearly distinguish implemented, locally tested, preview verified, and production deployed. If blocked, report the precise missing access or decision and preserve all completed work.

---
