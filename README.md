# Watercooler Werewolf

A browser-based Werewolf game for offices and other busy groups. Six to eighty players each get a secret role on their own device, vote on their own time over days or weeks, and a moderator reviews and publishes every result.

**New players and moderators:** open `/guide` on your game's site for the rules, every role, and step-by-step instructions, with screenshots and a walkthrough video.

## Documentation

| I want to… | Read |
| --- | --- |
| Learn the rules or run a game | The in-app guide at `/guide` (source: [`app/guide/page.tsx`](app/guide/page.tsx)) |
| Recover access, back up, stop, reset, or restore a game | [Operations and recovery](docs/OPERATIONS.md) |
| Install locally, deploy to Vercel, or release a change | [Setup and deployment](docs/SETUP.md) |
| Run tests, rehearse a game, or verify a Preview | [Testing](docs/TESTING.md) |
| Understand the code | [Technical reference](docs/TECHNICAL.md) |
| Read old reports and migration records | [Archive](docs/archive/README.md) |

## Run it locally

Requires Node.js 24.x: `npm ci`, create `work/` and `.env.local`, `npm run db:migrate`, `npm run owner:bootstrap`, `npm run dev`. The exact commands are in [Setup → Run locally](docs/SETUP.md#run-locally). Deploying to Preview and Production is in the same document.

## Before a real game

- Use the exact site address your organizer gives you. Preview and Production are separate sites with separate data.
- Email, public sign-up, and moderator applications are all optional, and each game's sign-ups and applications start switched off. Nobody is emailed until a moderator accepts or approves them ([invite email](docs/SETUP.md#invite-email), [player email](docs/SETUP.md#player-email), [sign-ups](docs/OPERATIONS.md#roster-and-sign-ups)).
- Phases open and results publish only when the moderator does it, unless the moderator switches a game to automatic results ([how that works](docs/OPERATIONS.md#deadlines-and-automatic-results)). The first Day and the final showdown are always opened by the moderator.
- Keep invite files, role assignments, private rooms, and backups private.
