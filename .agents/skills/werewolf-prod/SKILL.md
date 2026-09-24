---
name: werewolf-prod
description: Release a comprehensively UAT-verified Watercooler Werewolf candidate by merging it to main and verifying the Vercel Production deployment. Does not create a Preview or run Dev/UAT.
---

# Watercooler Werewolf Production release

Use this skill only when the user separately asks to release a specific, already UAT-verified candidate to Production. This invocation is the user's release authorization once the comprehensive UAT evidence is confirmed. Do not invoke or perform Dev or UAT from this skill, even if the user mentions those phases in the same request. The user calls each phase separately.

## Project contract

- Resolve the application worktree that contains the intended candidate and `package.json` before running commands. Confirm it is the correct repository and branch before merging or releasing.
- Git remote: `origin` (`DylanEdge11/watercooler-werewolf`). Production branch: `main`; verify that this remains the Vercel Production Branch.
- Vercel project: `watercooler-werewolf`, team scope: `dyl-edge`.
- Read [the setup and deployment guide](../../../docs/SETUP.md) for production configuration and migration operations.
- Preview and Production use separate Turso databases and Vercel environment variables. Build a new Production deployment from `main`; never promote the Preview deployment.

## Verify the UAT handoff before merging

Identify the candidate branch and its UAT handoff from the user's current request, the linked PR, or available task history. The handoff must identify the exact tested commit SHA, Preview URL and deployment ID, passing CI/checks, full hosted Playwright run ID and results, and relevant artifact paths. If this evidence is missing, unclear, or belongs to a different SHA, do not merge; ask the user to provide the handoff or run the separate UAT phase.

Fetch and inspect `origin/main` and the candidate branch. Confirm that the candidate's current remote SHA is the UAT-tested SHA, that the recorded Vercel deployment is still `READY` and targets `preview`, and that CI remains green. Confirm the configured Vercel Production Branch is `main`. If the candidate changed, `main` advanced in a way that changes the merge result, or any evidence is stale, stop and request a new UAT verification in a separate run. Do not call the UAT skill yourself.

If the worktree contains unrelated edits or artifacts, preserve them. Never reset, clean, force-push, or silently stash. Review the exact candidate-to-main diff and ensure no `.env*`, credentials, database files, Playwright artifacts, or unrelated changes will be merged.

## Merge and deploy Production

Merge the named, comprehensively UAT-verified candidate branch into `main` using the repository's established protected-branch or pull-request process. Do not bypass branch protection or rewrite shared history. The user's separate Production request authorizes the release; if repository policy requires an independent human review or merge action, prepare the PR and wait for that required action rather than bypassing policy.

Let the Vercel Git integration deploy the merge result from `main` to Production with Production environment variables. Here, “promote to Production” means releasing the `main` deployment through the configured production flow. Do not promote the UAT Preview deployment itself: Preview and Production use separate databases and configuration. Do not use `vercel deploy --prod` unless the user explicitly requests the CLI route and the connected Git production flow is unavailable.

Wait for the Production deployment to reach `READY`. Inspect it and verify its commit is the approved merge result, then verify the configured Production domain responds and review deployment/runtime errors. Use only read-only Production smoke checks, such as the public landing page response and expected unauthenticated API rejection. The hosted Playwright runbook is Preview-only; never point its remote runner or pilot mutations at Production.

If the change includes a database migration, follow the production migration and backup procedure in the setup guide. Before any destructive or non-reversible data/schema operation, explain the specific operation and obtain explicit user authorization. An application rollback does not roll back database state.

If deployment or smoke verification fails, report the Production URL, deployment ID, commit, state, and error evidence. Do not automatically roll back or mutate Production data; ask how the user wants to proceed.

## Completion report

Report the UAT-tested branch and SHA, UAT Preview URL/deployment ID and check evidence, merge commit on `main`, Production domain/deployment ID/state, and smoke/log results. Clearly distinguish UAT verification, merge completion, and Production verification. Never claim a deployment or check passed without observing its result.
