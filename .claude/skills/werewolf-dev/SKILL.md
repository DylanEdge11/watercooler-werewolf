---
name: werewolf-dev
description: Make a focused Watercooler Werewolf change, publish it to a Vercel Preview, and smoke-check the changed flow. Fast iteration only; not comprehensive UAT and never a Production release.
argument-hint: "[change description]"
disable-model-invocation: true
---

# Watercooler Werewolf Dev Preview

Dev phase only: make a focused change, run the smallest useful checks, publish a Vercel Preview, and verify the changed flow. Stop after the handoff. Do not perform UAT or Production work; the user starts each phase separately.

Project facts, branch rules, and safety rules are in `CLAUDE.md`. Vercel project `watercooler-werewolf`, team `dyl-edge`. This skill touches Preview only; all Preview deployments share one Preview database.

## Make the change

1. Check the branch, working tree, and recent commits. Preserve unrelated changes and untracked files. Never reset, clean, force-push, or silently stash.
2. Work on the current version branch (`version-X.Y`, named in `CLAUDE.md`) or a short feature branch created from it. Use a branch the session assigns. Never branch from or commit to `main`.
3. Run only the fastest relevant checks: the related Vitest file, lint on changed files, or `npx tsc --noEmit --incremental false` when types changed. For docs-only changes, check the Markdown and links instead. The Vercel build is the build check.
4. When fixing a bug, add one directly related test that would have caught it, if a natural place exists. Don't otherwise expand coverage unless asked.
5. Stage only this change's files. Never stage `.env*`, credentials, database files, `work/`, `playwright-report/`, `test-results/`, or build output. Commit with a clear message.

## Schema changes

Follow [Schema changes](../../../docs/SETUP.md#schema-changes). Keep migrations additive; if one can't be, stop and explain the plan first. Then apply it to the **Preview** database only, because every API route fails until it's migrated:

- Use `PREVIEW_TURSO_DATABASE_URL` / `PREVIEW_TURSO_AUTH_TOKEN` (cloud sessions) or an ignored file the user provided (for example `.env.preview-db.local`). Never print the values.
- Confirm the URL names the Preview database (for example it contains `watercooler-werewolf-preview`). If it names Production or you can't tell, stop and ask.
- Run `TURSO_DATABASE_URL="$PREVIEW_TURSO_DATABASE_URL" TURSO_AUTH_TOKEN="$PREVIEW_TURSO_AUTH_TOKEN" node scripts/db-migrate.mjs`, or `node --env-file=<file> scripts/db-migrate.mjs`.
- Anonymous `GET /api/games` on the Preview should then return 401; a 5xx means a migration is still missing.
- Without Preview credentials, report that the Preview database still needs migrating. Never migrate Production from this skill.

## Publish and smoke-check

Push the branch so Vercel builds a Preview. Never use `vercel deploy --prod`, merge to `main`, or promote a deployment.

Wait for the deployment for the exact pushed SHA to reach `READY` (Vercel CLI, Vercel MCP tools, or the GitHub deployment status). If nothing can confirm it, say so.

For UI or flow changes, do one short browser pass through the changed screen: it loads, the key interaction works, no console errors or failed requests. A protected Preview needs `VERCEL_AUTOMATION_BYPASS_SECRET` as the `x-vercel-protection-bypass` header. For non-UI changes, check only the changed surface. If a browser, bypass secret, or test account is unavailable, state what wasn't checked.

If the build or smoke check finds a problem in this change, fix it, push, and re-check the new SHA. Don't escalate into full UAT.

## Handoff

```text
DEV: PREVIEW READY FOR QUICK REVIEW
Branch: <branch>
Commit: <full SHA>
Preview: <exact URL>
Vercel deployment: <deployment ID, READY, preview>
Quick checks: <what ran and results>
Schema/migrations: <none, or version applied to Preview DB / still pending>
Browser smoke: <changed flow and result, or not run with reason>
Known gaps: <what this pass did not cover>
```

This is not UAT or Production approval. Stop.
