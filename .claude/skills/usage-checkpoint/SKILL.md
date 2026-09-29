---
name: usage-checkpoint
description: Save a clean restart point and schedule the session to resume after the usage limit resets. Use when the five-hour or weekly usage reaches 95%, when the next step would launch agents that could push it past the limit, or when the owner says to pause until the limit resets.
argument-hint: "[check | now | rescue <session_id>]"
---

# Usage checkpoint

The owner has five-hour and weekly usage windows, shared by every session on the account. A task that hits the wall mid-step stops dead and loses its place. This skill does two things before that happens: it saves a restart point that a cold session can continue from, and it schedules the session to wake up when the window resets.

The trigger is **95% of either window** (`TRIGGER = 0.95`; change it here). Warnings are not a trigger and never stop work: the session keeps going at normal pace after the checkpoint.

Modes: `check` (default) reads usage and decides; `now` checkpoints, schedules and stops, for when the owner says to pause; `rescue <session_id>` schedules a wake-up for a session that already hit the limit (see the end).

## Reading usage (verified 2026-09-29)

Usage is a fraction, readable from the session's own event stream. Load the tools with ToolSearch: `select:mcp__claude-code-remote__get_session,mcp__claude-code-remote__list_events,mcp__claude-code-remote__send_later,mcp__claude-code-remote__delete_trigger`.

1. Once per session, call `get_session` with no id and note `ccr.id`.
2. Call `list_events` with that `session_id`, `kinds: ["rate_limit_event"]`, `limit: 100`. Events run oldest to newest, so take the last one. If the page has none, page back with `before_id` set to the response's `first_id`, up to 3 pages. If still none, fall back to the coarse status below.
3. In `rate_limit_info.unifiedWindows`, read `five_hour.utilization` and `seven_day.utilization` (0 to 1, two decimals) and each window's `resetsAt` (Unix seconds). Note the event's `created_at`: an event appears when the harness records a new reading, not after every call.

What has been observed:

- This session at 15:21 UTC: five-hour 63%, weekly 37%.
- The warning (`status: allowed_warning`, with `surpassedThreshold`) starts at 90% on the five-hour window and 75% on the weekly one. It can hold for hours.
- Readings are sparse while usage is calm (this session: one in its first 25 minutes) and arrived every 30 seconds to 4 minutes in a session already past a warning (weekly 87%). So a poll may return an older reading; check its `created_at`. The readings get denser exactly when it matters.
- One session read 99% at 04:16:52Z and was rejected (utilization 1) at 04:24:38Z, under 8 minutes later. Overage is disabled for the org (`overageDisabledReason: org_level_disabled`), so 100% is a hard stop.

Coarse fallback: `get_session` (no id) gives `external_metadata.rate_limit_info` with `status` (`allowed`, `allowed_warning`, `rejected`), `rateLimitType` and `resetsAt`, but no percentage.

Not available:

- **Live cost.** `external_metadata.usage` (`cost_usd`, tokens) appears on a session record only after its turn ends.
- **A push.** Nothing interrupts a running turn. A session sees usage only when it asks, between tool calls.
- **Any action once rejected.** The turn fails with "You've hit your session limit · resets HH:MM (UTC)", so the checkpoint and wake-up must be set before the wall.
- **Per-session usage.** The numbers are account-wide, so parallel sessions move them.

## The three triggers

| Trigger | Supported? | How |
| --- | --- | --- |
| Usage crosses a threshold before the task is done | Yes, exactly | Either window at 95% or more |
| The same, while the task is running | Yes, between steps | Poll at task start, before launching agents, and at each phase boundary. Not inside one long tool call. |
| The task is predicted to use it all up | Partly | Read usage before and after each phase to get the points it burned. If usage plus the last phase's burn reaches 95%, treat it as crossed now. The first phase has no history, so size it with the cost table below. |

## Procedure

**0. Read usage** as above and note both windows and the time.

**1. Decide.**

| Reading | Do |
| --- | --- |
| Both windows under 95%, and the next phase is not projected to reach 95% | Proceed. Poll again at the next phase boundary. |
| A window at 95% or more, or projected to reach it | Run steps 2 to 5 now, then keep working (below). |
| `now` mode | Run steps 2 to 5, then stop. |
| Your own turn fails with the session-limit message | You can't act. Another session runs `rescue`. |

**2. Reach a stopping point.** Finish the atomic step you are in, or undo it; never leave half-edited files. Collect what running agents have returned into your notes, because a dead session loses unread results. Stop agents whose work you won't use (`TaskStop`).

**3. Write the checkpoint** to `.claude/checkpoint.md` using the template below. Aim for a file a stranger with only this file and `git log` could continue from. Keep it under about 60 lines, point to code as `path:line` instead of pasting it, and put no secrets or player data in it (it is committed).

**4. Arm the wake-up.** Arm one for each window at 95% or more (or projected to reach it) that has none yet. Compute the time from that window's `resetsAt`:

```sh
date -u -d @$((RESETS_AT + 180)) +%Y-%m-%dT%H:%M:%SZ   # the window's reset plus 3 minutes
```

Call `send_later` with `at` set to that time, `initiation: "human_request"`, `name: "Resume after usage reset"`, and the resume prompt below as `message`. It delivers into this same session, survives container restarts, and returns a `trigger_id`. Write each `trigger_id` and its window into the checkpoint. Don't use `CronCreate` (session-only, dies with the session) or `ScheduleWakeup` (one hour at most).

The default is this session, so the work comes back where the owner is reading and keeps its context. The prompt cache (one hour here) will be cold after the wait, so the first turn re-reads the whole context at full price. If the context is very large and the work isn't tied to a thread, `create_trigger` with `create_new_session_on_fire: true` and a prompt that says "read `.claude/checkpoint.md` on branch X" starts clean instead.

**5. Save to git, once.** Commit the work in progress and the checkpoint together as `wip: checkpoint before usage reset`. Push to the branch this session was assigned. If you are on `main`, a `version-*` branch, or a detached HEAD (a read-only task such as an audit), create `claude/checkpoint-<topic>` from HEAD and push that instead. Never push to `main` or a `version-*` branch. This is the one exception to "run `npm run verify` before every push": it saves work and is not a review request, so record "verify not run" in the checkpoint and don't open or update a PR from it. It triggers one Vercel Preview build, and no GitHub Actions run.

**6. Tell the owner**, in a line or two: usage now, what is saved and where, the reset time in UTC and how long from now, and that it resumes by itself.

**Working on after the trigger.** Keep going at normal pace. Two rules: don't launch agents whose results wouldn't return before the wall (a dead session loses them; leave that fan-out for the wake-up); and at each phase boundary refresh the checkpoint, push, and read usage again. When the wall comes, the wake-up carries on.

**Finishing before the wall.** When the task completes: `delete_trigger` every `trigger_id` in the checkpoint, `git rm .claude/checkpoint.md` in the commit that finishes the task, and never let the file into a pull request. An unneeded wake-up costs a full cold-cache turn.

**On wake-up** the prompt below drives the session. If it is still rejected, it re-arms for the new `resetsAt` and stops.

## Checkpoint template

```markdown
# Checkpoint
State: PAUSED | RESUMED | DONE      Written: <UTC time>
Usage: five_hour <n>% (resets <UTC>), seven_day <n>% (resets <UTC>)
Session: <ccr.id>   Wake-ups: <trigger_id for window, ...>
Branch: <name>   Base: <version branch>   Commit: <short sha>   Tree: clean | wip committed
Checks last run: <npm test / verify result, or "verify not run">

## Goal
<the owner's ask, quoted or tightly paraphrased, and the acceptance checks>

## Done
- <item> (<commit or evidence>)

## Next, in order
1. <the first step, concrete enough to start without reading anything else; note how big it is>
2. ...
Needs the owner: <questions or approvals, or none>

## Decisions already made
- <default chosen and why, so the resume doesn't ask again>

## Don't redo
- <files already reviewed, findings already verified, commands already run>

## Burn so far
- <phase>: <points of the five-hour window used>
```

## Resume prompt (the `message` for `send_later`)

```text
The usage window has reset (scheduled earlier by the usage-checkpoint skill).
1. Call get_session with no id. If rate_limit_info.status is rejected, do not start work: re-arm send_later for its resetsAt plus 3 minutes, tell the owner, and stop.
2. git fetch, check out branch <branch>, and read .claude/checkpoint.md. Set State to RESUMED.
3. The checkpoint outranks your memory of earlier tool output. Re-read a file before editing it.
4. Continue from "Next, in order", one phase at a time. Read usage between phases and refresh the checkpoint.
5. When finished: delete the routines listed in the checkpoint, git rm the checkpoint, and tell the owner what is done.
If the checkpoint says DONE, or you have already resumed since this message was scheduled, reply with one line and stop.
```

## Estimating cost

Observed on 2026-09-29, on the session usage counter. These are single observations, not a calibrated model; update them when you learn more.

- Standard `/project-audit`: 4 agents, about 26 minutes, about $21, about 950k agent tokens. That is about $5 per agent. Two reviewers used 75% of the tokens because the diff was 194 files.
- The old full audit (about 20 agents) used up the limit in under 10 minutes.
- An ordinary single-thread build or review session: about $4 to $8.
- A long multi-hour session at high effort: $65 to $130.

Dollars can't yet be converted to points of the window, so the measuring stick is the gauge: log the points each phase burns under "Burn so far" and project the next phase from them. For the first phase, size it at about $20 (one standard audit).

## Rescue: a session that already hit the limit

Run from any other session, for a session that stopped with "You've hit your session limit" and never scheduled a wake-up.

1. `get_session` with that `session_id`. Continue only if `rate_limit_info.status` is `rejected`; otherwise say it didn't stop on the limit and end.
2. `create_trigger` with `persistent_session_id` set to it, `run_once_at` set to `resetsAt` plus 3 minutes, `initiation: "human_request"`, and this prompt: "Your last turn stopped at the usage limit, which has now reset. Run `git status` and `git log -5`, read `.claude/checkpoint.md` if it exists, reconstruct where you were from your own transcript, then continue and tell the owner what you resumed." This mode is documented for `create_trigger` but not yet tested end to end. If `rateLimitType` is `seven_day` the wake time may be days away; say so.
3. Tell the owner the session, the wake time in UTC, and that it was scheduled from outside.

## Limits of this skill

- It runs only when a session invokes it. That is why `CLAUDE.md` tells every session to read usage; the skill holds the procedure.
- Between readings the session is blind. A phase that burns more than the gap to 100% can still hit the wall before the next poll; the projection rule narrows that but doesn't close it, and `rescue` covers what is left.
- Work that was neither committed nor pushed can be lost if the container is reclaimed during the wait.
