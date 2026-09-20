# Pilot Testing Guide

Use this guide for fictional local/staging verification. Never run pilot helpers against production data or mix the fictional fixture with a real roster.

## Setup

Requirements:

- Node.js 22.13+
- npm
- local preview running at `http://localhost:3000` by default
- fictional moderator credentials

Install and start:

```text
npm install
npm run dev
```

The setup helper uses [../fixtures/roster-20.csv](../fixtures/roster-20.csv) and writes a one-time invite CSV under `outputs/`.

Mutation is deliberately gated. PowerShell example:

```powershell
$env:PILOT_ALLOW_MUTATION = 'yes'
$env:PILOT_MODERATOR_PASSWORD = 'a-fictional-12-character-password'
npm run pilot:setup
```

Use `PILOT_BASE_URL` only for an explicitly approved fictional staging environment and also set `PILOT_ALLOW_REMOTE=yes`.

On a fresh clone, start the preview and open the printed `/signin-with-chatgpt?return_to=%2Fmoderator` URL as the configured local site owner. Then rerun setup. If owner verification is missing, setup stops before creating a game.

`WATERCOOLER_OWNER_EMAIL` is a deployment secret. `.env.example` contains fictional values only.

## Automated rehearsal

After the fictional moderator exists:

```text
npm run pilot:rehearsal
```

The rehearsal exercises real HTTP routes for claims, stale-preview rejection, Hunter override/follow-up, private Seer history, Stop, Reset, session invalidation, and roster re-import. It uses local `.test` data by default and does not deploy or send invitations.

## Manual show-and-play

Use a disposable game. Keep the moderator in one browser profile and test players in separate profiles/private windows.

1. Import a fictional roster of 6–80 players and privately retain the one-time invite CSV. The included fixture remains a 20-player rehearsal baseline.
2. Claim every seat with unique six-digit test PINs.
3. Review the generated preset. For six players it is one Werewolf and five Villagers; the 20-player baseline is 12 Villagers, 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 2 Masons. Presets are starting points, not a balance guarantee. Randomize, inspect assignment evidence, and release roles.
4. Verify each player sees only their role and permitted teammates/rooms.
5. Run a Day ballot. Submit, revise, lock, propose, and publish. Verify only the latest revision counts and confirm timeline/living-count/role-reveal behavior.
6. Run Night actions for Werewolf attack, Bodyguard protection, and Seer investigation. Verify protection and the private exact-role Seer result.
7. Exercise a no-vote or tie, a reasoned moderator override, private-room messaging, moderation, and an announcement.
8. Check Operations after mutations and use **Check deadlines** on an expired phase.
9. After an ordinary published phase and a past final cutoff, enter Final Showdown and test a Final Ballot. Verify illegal phase kinds are rejected, no-vote keeps Final Showdown open, and a winning publication completes the game.
10. Export a verified JSON backup.
11. Test Stop, then owner-only Reset using the exact game name. Confirm old sessions/claim links fail and audit/backup history remains.
12. Collect private pilot feedback and record defects/rule questions before using any real roster.

The moderator console always exposes a game selector and **Start new setup** action. An unfinished setup can be cancelled only by its owner after confirmation; invite links and player sessions are invalidated, while audit history remains. The player dashboard polls every ten seconds for phase, result, notification, and stopped-state changes while preserving an unsaved ballot selection. **Check for updates** remains available manually.

Desktop and 390x844 visual checks require a connected browser; this checklist does not replace that QA gate.

## Release verification

Run:

```text
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm audit --omit=dev --audit-level=high
npm audit --json > audit-full.json
```

The production-only audit is a release gate. Review the full audit as well because the Vinext/Vite/Cloudflare build graph participates in the deployed Worker build.

Remaining pilot gates include hosted end-to-end, authorization, concurrency, recovery, and accessibility regression coverage, followed by the first fictional 20-player pilot and feedback backlog.
