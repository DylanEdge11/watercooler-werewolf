---
name: usage-checkpoint
description: Save a clean restart point and schedule the session to resume after the usage limit resets. Use when the rate-limit status reads allowed_warning or rejected, when the next step would launch agents or otherwise use a lot of usage, or when the owner says to pause until the limit resets.
argument-hint: "[check | now | rescue <session_id>]"
---

# Usage checkpoint

The owner has five-hour and weekly usage windows, shared by every session on the account. A task that hits the wall mid-step stops dead and loses its place. This skill does two things before that happens: it saves a restart point that a cold session can continue from, and it schedules the session to wake up when the window resets.

Modes: `check` (default) reads the signal and decides; `now` checkpoints and schedules without deciding, for when the owner says to pause; `rescue <session_id>` schedules a wake-up for a session that already hit the limit (see the end).

## What a session can see (verified 2026-09-29)

Call `get_session` with no `session_id` (load it with ToolSearch, `select:mcp__claude-code-remote__get_session,mcp__claude-code-remote__send_later,mcp__claude-code-remote__delete_trigger`). The field to read is `external_metadata.rate_limit_info`:

| Field | Values seen | Meaning |
| --- | --- | --- |
| `status` | `allowed`, `allowed_warning`, `rejected` | Under the warning line, past it, or hard stop. No percentage is given. |
| `rateLimitType` | `five_hour`, `seven_day`, `ccr_promotional` | Which window the reading is for. |
| `resetsAt` | Unix seconds | When that window resets. A rejected session showed `resetsAt` 08:50:00Z, matching its "resets 8:50am (UTC)" message. |
| `isUsingOverage` | `false` | Never seen `true`. If it is, stop and ask the owner before spending more. |

What it does not give:

- **No remaining budget or percentage.** `allowed_warning` is Anthropic's line and can hold for hours without a stop, so it means "be careful", not "about to stop".
- **No live cost.** `external_metadata.usage` (`cost_usd`, tokens) appears only on a session record after its turn ends; mid-turn it is absent. Sub-agent completion notices report tokens per agent.
- **No push.** Nothing interrupts a running turn. A session only sees the status when it asks, between tool calls.
- **A rejected session cannot act.** Its turn fails with "You've hit your session limit · resets HH:MM (UTC)". Everything that must happen before the wall has to happen before it, which is why the steps below run at the first warning or before an expensive step, not at the wall.
- **The window is account-wide.** A session that cost $0.20 was rejected because other sessions had used the window. Read the status; don't infer it from your own spend.

## The three triggers

| Trigger | Supported? | How |
| --- | --- | --- |
| Usage crosses a threshold before the task is finished | Yes, coarsely | `status` is `allowed_warning` or `rejected` |
| The same, while the task is running | Only between steps | Poll at task start, before launching agents, and at each phase boundary. Not more often: each call costs about 1k tokens of context. |
| The task is predicted to use up usage | **Not detectable** | No budget is readable. Fallback: estimate the cost up front (see Estimating), split the work into phases, and arm the wake-up before any expensive step. |

## Procedure

**0. Read the signal.** Call `get_session` (no id) and note `status`, `rateLimitType`, `resetsAt`, and the session's own `ccr.id`. If the tool isn't available (a local CLI session), do steps 2, 3 and 5, skip 4, and tell the owner to say "continue" after the reset time in the limit message.

**1. Decide.**

| Reading | Do |
| --- | --- |
| `allowed`, next step is cheap | Proceed. Poll again at the next phase boundary. |
| `allowed`, next step launches agents or is estimated at about $10 or more | Run steps 2 to 5 first, then proceed. A fan-out can go from `allowed` to `rejected` inside one step; the old audit with about 20 agents used the limit in under 10 minutes. |
| `allowed_warning` | Run steps 2 to 5 now, then work on in lean mode (below). |
| `rejected` | Your own turn fails before you can read this. The fix comes from another session: `rescue`. |
| `now` mode | Run steps 2 to 5, then stop. |

If the owner has said to pause at the first warning, stop after step 5 instead of working on.

**2. Reach a stopping point.** Finish the atomic step you are in, or undo it; never leave half-edited files. Collect what running agents have returned into your notes, because a dead session loses unread results. Stop agents whose work you won't use (`TaskStop`).

**3. Write the checkpoint** to `.claude/checkpoint.md` using the template below. Aim for a file a stranger with only this file and `git log` could continue from. Keep it under about 60 lines, point to code as `path:line` instead of pasting it, and put no secrets or player data in it (it is committed).

**4. Arm the wake-up.** Compute the time and schedule it:

```sh
date -u -d @$((RESETS_AT + 180)) +%Y-%m-%dT%H:%M:%SZ   # five_hour: reset plus 3 minutes
date -u -d '+5 hours 3 minutes' +%Y-%m-%dT%H:%M:%SZ    # any other window: an upper bound on the five-hour reset
```

Call `send_later` with `at` set to that time, `initiation: "human_request"`, `name: "Resume after usage reset"`, and the resume prompt below as `message`. It delivers into this same session, survives container restarts, and returns a `trigger_id`. Write the `trigger_id` into the checkpoint. Don't use `CronCreate` (session-only, dies with the session) or `ScheduleWakeup` (one hour at most).

The default is this session, so the work comes back where the owner is reading and keeps its context. The prompt cache (one hour here) will be cold after the wait, so the first turn re-reads the whole context at full price. If the context is very large and the work isn't tied to a thread, `create_trigger` with `create_new_session_on_fire: true` and a prompt that says "read `.claude/checkpoint.md` on branch X" starts clean instead.

**5. Save to git, once.** Commit the work in progress and the checkpoint together as `wip: checkpoint before usage reset`. Push to the branch this session was assigned. If you are on `main`, a `version-*` branch, or a detached HEAD (a read-only task such as an audit), create `claude/checkpoint-<topic>` from HEAD and push that instead. Never push to `main` or a `version-*` branch. This is the one exception to "run `npm run verify` before every push": it saves work and is not a review request, so record "verify not run" in the checkpoint and don't open or update a PR from it. It triggers one Vercel Preview build, and no GitHub Actions run.

**6. Tell the owner**, in a line or two: what is saved and where, the reset time in UTC and how long from now, and that it resumes by itself.

**Working on after a warning (lean mode).** One phase at a time, no new agents, read only the files the next step needs. After each phase refresh the checkpoint, push, and poll again. If the next phase is an expensive one, end the turn and let the wake-up carry it.

**Finishing before the wall.** When the task completes: `delete_trigger` every `trigger_id` in the checkpoint, `git rm .claude/checkpoint.md` in the commit that finishes the task, and never let the file into a pull request. An unneeded wake-up costs a full cold-cache turn.

**On wake-up** the prompt below drives the session. If the session is still `rejected`, it re-arms for the new `resetsAt` and stops. A warning alone doesn't block a resume.

## Checkpoint template

```markdown
# Checkpoint
State: PAUSED | RESUMED | DONE      Written: <UTC time>
Why: <status and rateLimitType>, resets <UTC time>
Session: <ccr.id>   Wake-up routines: <trigger_id, ...>
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

## Guardrails for the next phase
- Lean: <max agents, which files to read, what to skip>
```

## Resume prompt (the `message` for `send_later`)

```text
The usage window has reset (scheduled earlier by the usage-checkpoint skill).
1. Call get_session with no id. If rate_limit_info.status is rejected, do not start work: re-arm send_later for the new resetsAt plus 3 minutes, tell the owner, and stop.
2. git fetch, check out branch <branch>, and read .claude/checkpoint.md. Set State to RESUMED.
3. The checkpoint outranks your memory of earlier tool output. Re-read a file before editing it.
4. Continue from "Next, in order", one phase at a time, lean. Poll usage between phases and refresh the checkpoint.
5. When finished: delete the routines listed in the checkpoint, git rm the checkpoint, and tell the owner what is done.
If the checkpoint says DONE, or you have already resumed since this message was scheduled, reply with one line and stop.
```

## Estimating cost

Observed on 2026-09-29, on the session usage counter. These are single observations, not a calibrated model; update them when you learn more.

- Standard `/project-audit`: 4 agents, about 26 minutes, about $21, about 950k agent tokens. That is about $5 per agent. Two reviewers used 75% of the tokens because the diff was 194 files.
- The old full audit (about 20 agents) used up the limit in under 10 minutes.
- An ordinary single-thread build or review session: about $4 to $8.
- A long multi-hour session at high effort: $65 to $130.

The budget is unreadable and shared across sessions, so use the estimate to size phases, not to compare against a limit. Keep a phase to about $20 (one standard audit), so a hard stop costs at most one phase of rework. Write the estimate as one line in the plan before launching agents.

## Rescue: a session that already hit the limit

Run from any other session, for a session that stopped with "You've hit your session limit" and never scheduled a wake-up.

1. `get_session` with that `session_id`. Continue only if `rate_limit_info.status` is `rejected`; otherwise say it didn't stop on the limit and end.
2. `create_trigger` with `persistent_session_id` set to it, `run_once_at` set to `resetsAt` plus 3 minutes, `initiation: "human_request"`, and this prompt: "Your last turn stopped at the usage limit, which has now reset. Run `git status` and `git log -5`, read `.claude/checkpoint.md` if it exists, reconstruct where you were from your own transcript, then continue lean and tell the owner what you resumed." This mode is documented for `create_trigger` but not yet tested end to end.
3. Tell the owner the session, the wake time in UTC, and that it was scheduled from outside.

## Limits of this skill

- It runs only when a session invokes it. That is why `CLAUDE.md` tells every session to poll the status; the skill holds the procedure.
- The warning is coarse and the prediction is a heuristic. Both fail safe: an early checkpoint costs a few tool calls, and a missed one is recovered by `rescue`.
- Work that was neither committed nor pushed can be lost if the container is reclaimed during the wait.
