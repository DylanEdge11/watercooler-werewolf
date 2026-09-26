# Report template

The lead fills this in when writing the report; the owner doesn't edit this file. Keep every section, and write "None found." in a section with nothing in it, so a reader can tell it was checked rather than skipped. Cite file:line at the candidate SHA. Link to the code where that helps the owner.

````markdown
# Project audit: <Month D, YYYY>

- **Candidate:** `<branch>` at `<short SHA>` (`<full SHA>`). <If the branch moved during the audit: "Landed since, not reviewed: <commits>".>
- **Scope:** <everything: code, tests, config, CI, dependencies, git history, branches, open PRs, docs, instruction files, skills, user-facing text; or the narrowed scope>
- **Method:** independent review in three passes: the code first; then docs, instructions, and language checked against it; then earlier audits. <n> area reviewers worked in parallel, and a separate verifier challenged every finding. Every code defect was reproduced unless marked Plausible.
- **Purpose:** a worklist. Each finding has a stable ID for fix branches and PRs to cite. The next audit archives this file.

## 1. Summary for the owner

<One short paragraph on overall health, in plain language.>

What needs attention:

1. <Most important issue, with its IDs, in a sentence or two.>
2. <…>

<Verified reassurances only, for example "No finding exposes one player's private data to another," and only when the privacy area checked it.>

## 2. Evidence

| Check | Result |
| --- | --- |
| <command> | <exit code; counts; elapsed time> |
| Reproductions | <how many defects reproduced, and how (unit, route level, script); scratch files deleted> |
| Not run | <what, and why> |

## 3. Owner decisions

These stand until the owner changes them. Fix branches treat them as settled.

| Topic | Decision | Source |
| --- | --- | --- |
| <topic> | <decision> | <this audit's interview, or carried from <earlier audit>> |

**Open questions** (only if the owner couldn't be asked): <question, recommendation, evidence>.

## 4. Defects

Priority: **P1** <scale line>. **P2** <scale line>. **P3** <scale line>.

### D<n> · P<n> · <plain-language title>

**What happens.** <behavior, and who it affects>

**Where.** <file:line>

**Reproduction.** <the recipe, detailed enough for a fix branch to turn it into a permanent test>

**Fix.** <the smallest change that fixes the cause>

**Confidence.** Confirmed | Plausible (<why it couldn't be reproduced>)

## 5. Efficiency

| ID | Priority | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |

## 6. Redundancy and dead code

| ID | Priority | Finding | Fix |
| --- | --- | --- | --- |

## 7. Test gaps

| ID | Priority | Untested behavior | Suggested test |
| --- | --- | --- | --- |

## 8. Documentation accuracy

| ID | Priority | Doc and line | Claim | What the code does | Fix |
| --- | --- | --- | --- | --- | --- |

## 9. Language in instructions, docs, and user-facing text

### L<n> · P<n> · <label> · `<file:line>`

> <exact current text>

**Provenance.** <short SHA, date, and the context it was written in>

**Why.** <what goes wrong if it stays>

**Proposed:**

> <exact replacement, or "delete">

**Keep firm:** <the strong rules checked and kept, one line each>

## 10. Open pull requests

### #<n> `<branch>`: <title>

<What it changes; findings it fixes, carries, or introduces; conflicts; what has to happen before it merges.>

## 11. Branches

| Branch | State | Recommendation |
| --- | --- | --- |

## 12. Earlier audit

<Which report, at which SHA. Moved to the archive in this commit.>

| ID | Title | Verdict | Evidence |
| --- | --- | --- | --- |

## 13. Decisions worth revisiting

<For each: the decision, the new evidence, and what the owner might consider. Or "None found.">

## 14. Coverage

| Area | Files owned | Read in full | Skimmed | Not read (why) |
| --- | --- | --- | --- | --- |

**Missed in the blind pass:** <earlier findings that pass 1 didn't find, which area should have, and why it missed them>

**Rejected in verification:** <count; one line on each rejected P1 or P2 candidate>

## 15. Checked and found sound at <short SHA>

This is evidence at one commit, not an exemption: the next audit checks these again.

- <what was checked, and the evidence>
````
