# Watercooler Werewolf: Vercel migration assessment

Assessment date: 2026-09-16. Source: repository `https://github.com/DylanEdge11/watercooler-werewolf.git`, local commit `5cf80adca09403a37383e7fe860268bd3700973f`.

## Decision and confirmed scope

Migration is feasible, but importing this repository into Vercel unchanged will not produce a working application. Preserve the existing UI, game engine, and API behavior; replace the hosting-specific build, persistence bindings, and owner bootstrap.

The user confirmed: start fresh with disposable existing games; minimize cost and propose options before paid services; use a Vercel-provided URL initially; destination scope `dyl-edge`; personal, non-commercial use; moderator-driven deadline reconciliation is acceptable. No live-data conversion or domain transfer is needed. Starting fresh does not require deleting the old site or database.

Recommended candidate: standard Next.js App Router on Vercel's Node.js runtime, with a remote SQLite-compatible database such as Turso. Validate the provider's current engine and SDK compatibility before choosing it. SQLite compatibility reduces changes to existing SQL; it does not prove identical transaction behavior. PostgreSQL through Neon is an alternative with a larger application rewrite. Neither provider has been provisioned or selected by the user.

## Evidence and limits

Fresh checks on the current source, using local Node 24.20.0:

| Check | Result |
| --- | --- |
| `npm test` | 73 tests across 23 files passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit --incremental false` | Passed |
| `npm run build` | Passed, using Vinext/Cloudflare, not native Next.js |
| Existing Vercel account | Connector now responds; `list_teams` returned an empty list; `list_projects` for user-supplied `dyl-edge` returned “Failed to list projects.” Destination access remains unverified |
| Hosted gameplay | Not verified during this assessment |
| Native Next.js or Vercel build | Not attempted; migration changes have not been made |

The current build warns about a JSON import without import attributes and reports some route classifications as unknown. Neither stopped the existing build. Historical verification and vulnerability claims in `BUILD_STATUS.md` are not fresh evidence. No new dependency audit was run. Existing API regression tests use a local `node:sqlite` D1-shaped test harness; they do not establish remote database correctness.

The actual Git repository is the nested `project/` directory. Its working tree was clean before these planning files. The outer workspace also has an unrelated, uncommitted Git repository. For an import of the named GitHub repository, use its repository root, normally `.`; do not blindly set Vercel Root Directory to `project`. Verify the imported tree first.

## Current implementation

| Area | Observed source |
| --- | --- |
| Framework | Next-style App Router; Next 16.3.3 and React 19.3.0 in package.json, but dev/build/start use Vinext |
| Hosting | `vite.config.ts` combines Vinext, Sites, and Cloudflare plugins; `.openai/hosting.json` declares D1 binding `DB`; R2 is null |
| Persistence | 22 SQLite tables in `db/schema.ts`; four SQL migrations; 30 files in app/lib/db reference D1 APIs or types, including tests |
| Queries | Raw prepared SQLite statements dominate runtime paths; atomic D1 batches, conditional writes, and affected-row checks enforce concurrency |
| Credentials | App-owned moderator passwords, recovery codes, player PINs, hashed opaque cookie sessions |
| Initial owner | `oai-authenticated-user-email` trusted by `lib/auth/site-owner.ts`; owner email from Cloudflare env |
| Scheduling | POST-only token-authenticated deadline sweep; moderator Operations reconciliation fallback; no recurring phase creation |
| Updates | Player dashboard polls every ten seconds; private chat also polls |
| Assets | Static favicon and social preview in public; no R2 upload migration required |
| Delivery | In-app announcements and email-ready copy, not actual email sending |

## Required migration work

1. **Native build:** change scripts to `next dev`, `next build`, `next start`; remove Vinext/Sites/Cloudflare runtime build integration. Keep Vite where Vitest requires it. Move Tailwind PostCSS configuration out of Vite into standard PostCSS configuration. Align Next/React/ESLint peers and regenerate the lockfile with tested, supported versions. Pin a supported Node major consistently in package.json, CI, and Vercel. Keep all existing routes and assets.
2. **Database boundary:** replace `cloudflare:workers`, `drizzle-orm/d1`, and Cloudflare D1 types with a provider-independent server-only contract. Implement prepared binding, first/all/run result shapes, affected-row semantics, and atomic ordered batches over the chosen database. Preserve SQLite SQL for the SQLite route. Do not emulate transactions with independent requests or Promise.all. Test rollback and concurrent mutations against the actual provider.
3. **Schema provisioning:** replace Vite `*.sql?raw` imports and request-time DDL with an explicit, repeat-safe migration command and version tracking. Normal requests should check readiness, not race to change schema. Validate foreign keys, indexes, fresh initialization, reruns, and transactional migration behavior. Create separate disposable preview and production databases.
4. **Owner setup:** remove reliance on the Sites identity header. A one-time operator CLI is the simplest low-cost option: require an empty database, designated owner email, securely entered password, one-time recovery-code output, and atomic singleton creation. Disable public first-owner account creation when using this option. Update the UI and pilot helpers accordingly. Never accept a caller-supplied identity header as proof of ownership.
5. **Runtime security:** preserve cookie settings and session invalidation, verify exact trusted origins and platform IP-header behavior, and keep durable atomic rate limits. The current IP helper prefers `cf-connecting-ip`; this must not become attacker-controlled on Vercel. Prevent private responses from shared caching. Verify two users never receive each other's state.
6. **Scheduler:** if using Vercel Cron, add authenticated GET handling and `CRON_SECRET`; retain POST only if needed for an external scheduler. Keep missing-secret failure and retry-safe semantics. The current `.env.example` mentions `SCHEDULER_SECRET` although the implementation reads `WATERCOOLER_SCHEDULER_TOKEN`; normalize naming. Hobby does not support minute-frequency cron. For a low-cost moderator-driven pilot, omit minute cron and clearly describe the fallback. Deadlines must still be enforced by action endpoints.
7. **Deployment:** identify the destination account/project, confirm GitHub import access, choose the Next.js preset and correct root, scope secrets separately, and use a fresh preview database. Verify preview first. A production build must use production configuration; do not blindly promote an artifact built with preview values.
8. **Verification and handoff:** preserve the baseline suite, add provider integration and bootstrap tests, and complete the fictional 20-player rehearsal and desktop/mobile checks. Keep the old site available until the new environment passes. Document rollback and database recovery separately: reverting an application deployment does not revert database contents.

## Cost options

| Option | Trade-off |
| --- | --- |
| Vercel Hobby + free remote SQLite-compatible database | Candidate for personal/non-commercial pilot; least SQL rewrite; monitor quotas and use moderator-driven deadline reconciliation unless a separate scheduler is selected |
| Vercel eligible paid plan + remote SQLite-compatible database | Same migration shape, with native minute-frequency scheduling available on Pro; requires a concrete cost proposal before purchase |
| Vercel + Neon/PostgreSQL | Managed relational option; requires porting SQLite schema, placeholders, time expressions, conflict clauses, result metadata, tests, and locking semantics |
| Vercel + retained D1 through a separately secured Worker API | Potential hybrid, but adds two hosting systems and service authentication; current Sites D1 ownership/direct access is unverified; not the preferred fresh-start path |

Do not assume a free tier is appropriate solely because players are not paying. Vercel restricts Hobby to personal, non-commercial use. An employer-sponsored use case needs eligibility clarified. Free quotas are not a capacity guarantee: 80 open dashboards polling once every ten seconds generate 28,800 requests/hour before chat, moderator requests, or database queries. Pause/back off inactive tabs if implemented without losing timely active updates; measure before claiming readiness.

Turso currently advertises a free plan. Its libSQL SDK documents transactional batches, making it a plausible compatibility candidate, not an already-validated replacement. Verify compatibility with the engine actually provisioned; do not assume a newer Turso engine uses the same SDK.

## Outstanding information/access

Final setup checkpoint: direct MCP OAuth completed successfully. `codex mcp list` reports `vercel` enabled with OAuth, and `codex mcp get vercel` confirms `https://mcp.vercel.com` over Streamable HTTP. The current conversation still exposes only the original plugin tools, not the newly added direct MCP tools, so an authenticated direct-MCP `list_teams` call remains unverified until tools reload. CLI account/team/project-list access is already verified and can be used independently. No further login is currently requested.

Latest access verification: Vercel CLI 59.20.0 is installed globally and authenticated as `dylandedgar-7714`. Team `dyl-edge` / DylEdge is accessible using `team_cWAZtu2II5dnYoaUv41t2eHB`; project listing succeeded and returned no projects. This resolves the CLI deployment-access blocker below. The plugin lookup failure remains separate. The official direct MCP endpoint has been added through `codex mcp add vercel --url https://mcp.vercel.com`; OAuth completion and authenticated MCP verification are pending. No project was created or linked during global setup.

Update: the user delegated database selection to the implementing agent, prioritizing ease and lowest cost. No additional provider-choice approval is required for a free option; compatibility and account access still need verification. A subsequent Vercel retry again returned no teams and failed to list projects under `dyl-edge`.

- Working deployment access to confirmed destination `dyl-edge`. The user supplied `https://vercel.com/new?teamSlug=dyl-edge`; listing projects failed, so account permissions or CLI access still need verification.
- Personal/non-commercial use and moderator-driven reconciliation are confirmed. Plan for Hobby without minute cron, subject to current quotas and final account verification.
- Database provider choice and account access; server-only connection credentials must be entered in the provider/Vercel secret store, not pasted into the prompt.
- Designated owner email and a secure initial credential workflow at implementation time.
- GitHub installation permission for the source repository, or an authenticated CLI deployment path.

No additional plugin installation is currently necessary to finish planning. Vercel is available. A database account/integration is still needed; a special database plugin is optional if supported CLI/dashboard access suffices. Cloudflare access is unnecessary for a fresh start unless the user later wants old-site cleanup or data extraction. No email, SSO, Blob, or AI-model API plugin is required for existing functionality.

## Official sources checked

- [Vercel Hobby eligibility and limits](https://vercel.com/docs/plans/hobby)
- [Cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Cron method and execution](https://vercel.com/docs/cron-jobs)
- [Cron authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Marketplace storage](https://vercel.com/docs/marketplace-storage)
- [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Turso pricing](https://turso.tech/pricing)
- [Turso/libSQL transaction and result API](https://docs.turso.tech/sdk/ts/reference)

Use `VERCEL_MIGRATION_PROMPT.md` as the implementation handoff. This assessment authorizes no paid provisioning or deletion and does not claim a deployment occurred.
