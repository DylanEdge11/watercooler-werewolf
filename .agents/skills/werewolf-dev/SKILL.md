---
name: werewolf-dev
description: Make and quickly smoke-check a Watercooler Werewolf change on Vercel Preview. Use for fast iteration; this is not comprehensive UAT or a Production release.
---

# Watercooler Werewolf Dev Preview

Use this skill only for the Dev phase: make a focused change, do the smallest useful checks, publish a Vercel Preview, and verify the changed flow quickly. Stop after the Preview handoff. Do not invoke or perform UAT or Production, even if the user mentions those phases in the same request. The user calls each phase separately.

## Project contract

- Resolve the candidate worktree that contains the app's `package.json`. Use the worktree on the branch and base intended for this change; do not edit a different checkout just because it is open in the workspace.
- Git remote: `origin` (`DylanEdge11/watercooler-werewolf`). Vercel project: `watercooler-werewolf`, team: `dyl-edge`.
- Use Node 24.x LTS, the verified baseline. The package supports Node.js `>=24`. Preview and Production have separate Turso databases and Vercel environment variables. This skill targets Preview only.

## Make a focused change and quick checks

1. Inspect the current branch, worktree, recent commits, and intended base. Preserve unrelated changes and untracked files. Never reset, clean, force-push, or silently stash.
2. Reuse the user's current feature branch when it is the right candidate. For a substantial independent change, create a dedicated `codex/<short-change-slug>` branch from the requested base. Do not assume `main` if the user names another development base or the work depends on an unpublished branch.
3. Review the requested scope and run only the fastest relevant local check or checks. Examples: lint changed files, run the directly related unit test, or type-check when types changed. For docs-only changes, inspect the rendered Markdown and links instead of running app tests. Let the Vercel Preview build provide the build check when appropriate.
4. Do not run the full unit suite, full hosted Playwright suite, cross-browser matrix, dependency audit, or repeated test runs as part of this fast path. Do not add tests unless the user asks. Do not bypass checks that the repository requires for publishing or branch protection; report any required check that is still running.
5. Review the diff and stage only files for this change. Exclude `.env*`, credentials, database files, Playwright reports/results, build output, and unrelated edits. Commit with a clear message when needed.

## Publish and smoke-check Preview

Push the candidate branch to `origin` to trigger the Vercel Git Preview deployment. Never use `--prod`, merge to `main`, change the Production domain, or promote a Preview deployment.

Wait for the current deployment to reach `READY`. Confirm project `watercooler-werewolf`, team `dyl-edge`, target `preview`, branch, exact commit SHA, HTTPS URL, and Preview-only configuration. Do not reuse a deployment URL for a different SHA.

For app UI or flow changes, use a browser for one short smoke pass through the changed screen or interaction. Confirm it loads, the key interaction works, and there are no obvious console errors or failed requests. For docs-only or non-UI changes, check only the changed Preview surface and skip unrelated browser flows. Keep any mutations on Preview and use fictional or run-owned test data. If browser access or an authorized test account is unavailable, state what could not be checked instead of claiming the smoke pass succeeded.

If the Preview build or smoke check exposes an issue, fix only the scoped change, publish its new SHA, and repeat the quick check on that deployment. Do not turn a quick iteration into full UAT; tell the user when the Preview is ready for the separate UAT phase.

## Dev handoff and stop

Report:

```text
DEV: PREVIEW READY FOR QUICK REVIEW
Branch: <candidate branch>
Commit: <full SHA>
Preview: <exact URL>
Vercel deployment: <deployment ID, READY, preview>
Quick checks: <what ran and results>
Browser smoke: <changed flow and result, or not run with reason>
CI: <required status or pending status>
Known gaps: <what the quick pass did not cover>
```

State that this Dev smoke pass is not comprehensive UAT or Production approval. Stop after the handoff.
