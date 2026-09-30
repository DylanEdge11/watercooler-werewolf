---
name: werewolf-dev
description: Build one Watercooler Werewolf enhancement or fix end to end — clarify, branch from the version branch, implement with tests, update docs, self-review, verify, open a PR into the version branch, and hand off a working Preview. Never releases to Production.
argument-hint: "[what to build or fix]"
disable-model-invocation: true
---

# Watercooler Werewolf: Dev

Take one request from idea to a reviewed pull request into the `version-X.Y` branch with a working `Vercel` Preview. Follow steps 1 to 10 in order; the owner relies on this skill instead of re-explaining the process. Follow the project facts, code conventions, and safety rules in `CLAUDE.md` throughout. Stop at the step 10 handoff; the owner starts `/werewolf-uat` and `/werewolf-prod` separately.

## 1. Orientation

- Find the working base: the one `version-*` branch on origin (`git ls-remote --heads origin 'version-*'`). If there are none or several, ask the owner which to use.
- Run `git status` and keep every unrelated change and untracked file in place. *Never reset, clean, force-push, or stash them away.*
- Run `git fetch`, then read the files under `app/`, `lib/`, and `db/` that the request touches before planning.

## 2. Request

Restate the request in three to five plain-language lines for the owner, who is a product manager: what changes for players and moderators, and the acceptance checks that will show it works.

Ask the owner before writing code when the request leaves a product decision open: a game rule, who can see what, wording players will read, or a change to existing behavior. Ask in one round, with a recommended answer for each question. When nothing is open, state your reading and proceed.

When the request contains independent changes that could ship separately, say so and give each its own branch and PR.

## 3. Branch

Create `feat/<short-slug>` or `fix/<short-slug>` from `origin/version-X.Y`. Reuse a branch the session already assigned.

Hotfix exception: only when the owner says Production is broken and can't wait for the next release, branch `hotfix/<slug>` from `origin/main`. The PR then targets `main` (released with `/werewolf-prod`), and afterwards `main` is merged into the version branch.

## 4. Build

Follow the code conventions in `CLAUDE.md`. The ones most often missed:

- Put game rules in `lib/game/` with unit tests; keep route handlers in `app/api/` thin.
- In mutating routes, call `assertSameOrigin`, then a `lib/auth/` helper, then check state. Re-check state inside the write and return 409 when zero rows change.
- When a response gains a field, check it against `FORBIDDEN_PLAYER_KEYS` in `e2e/readiness/browser-fixture.ts`, because it lists what must stay private. *A player must never receive another player's role or private result.*
- Keep changes to `db/schema.ts` additive; step 8 covers the migration.

Keep the diff to files the request needs. List unrelated problems you spot under "Noticed, not fixed" in the handoff.

## 5. Tests

Add a test for every behavior change that fails without the change. For a bug, write the failing test first and watch it fail.

| Change | Test |
| --- | --- |
| Game rule or permission | Unit test next to it in `lib/game/` |
| Route, persistence, privacy, or races | `lib/provider-integration.test.ts` style: real in-memory `libSQL`, calls the route |
| Player or moderator screen or flow | Run the closest browser spec (`npm run test:e2e:uat` for game flow, `e2e/readiness/browser-setup-navigation.spec.ts` for setup); extend it when the flow itself changes |
| Game engine end to end | `npm run test:e2e` (20-player API suite, about 30 seconds) |

## 6. Docs

In the same PR, update each doc the change makes wrong:

- `app/guide/page.tsx` for anything players or moderators see;
- `docs/TECHNICAL.md` for rules;
- `docs/OPERATIONS.md` for moderator controls;
- `docs/SETUP.md` or `docs/TESTING.md` for process.

## 7. Verification and self-review

1. Run `npm run verify` and fix every failure until it passes.
2. Review the whole diff against the version branch as a skeptical reviewer would. Use the `code-review` skill at medium effort if it's available.
3. Check privacy, authorization order, stale-state writes, migration safety, and docs specifically. Fix what you find and re-run `npm run verify`.

## 8. Migrations (only if `db/schema.ts` changed)

Follow [Schema changes](../../../docs/SETUP.md#schema-changes). If the change can't be additive, stop and propose a staged plan. Then migrate the Preview database, and only that one:

- Read credentials from `PREVIEW_TURSO_DATABASE_URL` / `PREVIEW_TURSO_AUTH_TOKEN`, or from an ignored file the owner provides, and pass them to the command without echoing them. *Never print them.*
- Confirm the URL names the Preview database (it contains `watercooler-werewolf-preview`). If it could be Production, stop and ask.
- Run `TURSO_DATABASE_URL="$PREVIEW_TURSO_DATABASE_URL" TURSO_AUTH_TOKEN="$PREVIEW_TURSO_AUTH_TOKEN" node scripts/db-migrate.mjs`.
- Confirm anonymous `GET /api/games` on the Preview returns 401; a 5xx means it isn't migrated.
- Production migrations belong to `/werewolf-prod`. *Never migrate Production here.*

## 9. Publishing

1. Commit in logical steps with clear messages, staging only this change's files. *Never stage `.env*`, `work/`, Playwright output, or build output.*
2. Push, and open a PR into the version branch; only a hotfix PR targets `main`. No CI runs on PRs into a version branch, so `npm run verify` stands in.
3. Write the PR body with: what and why, how it was tested, doc changes, migrations, and open decisions for the owner.
4. Wait for the `Vercel` Preview for the pushed SHA to reach `READY` (Vercel MCP tools, the `vercel` CLI, or the PR's deployment status).
5. Walk through the changed flow on the Preview in a browser at phone and desktop widths, and check for console errors and failed requests.
6. The Preview is protected: send `VERCEL_AUTOMATION_BYPASS_SECRET` from `.env.e2e.local` as the `x-vercel-protection-bypass` header without printing it. If you can't reach the Preview, list what wasn't checked.

## 10. Handoff

Fill in this template in plain language for the owner, a product manager:

```text
DEV: READY FOR YOUR REVIEW
What changed: <one or two sentences on what players/moderators will notice>
Try it: <Preview URL> — <steps to see the change>
PR: <link> into <version branch>
Tested: <tests added; npm run verify result; browser check>
Docs: <what was updated, or none needed>
Decisions I made: <any judgment calls, or none>
Migrations: <none, or applied to Preview>
Noticed, not fixed: <out-of-scope issues, or none>
```

Stop there. When the owner approves ("merge it"), merge the PR into the version branch with a merge commit, delete the feature branch, and confirm. The next step, once every change for the release is merged, is `/werewolf-uat`.
