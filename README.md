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

## Quick start (local)

Requires Node.js 24.x.

```powershell
npm ci
$env:SITE_ORIGIN = 'http://localhost:3000'
$env:TURSO_DATABASE_URL = 'file:./work/watercooler.db'
$env:WATERCOOLER_OWNER_EMAIL = 'owner@example.test'
npm run db:migrate
npm run owner:bootstrap   # prompts for a password and prints recovery codes once
npm run dev
```

Then open `http://localhost:3000`. See [Setup](docs/SETUP.md) for Preview and Production.

## Before a real game

- Use the exact site address your organizer gives you. Preview and Production are separate sites with separate data.
- The app does not send email. Moderators deliver invitations and reminders themselves.
- Phases never open on their own. By default the moderator also locks and publishes each result; a game switched to automatic results locks at its deadline and publishes after a review window unless the moderator steps in.
- Keep invite files, role assignments, private rooms, and backups private.
