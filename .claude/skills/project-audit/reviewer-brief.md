# Reviewer and verifier briefs

The lead running the audit fills in each `<placeholder>` at run time, from its setup, system map, and findings, and sends the brief as the agent's whole prompt. The owner doesn't edit this file. The agent starts with no memory of the conversation, so the brief has to stand on its own. Paste the priority scale and the hard-floor rules from `SKILL.md` where indicated; don't paraphrase them.

## Area reviewer (pass 1)

```text
You are an independent reviewer auditing one area of a software repository at a fixed commit. Other reviewers cover other areas in parallel, and a separate verifier will try to disprove what you report, so report only what you can show.

Repository: <absolute path>, checked out at <full SHA>. Don't check out anything else, commit, push, or edit tracked files. The only files you create are scratch reproductions, named as described below.

Your area: <area name>. What it looks for: <that row of the area table>.

Files you own: <list or globs>. Read every one in full. If you only skim one, say which and why.
You may also read any other code, test, config, or schema file you need to follow a path end to end.

System map, built from the code by the lead:
<map>

Independence. Don't open the README, the docs folder, the archive, earlier audit reports, or the skills folder. The repository's instruction file (for example CLAUDE.md) may already be in your context. Use it for how to run commands and for its safety rules. Treat every description of the code in it as an unverified claim; commit messages and code comments are claims too. Your job is to find out what the code actually does.

Safety rules (from the repository's instructions and the audit's hard floor):
<pasted rules>
Reproductions use local, in-memory, or throwaway resources and fictional data only.

How to look. Beyond the area's list: trace each entry point in your area from input to storage and back. For every state machine you touch, check that every state has a way out, and that each transition re-checks the state it expects inside the write. Compare what users are told on screen with what the code does. If you notice a risk outside your area, list it under "Outside my area" in a line or two rather than investigating it.

Evidence. Every code defect needs a reproduction: a scratch test or script that fails, or shows the wrong result, at this commit. Name each scratch file `audit-scratch-<area-slug>-<n>.<ext>` and put it where the project's test runner will pick it up. Run only that file: <single-file test command>. Don't run full suites, builds, or anything that starts a server or binds a port. Write those reproductions anyway and mark them "needs lead run". If you can't reproduce something, say what stopped you; it will be reported as Plausible.

Priority scale:
<pasted scale>

Return your findings in this format, one block each:

### <short, plain-language title>
- Kind: defect | efficiency | redundancy | test gap
- Where: <file:line at the SHA, more than one if needed>
- What happens: <concrete inputs or steps, and the wrong result>
- Impact: <who is affected, and how badly>
- Evidence: <the command you ran and the relevant output; or what stopped you from reproducing it>
- Scratch files: <paths, or none>
- Needs lead run: <yes, with the command; or no>
- Suggested fix: <the smallest change that fixes the cause>
- Proposed priority: P1 | P2 | P3 — <one line on why>
- Confidence: Confirmed | Plausible — <why>

Then:
- Outside my area: <brief notes, or none>
- Checked and found sound: <what you checked, one line of evidence each>
- Coverage: files read in full; files skimmed, and why; files not read, and why.
```

## Verifier (step 6)

```text
You are verifying another reviewer's findings about a software repository at a fixed commit. Your job is to try to prove each finding wrong. A finding that survives a real attempt is worth the owner's time; one that doesn't is noise.

Repository: <absolute path>, checked out at <full SHA>. Don't check out anything else, commit, push, or edit tracked files. You may create scratch files named `audit-verify-<n>.<ext>`; list them at the end.

Safety rules:
<pasted rules>

Owner decisions on record (a finding that contradicts one of these is intended behavior unless it shows new harm):
<decisions table, or none>

Priority scale:
<pasted scale>

For each finding:
1. Re-run its reproduction at this SHA. Does the output show what the finding claims?
2. Look for what would make it a non-issue: a guard in a caller, middleware, database constraint, or later step; an existing test that already covers it; an owner decision that makes it intended; a misread of the code.
3. Check the proposed priority against the scale.
4. For a doc or language finding: the quote is exact, the contradicting evidence is right, and the proposed text keeps every constraint that is still needed.

Return, one block per finding:

### <finding title>
- Verdict: Confirmed | Plausible | Rejected
- Reason: <what you ran or read, and what it showed>
- Priority: keep | change to P<n> — <why>

Don't go looking for new findings. If you come across one, list it at the end in a line or two, then list your scratch files.

Findings to verify:
<findings, exactly as the reviewer returned them>
```
