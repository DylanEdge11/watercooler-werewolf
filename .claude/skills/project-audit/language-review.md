# Docs, instructions, and language review (pass 2)

The lead fills in each `<placeholder>` from its setup and system map and sends the brief as the agent's whole prompt. When there is a lot of text, split it between two reviewers: one for instruction files and skills, one for maintainer docs and user-facing text. Paste the hard-floor rules and priority scale from `SKILL.md`; don't paraphrase them.

```text
You are reviewing the written text of a software repository against what its code actually does, at a fixed commit. Much of this text was written by earlier AI sessions and is now read, literally, by later ones. Check it for accuracy, and check whether its wording fits its purpose.

Repository: <absolute path>, checked out at <full SHA>. Don't check out anything else, commit, push, or edit tracked files.

System map, built from the code by the lead:
<map>

What to read:
- Instruction files: <e.g. CLAUDE.md, AGENTS.md, CONTRIBUTING>.
- Every skill: <e.g. .claude/skills/*/, including project-audit, the skill running this review>.
- Maintainer docs: <README and the docs folder, excluding audit reports and the archive>.
- User-facing text: <e.g. the in-app guide, on-screen copy, email templates>.
- Code comments that make claims: about security, privacy, or invariants; "unused", "never", "always"; TODOs for work that looks done.
Don't read earlier audit reports; they are reconciled separately.
The archive: check that nothing current tells the reader to follow an archived file, that the archive index matches the folder, and that no archived file contains a secret (report the location, not the value). Beyond that, open an archived file only to trace where a current line came from.

Why this matters. Earlier sessions tend to do a few things. They turn a one-time fix or decision into a permanent rule, and write "never", "always", or "every" where exceptions exist. They drop the reason a rule exists, and stack emphasis (capitals, "IMPORTANT", repeated "must"). They describe an intended design as if it were built, copy one rule into several files that then drift apart, and write for the wrong audience. Later sessions follow instruction files literally, and newer models tend to over-apply rules that are stated emphatically, so this wording changes behavior.

Strong wording is not a defect by itself. Where the stakes justify it, the right verdict is Keep firm. Lean neither toward softening nor toward keeping; judge each line by its accuracy and by what is at stake.

How to review, by audience:
- Instruction files and skills. Does each rule achieve what it's for? Would following it literally, in a situation its author didn't foresee, cause harm or block reasonable work? Is the reason given? Is the strength in proportion to the stakes? Do two files give different instructions for the same thing? Does the git history show the rule being followed? A rule nobody follows is either a wrong rule or a real problem; say which.
- Maintainer docs. Is every factual claim true at this SHA: commands, environment variables, file paths, behaviors, numbers? Where it's safe and local, run a documented command to check that it works as described.
- User-facing text. Every promise made to a user (privacy, what other users can see, what happens when) must match the code. A false promise about privacy or safety is a defect, P1 when users' private data is involved, not a wording issue. After that: consistent terms, a tone that fits the reader, and instructions a user can actually follow.
- Code comments. Only the claims listed above.

Trace provenance before you judge a rule or a strong claim. Find the commit that introduced it: `git log -S '<distinctive phrase>' --format='%h %ad %s' --date=short -- <file>`, or `git blame -L <start>,<end> <file>`. Read that commit's message and diff, and any PR or archived record it points to. Then ask: what situation was it written for, and does that situation still hold? Did it come from an owner's decision, a specific bug, a tool or platform limit of the time, or a general principle?

Labels (one per finding):
| Label | Meaning | Usual fix |
| --- | --- | --- |
| Contradicted | The code or a command's output says otherwise. | Correct the fact. |
| Overstated | An absolute (never, always, every, only) that has legitimate exceptions, or strength beyond the stakes. | Scope it, or state the exception. |
| Out of context | A situational fix, one-time decision, or old tool limit written as a standing rule, or a rule whose reason has been lost. | Add the reason and the condition, or remove it. |
| Over-emphasized | Capitals, "IMPORTANT", "CRITICAL", or repeated "must" where plain wording would do. | Plain wording plus the reason. |
| Stale | Refers to files, tools, hosting, or steps that no longer exist. | Update or remove. |
| Drifted | The same rule appears in several places and they now disagree. | One canonical home; the others link to it. |
| Unclear | Can reasonably be read two ways, or can't be followed as written. | Rewrite. |
| Keep firm | Strong wording you checked and found justified. | None; say why in a line. |

Hard floor. For these rules you may flag inaccuracy, gaps, missing enforcement, or unclear wording, and propose tightening or clarifying. Don't propose weakening them:
<pasted hard-floor rules>
If a floor rule exists only as prose, with no test, lint rule, hook, or config enforcing it, say so. That is often worth a recommendation.

Priority scale:
<pasted scale>
For language findings in particular: a line that could lead an agent or operator into harm, or would block legitimate work, is P2. A false claim in maintainer docs is P2 if following it would break something, otherwise P3. Wording and tone alone is P3.

Evidence. You can't reproduce a sentence, so show it: quote the text exactly, and next to it the code (file:line) or command output that contradicts it, or the provenance that shows it was written for a different situation. If you can't establish either, mark it Plausible.

Return, one block per finding:

### <short, plain-language title>
- Where: <file:line>
- Audience: agent | maintainer | user | code comment
- Current text:
  > <exact quote>
- Label: <label>
- Provenance: <short SHA, date, and one line of context; or "not traced", and why>
- Evidence: <code at file:line, or command output>
- Why it matters: <one or two sentences>
- Proposed text:
  > <exact replacement, or "delete">
- Proposed priority: P1 | P2 | P3
- Confidence: Confirmed | Plausible

Then:
- Keep firm: the notable strong rules you checked, each with a line on why it stands.
- Archive boundary check: the result.
- Coverage: files read in full; files skimmed, and why; files not read, and why.
```
