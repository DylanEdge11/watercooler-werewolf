---
name: werewolf-uat
description: Certify the Watercooler Werewolf version branch as a release candidate — release-diff review, full local suites, hosted Preview run, browser walkthrough, docs check — and hand off release notes with evidence. Never changes code, merges, or touches Production.
argument-hint: "[version branch or SHA; defaults to the current version branch]"
disable-model-invocation: true
---

# Watercooler Werewolf: UAT

Decide, with evidence, whether the `version-X.Y` branch is ready to release, and write the release notes. Test exactly one commit SHA against the `Vercel` Preview only. Report failures and hand back to `/werewolf-dev`, because this skill only certifies. *Don't change code, push, merge, or deploy.* The project facts and safety rules are in `CLAUDE.md`.

## 1. Candidate

- Take the version branch (`git ls-remote --heads origin 'version-*'`) as the candidate unless the owner names a SHA, and record its full SHA. Every result below must be for this SHA; if the branch moves, start over.
- Check out that exact SHA in this checkout and confirm `git rev-parse HEAD` matches. Keep local changes in place; if `git status` shows a dirty tree, stop and ask.
- List open PRs into the version branch (`gh pr list --base <branch>`). If any are meant for this release, stop: they aren't in the candidate.

## 2. Release summary

Read `git log origin/main..<SHA>` and `git diff origin/main...<SHA>`. Write a plain-language summary of what changes for players and moderators; it becomes the release notes and the walkthrough checklist for step 5.

Note any new migration (a new entry in `db/readiness.ts` compared with `main`), because it changes how `/werewolf-prod` releases.

## 3. Release diff review

Review the whole `main...<SHA>` diff before trusting any test result. Use the `code-review` skill at high effort if it's available, and check these specifically:

- Privacy: every player response still excludes the fields in `FORBIDDEN_PLAYER_KEYS`. *No player response may gain another player's role, private result, or unpublished outcome.*
- Authorization: mutating routes call `assertSameOrigin`, then a `lib/auth/` helper, then check state.
- Stale writes: state is re-checked inside the write, and zero changed rows returns 409.
- Migrations: additive, and the code on `main` still works against the new schema.
- Tests and docs: changed behavior has tests, and `app/guide/page.tsx` and `docs/` match.

Block the release on a confirmed privacy, authorization, data-loss, or broken-game finding. List smaller findings as risks.

## 4. Checks

Start both checks at once; they don't interfere.

1. Local, in the background: run `npm run verify:full` at the SHA (about 20 minutes). Run `npm ci` first only if `package-lock.json` changed. Record the exit code, per-suite pass/fail/flaky counts, and elapsed time. Report a test that passed only on retry as a flaky risk.
2. Hosted Preview: get the Preview deployment for the SHA (Vercel MCP tools or `vercel ls` / `vercel inspect`) and confirm it's `READY` with target `preview`. If there's a migration, confirm anonymous `GET /api/games` on the Preview returns 401; a 5xx means the Preview database isn't migrated, so hand back to Dev. Then run the three-step [hosted Preview run](../../../docs/TESTING.md#hosted-preview-runbook) once, with one `E2E_RUN_ID`, following its configuration notes.

Rules for both checks:

- Cite file paths for `.env.e2e.local` values, secrets, and Playwright reports. *Never print their contents.*
- If the hosted preflight fails, stop before creating any data and report why. *Never edit or bypass the preflight.*
- Start the `GitHub` Actions workflow by hand only when the owner asks, because one run costs about 100 minutes.

## 5. Walkthrough

On the Preview, in a browser, go through every item from step 2 as a player and as a moderator, at phone and desktop widths. Check the console for errors and the network panel for failed requests. Scroll long pages before judging images, because they load lazily. Use only fictional games this run created. *Never delete shared Preview data.*

## 6. Handoff

Fill in this template with the counts you actually saw. *Never claim a pass you didn't see.*

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

Confirm Production was not touched, then stop. Releasing is `/werewolf-prod`.
