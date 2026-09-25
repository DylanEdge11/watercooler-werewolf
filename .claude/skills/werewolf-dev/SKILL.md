---
name: werewolf-dev
description: Build one Watercooler Werewolf enhancement or fix end to end — clarify, branch from the version branch, implement with tests, update docs, self-review, verify, open a PR into the version branch, and hand off a working Preview. Never releases to Production.
argument-hint: "[what to build or fix]"
disable-model-invocation: true
---

# Watercooler Werewolf: Dev

Take one request from idea to a reviewed pull request with a working Preview. Follow every step; the owner relies on this skill instead of re-explaining the process. `CLAUDE.md` holds the project facts, code conventions, and safety rules; follow them throughout. Stop at the handoff. UAT and Production are separate skills the owner starts.

## 1. Orient

- Find the working base: the one `version-*` branch on origin (`git ls-remote --heads origin 'version-*'`). If there are none or several, ask.
- Check `git status`. Preserve unrelated changes and untracked files; never reset, clean, force-push, or stash them away.
- `git fetch`, then read the code the request touches before planning.

## 2. Pin down the request

Restate it in a few lines: what changes for players and moderators, and how we'll know it works (acceptance checks). The owner is a product manager, so write it in plain language.

If the request leaves a product decision open (a game rule, who can see what, wording players will read, anything that changes an existing behavior), ask before writing code, in one round with a recommended answer for each question. If it's clear, state your reading and proceed.

If the request is really several independent changes, say so and do them as separate branches and PRs.

## 3. Branch

Create `feat/<short-slug>` or `fix/<short-slug>` from `origin/version-X.Y`. Reuse a branch the session already assigned.

**Hotfix exception:** only when the owner says Production is broken and can't wait for the next release, branch `hotfix/<slug>` from `origin/main`. The PR then targets `main` (released with `/werewolf-prod`), and afterwards `main` is merged into the version branch.

## 4. Build it properly

Follow the conventions in `CLAUDE.md`. The ones most often missed:

- Game rules go in `lib/game/` with unit tests; routes stay thin.
- Mutating routes: `assertSameOrigin`, then a `lib/auth/` helper, then state checks. Re-check state inside the write and return 409 when zero rows change.
- A player must never receive another player's role or private result. When a response gains a field, check it against `FORBIDDEN_PLAYER_KEYS` in `e2e/readiness/browser-fixture.ts`.
- Schema changes are additive only. See Migrations below.

Keep the change focused. Note unrelated problems you spot for the handoff instead of fixing them here.

## 5. Test

Every behavior change gets a test that would fail without it. For a bug, write the failing test first.

| Change | Test |
| --- | --- |
| Game rule or permission | Unit test next to it in `lib/game/` |
| Route, persistence, privacy, or races | `lib/provider-integration.test.ts` style: real in-memory libSQL, calls the route |
| Player or moderator screen or flow | Run the closest browser spec (`npm run test:e2e:uat` for game flow, `e2e/readiness/browser-setup-navigation.spec.ts` for setup); extend it when the flow itself changes |
| Game engine end to end | `npm run test:e2e` (20-player API suite, about 30 seconds) |

## 6. Update the docs

In the same PR, update whatever the change makes wrong: `app/guide/page.tsx` for anything players or moderators see, `docs/TECHNICAL.md` for rules, `docs/OPERATIONS.md` for moderator controls, `docs/SETUP.md` or `docs/TESTING.md` for process.

## 7. Verify and self-review

1. `npm run verify` must pass. Fix failures; don't skip them.
2. Review the whole diff against the version branch as a skeptical reviewer would. Use the `code-review` skill at medium effort if it's available, then check specifically: privacy, authorization order, stale-state writes, migration safety, and docs. Fix what you find and re-run `npm run verify`.

## 8. Migrations (only if `db/schema.ts` changed)

Follow [Schema changes](../../../docs/SETUP.md#schema-changes). If the change can't be additive, stop and propose a staged plan. Then migrate the **Preview** database only:

- Credentials: `PREVIEW_TURSO_DATABASE_URL` / `PREVIEW_TURSO_AUTH_TOKEN`, or an ignored file the owner provides. Never print them.
- Confirm the URL names the Preview database (it contains `watercooler-werewolf-preview`). If it could be Production, stop and ask.
- Run `TURSO_DATABASE_URL="$PREVIEW_TURSO_DATABASE_URL" TURSO_AUTH_TOKEN="$PREVIEW_TURSO_AUTH_TOKEN" node scripts/db-migrate.mjs`, then confirm anonymous `GET /api/games` on the Preview returns 401 (5xx means it isn't migrated).
- Never migrate Production here.

## 9. Publish

1. Commit in logical steps with clear messages. Stage only this change's files, never `.env*`, `work/`, Playwright output, or build output.
2. Push, and open a PR into the version branch (the only case where the base isn't the version branch is a hotfix). PR body: what and why, how it was tested, doc changes, migrations, and anything the owner should decide. No CI runs on PRs into a version branch; `npm run verify` stands in.
3. Wait for the Vercel Preview for the pushed SHA to reach `READY` (Vercel MCP tools, the Vercel CLI, or the PR's deployment status).
4. Walk through the changed flow on the Preview in a browser at phone and desktop widths, and check for console errors and failed requests. The Preview is protected: send `VERCEL_AUTOMATION_BYPASS_SECRET` from `.env.e2e.local` as the `x-vercel-protection-bypass` header without printing it. If you can't reach it, say what wasn't checked.

## 10. Hand off and stop

Write for a product manager, not an engineer:

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

Stop. When the owner approves ("merge it"), merge the PR into the version branch with a merge commit, delete the feature branch, and confirm. Once every change for the release is merged, the next step is `/werewolf-uat`.
