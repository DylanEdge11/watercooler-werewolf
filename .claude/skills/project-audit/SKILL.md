---
name: project-audit
description: Independent, report-only audit of the repository — by default only what changed since the last audit, with cheap baseline checks first and at most three reviewers; --deep audits everything. Covers code, tests, config, dependencies, `git` history, branches and open PRs, docs, agent instructions, and user-facing text. Builds its own view from the code before reading docs or earlier audits, reproduces every defect, has each finding challenged by a second reviewer, and commits a dated report with stable finding IDs. Changes no code.
argument-hint: "[optional scope: a path, an area, 'PR #N', or a branch] [--deep for the full ten-area audit] [--full to add the long test suite]"
disable-model-invocation: true
---

# Project audit

Give the owner an independent, evidence-backed picture of the repository as it is now, and a worklist that fix branches can cite by ID. You are an outside reviewer. Earlier sessions, including the ones that wrote this repository's docs, rules, skills, and earlier audits, are colleagues whose work you are checking, not authorities. What they wrote are claims to test.

This skill holds no facts about any particular project, and the owner doesn't edit it. Everything it needs comes from the repository, from the owner's arguments, or from a short setup round with the owner when you are invoked (step 0). The `<placeholders>` in the supporting files are for you to fill in at run time from your own setup, map, and findings. Supporting files in this folder:

- [`reviewer-brief.md`](reviewer-brief.md): the prompts for area reviewers and verifiers.
- [`language-review.md`](language-review.md): the prompt and rubric for the docs, instructions, and language pass.
- [`report-template.md`](report-template.md): the report's structure.

## Cost: two modes

A full audit runs a dozen or more agents that each read their files in full, and can use up a session's usage in minutes. So the default is a light run, and the full run is opt-in.

| | Standard (default) | `--deep` |
| --- | --- | --- |
| Scope | Files changed since the last audit's SHA (or the owner's narrower scope), plus their direct callers and tests | Every tracked file |
| Reviewers | At most 3 (see step 3) | One per area, plus language |
| Verification | One verifier for all P1/P2 candidates; the lead re-runs P3s | One verifier per area with findings |
| Use when | Between releases, or any time | Before a major release, after a long gap, or when the owner asks |

Cheap checks always come first (step 1). If the baseline is red, report that and stop before spending on reviewers, unless the owner says to continue.

## Principles

1. The code is the source of truth. Docs, instruction files, commit messages, PR descriptions, code comments, and earlier audits record what someone believed or intended. Build your understanding from the code first, then compare.
2. Follow the rules while you audit them. Obey every safety and process rule in the repository's instructions (`CLAUDE.md`, `CONTRIBUTING.md`, and similar) while you work, including rules you will recommend changing. A recommendation is text in the report, not a change in how you act.
3. Show, don't assert. Every code defect is reproduced. Every doc or language finding quotes the text next to the code or command output that contradicts it. When you can't show something, say what stopped you and mark it Plausible.
4. Calibrate. Report what you saw with the confidence you have. Don't raise a priority to be heard or lower one to be polite. Hold your own report to the language standard you apply to the repository's text.
5. Owner decisions stand; AI claims don't. A decision the owner recorded (usually a dated decisions table) is a constraint. If you find evidence that one rests on a wrong fact or is causing harm, list it under "Decisions worth revisiting" with that evidence; it is not a defect. Everything else earlier sessions wrote is unverified.
6. Report only. Change no tracked file except the report, plus moving a superseded audit into the archive. Delete scratch reproductions before committing.

## Hard floor

Some rules protect people and systems outside the review. The audit may check that they are accurate, enforced, and clear, and may recommend tightening or clarifying them. It never recommends weakening:

- rules that keep work away from production systems and production data, and keep secrets out of output, logs, and commits;
- rules that stop one user's private data from reaching another user;
- rules about the only path to production (for example, PR-only merges to the production branch and no manual production deploys).

During the audit, never connect to production, use production credentials, print a secret's value (cite the file or variable name instead), send email or messages, deploy, or post on PRs and issues. Reproductions use local, in-memory, or throwaway resources, never a shared or hosted environment. Reading metadata from `GitHub` or the hosting provider (branches, PRs, deployments) is fine.

## Priority scale

- **P1**: exposes private data or opens a security hole; loses or corrupts data; leaves a core flow stuck or broken with no way out; or tells users something false about their privacy or safety. Fix before the next release, and before merging any open PR that carries it.
- **P2**: wrong behavior or wrong user-visible text in a working flow; an operational gap that would hurt a real session; a doc or instruction that would lead an operator or agent into a harmful step or block legitimate work. Fix in the current version if it fits.
- **P3**: hardening, cleanup, efficiency without user impact yet, and wording that won't mislead anyone into harm. Backlog.

A code defect marked Plausible is at most P2.

## 0. Setup

Find out as much as you can yourself, then confirm it with the owner in one short round before any review work.

1. Read the repository's instruction files for operational facts only: the working base branch, how to install and test, where audit reports may be committed, safety rules, and who the owner is. Their descriptions of the code are audited in pass 2.
2. Candidate: the working base branch the instructions name, otherwise the default branch. `git fetch` and note its head SHA.
3. Scope: in standard mode, the files changed between the baseline and the candidate (`git diff --name-only <baseline>..<candidate>`), plus their direct callers and tests. The baseline is the SHA in the newest audit report's header; with no earlier audit, review the riskiest paths instead (authentication and authorization, routes returning private data, core game rules, migrations). With `--deep`, everything. The owner's arguments can narrow either to a path, an area, a PR, or a branch. A narrowed audit still runs pass 3 for the IDs in its scope.
4. Survey: uncommitted changes in the working tree; open PRs and branches on origin; whether a release is pending (an open release PR, a certification handoff naming a SHA); whether a current, non-archived audit report exists; whether dependencies are installed; whether the clone is shallow.
5. Setup round. Ask the owner, using a structured question tool if one is available, with a recommended answer for each question. Skip any question the arguments already answer:
   - Candidate: the branch and short SHA you found (recommended), or another. If you found none or several, the question has no default.
   - Scope: changes since the last audit at `<short SHA>`, <n> files (recommended), everything (`--deep`, say it costs several times more), or a narrower scope.
   - Long test suite: no (recommended; say roughly how long it takes), or yes.
   - Only when the survey calls for it: how to handle uncommitted changes (don't stash, reset, or clean them yourself); how to install or run the tests when the repository doesn't say; where to commit the report when the instructions don't say; whether to hold the report's commit until a pending release is out (recommended).

   Keep this round to logistics: the candidate, the scope, the long test suite, and the survey questions above. A logistics-only round keeps pass 1 blind, so it finds what the code shows rather than what the owner expected. If the owner offers a concern anyway, note it in the findings file and check it after pass 1. If every answer is already known, state the setup in one line and carry on. *Don't ask what the owner is worried about or where to look.*
6. Check out the confirmed candidate and record its full SHA. Every result in the report is for that SHA. If the clone is shallow, fetch the full history, or record how far back the history review went.
7. This is a long run and your context may be summarized. Keep a task list, and keep a findings file in a scratch directory outside the repository as the durable record.

| State | What to do |
| --- | --- |
| No instruction files | Find commands in the manifests and CI config. Record the missing instructions as a finding. |
| Dependencies missing | Install them the way the repository says. If that fails, record why and review statically. |
| No tests, or the gates fail | Record it as a finding and keep going. Reproduce with scripts. |
| No earlier audit | Skip pass 3. |
| Very large repository, or time runs short | Cover security and privacy, data integrity, and the core flows first. Mark the report PARTIAL; the coverage ledger shows the rest. |
| The owner can't be asked | Use the recommended setup answers and record them in the report header. Put the step 7 questions in the report as open decisions with your recommendation. |

## 1. Baseline checks

Run these before anything else is written into the working tree, so scratch files can't affect the results:

- The fast gates the repository defines (tests, lint, types, build, dependency audit). Skip the quick integration suite in standard mode unless a changed file is one it covers; run it in `--deep`. Add the long suite only when the owner passed `--full`.
- Run only local suites; hosted, remote, and production-facing suites belong to release certification.
- Record each command, exit code, pass/fail/skip counts, and elapsed time. Give the results to every reviewer so none reruns a gate. A failing gate is a finding. If tests or the build fail outright, stop after this step and report (see Cost) unless the owner says to continue. If a check can't run, record why.

## 2. System map (lead, from code only)

Standard mode maps only the in-scope files and what they touch; do not read the rest of the repository. Before reading any docs, build a short map from the code, manifests, schema, config, tests, and `git log` (use the log for what changed when; its messages are claims):

- every entry point (routes, pages, jobs, scripts), who may call it, and what it reads and writes;
- the data model, and every state machine with its states and the transitions out of each;
- trust boundaries: what each kind of user can see and do;
- external services, and the config and environment variables the code actually reads;
- which tests cover which parts.

Then assign every in-scope file (every tracked file with `--deep`, via `git ls-files`) to exactly one owning area for the coverage ledger. Others may still read it. Lockfiles, generated files, and binary media can be recorded as skipped with the reason instead, unless something about them is itself under review (size, secrets, how they are generated). Start from these areas, and add one when the code has a risk none of them covers:

| Area | What it looks for |
| --- | --- |
| Security and privacy | Who can call each entry point and what comes back (inspect full response bodies, not the UI); the order of origin, auth, and state checks; one user reaching another's data; secrets in code, config, logs, or history; input validation and injection; session and cookie settings; rate limits and lockouts; timing leaks; security headers. |
| Domain rules | The core logic against what users are told; edge cases and ties; states with no way out; invariants that can break; randomness and fairness; logic living outside the module meant to own it. |
| Data, concurrency, and migrations | Multi-step writes that aren't atomic; races and stale writes; whether retries are safe; schema and code drift; unused columns and states; migration safety; backup and restore completeness and consistency; cleanup of expiring data. |
| Entry points and errors | Status codes; errors that are swallowed or leak internals; validation of every input; consistency across similar routes; behavior on partial failure and timeouts. |
| UI, copy, and accessibility | Loading, empty, error, and stale states; text users see (accuracy, consistency, tone); double submits and edits lost on refresh; labels, focus, keyboard use, contrast, reduced motion; phone widths. |
| Performance and cost | Work per request and per poll; sequential round trips; writes on read paths; payload, bundle, and function sizes; cold starts; polling intervals; repository size. |
| Tests and tooling | Behavior with no test; tests that exercise a copy instead of the real code; weak assertions; flaky or order-dependent tests; whether the gates catch what they claim to; lint and type settings. |
| Dependencies, config, build, and deploy | Outdated or vulnerable packages; version mismatches (engines, type packages, runtime); environment variables the code reads versus those in example env files and deploy config; leftover config from old hosting; build, deploy, and CI config. |
| `git` and process | Each branch on origin (ahead and behind, age, purpose, a keep/merge/delete recommendation); each open PR at its head (what it changes, which findings it carries or fixes, conflicts, whether its description matches its diff); history (large or repeatedly re-committed files, secrets ever committed, reported by location only); whether the history shows the workflow the instructions describe. |
| Docs, instructions, and language | Pass 2, below. |

## 3. Blind review (pass 1)

Standard mode: start at most three reviewers, all at once, by grouping the areas below:

1. Security and privacy, plus data, concurrency, and migrations.
2. Domain rules, plus entry points and errors, plus UI, copy, and accessibility.
3. Tests and tooling, plus dependencies, config, build, and deploy, plus the docs, instructions, and language pass (step 4).

Drop a group whose areas have no in-scope files. The lead covers `git` and process (branches, open PRs, history) from metadata with no agent, and performance and cost from the diff, unless a changed file is on a hot path.

Each reviewer reads its in-scope files and the callers and tests it needs, not the whole area. Say so in the brief.

`--deep`: start one reviewer per area except docs and language, all at once. Use a general-purpose agent that can read files and run commands, on the strongest model available. Fill in the area brief from [`reviewer-brief.md`](reviewer-brief.md) for each: the area, its owned files, the map, the SHA, the commands, and the safety rules.

Reviewers don't read docs, the archive, earlier audits, or the skills folder. Agents may load the repository's instruction file automatically; the brief tells them to use it for commands and safety rules and to treat its descriptions of the code as unverified.

Reviewers may run single test files and scripts. A reproduction that needs a build, a server, or a fixed port comes back marked "needs lead run". Run those yourself, one at a time.

## 4. Docs, instructions, and language (pass 2)

In standard mode this is folded into reviewer group 3 and limited to in-scope text plus any instruction or skill file that a changed file makes wrong. With `--deep`, start it at the same time as pass 1; it needs the map, not pass 1's findings. Brief one reviewer with [`language-review.md`](language-review.md), or two when there is a lot of text (one for instruction files and skills, one for maintainer docs and user-facing text). It covers the README and docs; the instruction files; every skill, including this one; user-facing text (in-app guide, on-screen copy, emails); and code comments that make claims. The archive gets a boundary check, and archived records may be opened to trace where a current line came from.

## 5. Earlier audits (pass 3)

Only after passes 1 and 2 have returned, read the current audit reports (any non-archived audit, review, or brief with open items; there may be more than one), plus archived reviews where they help. In standard mode, check only IDs still open; in `--deep`, give every earlier finding ID a verdict at the candidate SHA:

| Verdict | Needs |
| --- | --- |
| Fixed, verified | The original reproduction now passes, or a test covers it. A merged PR title is not evidence. |
| Still open | The problem is still reproducible or visible in the code. |
| Fixed wrong | The change didn't fix it, or introduced a new problem. |
| No longer applies | The code changed so the issue can't occur. |
| Disputed | You think the original finding was wrong. Say why. |

Then:

- A new finding that matches an earlier one keeps the earlier ID and combines the evidence.
- An earlier finding the blind pass missed gets checked and, if it holds, reported. Record in the coverage section which area missed it and why. A gap in this review is worth knowing about.
- The earlier audit's "checked and sound" list is unverified. Say whether pass 1 agrees.
- The owner's decisions carry forward into the new decisions table unless the owner changes them.

## 6. Verification

Start a separate verifier (not the agent that found them) with the verifier brief from [`reviewer-brief.md`](reviewer-brief.md). Standard mode: one verifier for every P1 and P2 candidate together; the lead re-runs P3 reproductions itself and leaves any it can't reproduce as Plausible. `--deep`: one verifier per area with findings. A verifier re-runs each reproduction and tries to prove the finding wrong. It looks for a guard elsewhere, a test that already covers it, an owner decision that makes it intended, or a misread. It returns Confirmed, Plausible, or Rejected, with a priority check.

Drop Rejected findings. Record how many were rejected, and give a one-line reason for each rejected P1 or P2 candidate. Merge duplicates across areas.

## 7. Owner interview

Ask once more, after verification, and only what the owner has to decide: product behavior, wording users will read, priority trade-offs, whether to revisit an earlier decision, and anything that would need a risky or non-additive change. Give each question a recommended answer and one sentence of evidence. If a structured question tool is available, use it; several calls in one sitting are fine when there are more than a few questions. Record the answers in the decisions table. *Don't ask what the evidence already answers.*

## 8. Report

Follow [`report-template.md`](report-template.md). The header records the mode and the baseline SHA, which is what the next standard audit diffs against.

- File: use the existing audit report's folder and naming if the repository has one; otherwise `docs/AUDIT_<YYYY-MM-DD>.md`, adding `-2` if that name is taken.
- IDs: carried-over findings keep their IDs. New findings continue each prefix's numbering from the highest number any superseded audit used. If two earlier reports used the same ID for different things, prefix the carried ID with its source (for example `PERF-3`).
- Audience: write the summary for the owner the instructions describe. Absent a description, lead with a plain-language summary and keep the technical detail below it.
- Self-review: before committing, read the report as its own language reviewer. Quotes are exact; file:line references are at the candidate SHA; every finding states its confidence; nothing claims more than you verified; and the "checked and found sound" list reads as evidence at a SHA, not permission to skip it next time.

## 9. Delivery

1. Delete every scratch file the reviewers and verifiers listed (`audit-scratch-*`, `audit-verify-*`). `git status --porcelain` must then show only the report, and the archive move if you are superseding an audit. If anything else appears, find out what created it before touching it.
2. Supersede: `git mv` each earlier audit whose open items this report now carries into the archive folder, and add a row for each to the archive index.
3. Where to commit: if the repository's instructions allow audit reports directly on the working base branch, commit there. Otherwise, commit on a new branch and open a PR into the base. Never commit to the production branch. Check first:
   - Release pending: if a release candidate is certified, or being certified, at the base branch's current SHA, a new commit moves the branch and can invalidate that certification. Follow the owner's setup answer; if the release started during the audit, ask before committing.
   - Branch moved during the audit: commit on top. The report header names the audited SHA and lists what landed since.
   - The session limits where you can push: push there, and tell the owner where the report is.
4. Commit message: the audited SHA, finding counts by priority, and the earlier-audit reconciliation counts.

## 10. Handoff

```text
AUDIT: COMPLETE            (or AUDIT: PARTIAL — <what wasn't covered and why>)
Candidate: <branch> @ <full SHA>
Report: <path>, commit <SHA>
Top issues: <each P1 in one plain-language line, or none>
Counts: P1 <n> · P2 <n> · P3 <n> · language <n> · rejected in verification <n>
Checks: <each gate and suite: result and counts>
Earlier audit: <n fixed and verified, n still open, n fixed wrong, n no longer apply, n disputed; or none>
Decisions recorded: <n, or none> · Open questions: <n, or none>
Not covered: <from the coverage ledger, or nothing>
```

Stop. Fixes go through the repository's normal change workflow, citing finding IDs.

## Maintenance of this skill

Every run's language pass reviews this file too. Update it when:

- that pass flags something in it;
- a problem it should have caught turns up later (add the lens that would have found it to the area table);
- a new model generation arrives: run it once, and remove steps the model now does well unprompted instead of adding emphasis. Keep the goals, the evidence bar, and the hard floor;
- the tools it relies on change (subagents, structured questions, `GitHub` and hosting access).

Reserve "never" in this skill for the hard floor.
