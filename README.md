# Watercooler Werewolf

A browser-based Werewolf game for 6–80 players and a moderator. Players receive private roles, vote during Day, and use role powers at Night. The moderator opens each phase, reviews its result, and publishes it.

**New player or moderator? Start with [How to Use Watercooler Werewolf](docs/HOW_TO_USE_WATERCOOLER_WEREWOLF.md).** It covers joining, every role, running a complete game, and common problems, with screenshots from a fictional Vercel Preview game. No coding or ChatGPT account is needed to play. An [offline browser-readable copy](docs/HOW_TO_USE_WATERCOOLER_WEREWOLF.html) embeds the screenshots.

## Choose your guide

| I want to… | Read |
| --- | --- |
| Play or moderate my first game | [How to Use Watercooler Werewolf](docs/HOW_TO_USE_WATERCOOLER_WEREWOLF.md) |
| Recover access, back up, stop, or reset a game | [Operations and recovery](docs/OPERATIONS.md) |
| Install locally or configure Vercel/Turso | [Setup guide](VERCEL_SETUP_GUIDE.md) |
| Rehearse with fictional players | [Pilot testing](docs/PILOT_TESTING.md) |
| Run automated browser tests | [Local browser checks](docs/PLAYWRIGHT_READINESS.md) · [Hosted Preview runbook](docs/PLAYWRIGHT_HOSTED_RUNBOOK.md) |
| Understand the implementation | [Technical reference](docs/TECHNICAL.md) |
| See dated verification evidence | [Implementation checkpoint](docs/IMPLEMENTATION_PROGRESS.md) · [Hosted QA report](docs/PLAYWRIGHT_HOSTED_QA_REPORT.md) |
| See what this documentation review changed | [Documentation audit](docs/DOCUMENTATION_REVIEW_2026-09-20.md) |

## Before the first game

The site operator must configure the application and create the first moderator. Players receive a private claim link and choose a six-digit PIN; afterward, they can sign in with the invitation email and PIN. The seat code remains available as a fallback. Moderators use their own email and password.

- Use the **exact game URL supplied by the organizer**. Preview and Production are separate environments.
- The moderator must open phases and publish results manually. The displayed weekday schedule does not run the game automatically.
- Invitations and announcements are not emailed by the app. Deliver each invitation privately; announcements appear in the game.
- Keep invite exports, role assignments, private messages, and backups private.

## Maintainer quick start

From this `project` directory, use Node.js 22.x and follow the [local setup steps](VERCEL_SETUP_GUIDE.md#proof-a-run-everything-locally-with-dummy-data). Configure a disposable local database, then run `npm ci`, `npm run db:migrate`, `npm run owner:bootstrap`, and `npm run dev`, in that order. Bootstrap displays recovery codes once.

Run the checks in [Pilot testing](docs/PILOT_TESTING.md#release-verification) before a release. Never run fictional-data helpers against Production.

## Documentation status

Reviewed September 20, 2026. The current stack is Next.js on Vercel with Turso/libSQL. The user guide is checked against the current source and recorded Vercel Preview evidence; it does not certify that Production matches Preview. Older migration plans, test prompts, and [BUILD_STATUS.md](BUILD_STATUS.md) retain historical context and are not first-time user instructions.
