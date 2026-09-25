---
name: werewolf-uat
description: Certify the Watercooler Werewolf version branch as a release candidate — release-diff review, full local suites, hosted Preview run, browser walkthrough, docs check — and hand off release notes with evidence. Never changes code, merges, or touches Production.
argument-hint: "[version branch or SHA; defaults to the current version branch]"
disable-model-invocation: true
---

# Watercooler Werewolf: UAT

Decide, with evidence, whether the version branch is ready to release, and write the release notes. Test exactly one commit. Don't change code, push, merge, or deploy. If something fails, report it and hand back to `/werewolf-dev`. `CLAUDE.md` holds the project facts and safety rules. This skill targets Preview only.

## 1. Pin the candidate

- The candidate is the version branch (`git ls-remote --heads origin 'version-*'`) unless the owner names a SHA. Record its full SHA. Every result below must be for this SHA; if the branch moves, start over.
- Check out that exact SHA in this checkout (`git rev-parse HEAD` must match). Preserve local changes; if the tree is dirty, stop and ask.
- List open PRs into the version branch (`gh pr list --base <branch>`). If any are meant for this release, stop: they aren't in the candidate.

## 2. Understand the release

Read `git log origin/main..<SHA>` and `git diff origin/main...<SHA>`. Write a plain-language summary of what changes for players and moderators. It becomes the release notes and the checklist for the walkthrough in step 5.

Note any new migration (a new entry in `db/readiness.ts` compared with `main`); it changes how Production is released.

## 3. Review the release diff

Review the whole `main...<SHA>` diff before trusting any test result. Use the `code-review` skill at high effort if it's available; either way, check specifically:

- **Privacy:** no player response gains another player's role, private result, or unpublished outcome (`FORBIDDEN_PLAYER_KEYS`).
- **Authorization:** mutating routes call `assertSameOrigin`, then a `lib/auth/` helper, then check state.
- **Stale writes:** state is re-checked inside the write, and zero changed rows returns 409.
- **Migrations:** additive, and the code on `main` still works against the new schema.
- **Tests and docs:** changed behavior has tests, and the guide and docs match.

A confirmed privacy, authorization, data-loss, or broken-game finding blocks the release. List smaller findings as risks.

## 4. Run the checks

Start both at once; they don't interfere.

1. **Local, in the background:** `npm run verify:full` at the SHA (about 20 minutes). Run `npm ci` first only if the lockfile changed. Record the exit code, per-suite pass/fail/flaky counts, and elapsed time. A test that passed only on retry is flaky; report it as a risk.
2. **Hosted Preview:** get the Preview deployment for the SHA (Vercel MCP tools or `vercel ls`/`vercel inspect`) and confirm it's `READY` with target `preview`. If there's a migration, confirm anonymous `GET /api/games` on the Preview returns 401 (5xx means the Preview database isn't migrated: hand back to Dev). Then run the three-step [hosted Preview run](../../../docs/TESTING.md#hosted-preview-runbook) once, with one `E2E_RUN_ID`, following its configuration notes.

Rules for both: never print `.env.e2e.local` values, secrets, or the contents of Playwright reports (cite paths instead); if the hosted preflight fails, stop before creating any data and report why; never edit or bypass the preflight; don't start the GitHub workflow by hand (about 100 Actions minutes) unless the owner asks.

## 5. Walk through the release

On the Preview, in a browser, go through every item from step 2 as a player and as a moderator, at phone and desktop widths. Check for console errors and failed requests. Scroll long pages before judging images, because they load lazily. Use only run-owned fictional games; never delete shared Preview data.

## 6. Hand off and stop

Report actual counts only; never claim a pass you didn't see.

```text
UAT: READY TO RELEASE            (or UAT: BLOCKED — <reason>)
Candidate: <version branch> @ <full SHA>
Preview: <origin>, <deployment ID>, READY

Release notes (for players and moderators):
- <plain-language change>

Evidence:
- Code review: <blockers none / list; risks>
- verify:full: <exit code; unit, API, browser counts; flaky; elapsed>
- Hosted run: <run ID; pass/fail per step>
- Walkthrough: <flows checked, widths, console/network result>
- Migrations: <none, or versions confirmed on the Preview DB>
- Artifacts: <report paths>

Known gaps and risks: <or none>
```

Confirm Production was not touched. Stop. Releasing is `/werewolf-prod`.
