# Prompt: implement the performance and UX corrections from the 2026-09-25 audit

You are a senior Next.js engineer working in the `watercooler-werewolf` repository (Next.js 16 App Router on Vercel, Turso/libSQL, React 19, Node 24). A performance audit has already been done. Your job is to implement its corrections, in the order given, without widening scope. Every claim below was measured against a `next build` of the repository on 2026-09-25; the file and line references were exact on that day, so re-check them before editing.

Read `CLAUDE.md` first and follow it. In particular:

- Work from the current `version-X.Y` branch (`git ls-remote --heads origin 'version-*'`), never from `main`. Use one `fix/` branch per task below, merged through a pull request. Do not push to `main`, do not touch `.github/workflows`, and do not run `vercel deploy --prod`.
- Run `npm run verify` before every push and `npm run verify:full` before opening the last pull request. Batch commits; do not push after every small fix.
- Never point anything at Production, never print or commit secrets, use `.test` addresses for fixtures.
- Queries stay hand-written SQL with bound parameters through `db/contracts.ts`; multi-statement writes use `db.batch()`; routes stay thin and rules live in `lib/game/`.
- Players must never receive another player's role or private results. Do not change the shape of any JSON a player receives except where a task says so, and keep `FORBIDDEN_PLAYER_KEYS` in `e2e/readiness/browser-fixture.ts` passing.
- The owner is the product manager and reviewer. Explain every change in plain language in the pull request description: what was slow or costly, what changed, how to see the difference.

Do not implement anything from the "Out of scope" section unless the owner asks for it.

## Baseline you are improving (measured)

| Measure | Value before |
| --- | --- |
| Client JS shared by every page (gzip) | ~128 KB across 5 chunks |
| Landing page HTML | 348 KB raw, 103 KB gzip, 605 inline SVG paths, plus a 79 KB theatre chunk |
| Signed-in `/` HTML | 10.6 KB: only the shell "Opening the village…" |
| Fonts emitted | 14 woff2 files, 977 KB; 6 preloaded on every page (~513 KB) |
| `/api/player` traced function bundle | 21.0 MB, of which 18.7 MB is two native libsql binaries |
| `/api/player` database round trips per call | 12 sequential reads, plus 4 more (2 write transactions) from `ensureGameRooms` |
| Client polling | Dashboard, chat and 3 moderator panels each poll every 10 s; 7 endpoints per moderator tab |

Re-measure after each task with the commands in "How to measure" and put the before/after numbers in the pull request.

## How to measure

Traced function bundle size (run after `npm run build`):

```sh
node -e '
const fs=require("fs"),path=require("path");
const dir=".next/server/app/api/player";
const j=JSON.parse(fs.readFileSync(dir+"/route.js.nft.json","utf8"));
let total=0,n=0,big=[];
for(const f of j.files){const abs=path.resolve(dir,f);try{const s=fs.statSync(abs);if(s.isFile()){total+=s.size;n++;if(s.size>300000)big.push([s.size,f])}}catch{}}
console.log("traced files",n,"total MB",(total/1048576).toFixed(1));
big.sort((a,b)=>b[0]-a[0]).forEach(([s,f])=>console.log((s/1048576).toFixed(1)+"MB",f.replace(/.*node_modules\//,"")));'
```

Font preloads and page weight:

```sh
for p in index landing-page moderator guide player-login; do
  printf "%s raw=%s gz=%s fontPreloads=%s\n" $p $(stat -c%s .next/server/app/$p.html) $(gzip -c .next/server/app/$p.html | wc -c) $(grep -o 'as="font"' .next/server/app/$p.html | wc -l)
done
find .next/static/media -name '*.woff2' -exec ls -la {} \; | awk '{s+=$5;n++} END {print n" woff2 files, total "s/1024" KB"}'
```

Database round trips per request: wrap `LibsqlDatabase` in `db/libsql.ts` with a counter in a local script, or temporarily log `statement.sql` in `LibsqlPreparedStatement.statement()` while testing; remove the logging before committing.

---

## Phase 1: low risk, highest payoff. One branch per task.

### Task 1. Stop rebuilding chat-room membership on every read

Evidence: `app/api/player/route.ts:47` and `app/api/rooms/[roomId]/messages/route.ts:15` call `ensureGameRooms()` (`lib/chat/rooms.ts:7-53`) inside GET handlers. Each call runs a 3-statement write batch, two SELECTs, and a second write batch with one upsert per seat per allowed room. This happens on every 10-second poll of every player and again on every chat poll, almost always changing zero rows.

Do:

1. Remove the `ensureGameRooms` calls from both GET paths (the player route and `requireRoomAccess` in the messages route).
2. Call `ensureGameRooms(gameId)` from the writers where membership can actually change, after their write batch succeeds: the assignment release branch in `app/api/games/[gameId]/assignments/route.ts`, the publish branch in `app/api/games/[gameId]/phases/route.ts`, and the reset and restore branches in `app/api/games/[gameId]/operations/route.ts`. Read each branch first; put the call after the `changes` check so a 409 never triggers it.
3. Keep a cheap safety net in the player GET only: `SELECT COUNT(*) AS count FROM chat_rooms WHERE game_id = ?`; call `ensureGameRooms` only when the count is below 3. This protects games created before this change.

Acceptance: the API suite (`npm run test:e2e`) and the readiness browser suite still pass; a player poll now runs no write statements (confirm with the round-trip counter); a Werewolf who dies still sees the Afterlife room after the phase is published.

### Task 2. Stop shipping and loading native SQLite binaries in serverless functions

Evidence: `db/index.ts:3` imports `createClient` from `@libsql/client/node`. In the installed version (0.18.0) that entry statically imports the `libsql` native package (`node_modules/@libsql/client/lib-esm/sqlite3.js:1`), so a 9.4 MB `.node` addon is loaded at every cold start even though deployed functions refuse `file:` URLs (`db/index.ts:20-27`) and only talk HTTP to Turso. File tracing then packs both `@libsql/linux-x64-gnu` and `@libsql/linux-x64-musl` into all 22 API routes. `@libsql/client` exposes a `./web` entry (`node_modules/@libsql/client/package.json` exports) that has no native dependency.

Constraints found during the audit: local development uses `TURSO_DATABASE_URL=file:./work/watercooler.db` (`docs/SETUP.md:28`), so the node client must stay available for `file:` and `:memory:` URLs. The vitest suites build their own `:memory:` clients directly (`lib/auth/bootstrap.test.ts:14`, `lib/db/migrations.test.ts:14`) and do not go through `getDb()`, so they are unaffected.

Do, in `db/index.ts`:

```diff
-import { createClient } from '@libsql/client/node';
+import { createClient as createWebClient } from '@libsql/client/web';
@@ export function getDb(): LibsqlDatabase {
-  database ??= new LibsqlDatabase(
-    createClient({
-      url,
-      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
-    }) as unknown as LibsqlClient,
-  );
+  database ??= new LibsqlDatabase(createRawClient(url));
   return database;
 }
+
+function createRawClient(url: string): LibsqlClient {
+  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;
+  if (isLocalDatabaseUrl(url)) {
+    // Local development only; deployed functions reject local URLs above.
+    // eslint-disable-next-line @typescript-eslint/no-require-imports
+    const { createClient } = require('@libsql/client/node') as typeof import('@libsql/client/node');
+    return createClient({ url, authToken }) as unknown as LibsqlClient;
+  }
+  return createWebClient({ url, authToken }) as unknown as LibsqlClient;
+}
```

If `require` is not available because the package is ESM (`"type": "module"` in `package.json`), use `createRequire(import.meta.url)` from `node:module`, or a top-level `await import()` guarded the same way. Whichever you use, the node entry must not be a static import.

And in `next.config.ts`:

```diff
   serverExternalPackages: ['@libsql/client'],
+  outputFileTracingExcludes: {
+    '*': [
+      './node_modules/@libsql/linux-*/**',
+      './node_modules/@libsql/darwin-*/**',
+      './node_modules/@libsql/win32-*/**',
+      './node_modules/libsql/**',
+    ],
+  },
```

Acceptance: the traced-bundle script reports roughly 2 MB and no `.node` file for `/api/player`; `npm run dev` with a `file:` URL still works; a Preview deployment serves `/api/player` correctly (its Preview database is a remote Turso URL); function duration for the first request after a deploy is lower than before (note both numbers from the Vercel dashboard in the PR). Update `docs/SETUP.md` and `docs/TECHNICAL.md` in one sentence each to say the app uses the HTTP client in deployed functions.

### Task 3. Make the login and claim forms safe against double submission

Evidence: `app/player-login/page.tsx:11-24` and `app/claim/[code]/claim-form.tsx:23-34` neither disable their button nor track a busy state; `app/landing/sign-in-card.tsx:20-58` already does it correctly. Sign-in allows 8 attempts per 15 minutes per identifier and seat claim 3 per hour (`app/api/seats/login/route.ts:28`, `app/api/seats/claim/[code]/route.ts`), and each login verifies a 100,000-iteration PBKDF2 hash, so a second tap during a slow cold start burns attempts. The guide's Help table already lists "Too many attempts".

Do:

1. Add `busy` state to both forms, ignore submits while busy, disable the button and change its label ("Checking…" / "Claiming…"), and clear busy on failure. Copy the pattern from `sign-in-card.tsx`.
2. On a 429, read the `retry-after` header and append "Try again in N minutes." to the error text, in all three forms (login page, claim form, landing sign-in card).
3. In `app/claim/[code]/page.tsx`, the server component already has `code`. Move the seat lookup there: call the same lookup the GET handler uses (extract it into `lib/auth/claim.ts` or similar so the route and the page share one function), and pass `seat` or the error message to `ClaimForm` as props. Remove the `useEffect` fetch in `claim-form.tsx:13-21`. Keep the GET route for backward compatibility.

Acceptance: pressing Enter twice quickly on the login page produces one network request (check in the browser suite with a request counter); the claim page HTML already contains the player's name and game name on first paint; `npm run test:e2e:readiness` passes.

### Task 4. Cut the font payload

Evidence: `app/landing/fonts.ts:1-21` loads Fraunces with `style: ['normal','italic']` and `axes: ['SOFT','WONK','opsz']` (which pulls the full variable font: 149 KB + 120 KB files), and IM Fell English with normal and italic. All four families are attached to `<html>` in `app/layout.tsx:38`, and `paper-theatre.css` uses the `--ll-font-*` variables 56 times, so the families themselves must stay in the root layout. The build emits 14 woff2 files (977 KB) and preloads six (~513 KB) on every page.

Do:

1. Before changing anything, grep `app/**/*.css` for `font-style: italic`, `font-variation-settings`, `'SOFT'`, `'WONK'`, `opsz` and record what the landing theatre actually uses.
2. Remove `axes` from Fraunces and request explicit weights instead (`weight: ['400', '700']` or whatever the grep shows is used). Remove italic from IM Fell English unless the grep shows an italic use that the owner wants to keep; if it does, keep italic on that one family only.
3. Set `preload: false` on `Caveat` and `Special_Elite` (decorative, not on any LCP text).
4. If the theatre relies on the axes for its look, declare a second Fraunces instance with the axes inside `app/landing/fonts.ts`, apply its class only in `landing-shell.tsx`, and leave the root layout on the trimmed instance.

Acceptance: every page reports at most 2 font preloads and the total woff2 size is under 400 KB; the landing page, dashboard, moderator console and guide look the same in the browser suite screenshots (compare before/after by eye and mention it in the PR).

---

## Phase 2: the LCP path. Do these after Phase 1 is merged, in this order, on separate branches.

### Task 5. Parallelise `/api/player`

Evidence: `app/api/player/route.ts:25-247` runs 12 `await db.prepare(...)` calls in sequence (lines 25, 49, 69, 79, 88, 121, 148, 165, 178, 218, 228, 240). Only the seat lookup at line 25 is a real dependency. The `runBoundary` query at line 148 is a separate round trip whose result is bound into the timeline and public-vote queries, although `lib/game/relationships.ts` already expresses the same boundary as a subquery.

Do:

1. Extract the whole read side of the GET handler into `lib/player/dashboard-data.ts` as `loadDashboard(seatId: string, cursor?: { before: string; beforeId: string }): Promise<DashboardData>`. The route becomes: auth, validate the cursor, call `loadDashboard`, return JSON. The response shape must not change (diff the JSON for a seeded game before and after).
2. Inline the reset/restore boundary as a subquery in the timeline and public-vote SQL. Preserve the exact predicate semantics at lines 168-169: events strictly after the boundary, or at the boundary timestamp when they are not themselves `GAME_RESET`/`GAME_RESTORED`.
3. Group the remaining queries into two `Promise.all` stages: stage 1 needs only `gameId`/`seatId` (phase, roster, lover pair, timeline, public votes, rooms, notifications); stage 2 runs only when a phase is open and needs `phase.id` and `permission.actionKind` (proposal, current action, participation count).
4. Add a unit test for `loadDashboard` in `lib/player/dashboard-data.test.ts` using an in-memory client like the existing tests: seed a game, publish a phase, write a `GAME_RESET` event, publish another phase, and assert that only events after the reset appear.

Acceptance: round-trip counter shows the player GET at 3 to 4 sequential steps instead of 14; the readiness suite's forbidden-key check still passes; the new unit test passes.

### Task 6. Render the signed-in dashboard on the server

Evidence: `app/page.tsx:1-5` renders `PlayerDashboard` with no data; `/` is prerendered as a 10.6 KB static shell containing only "Opening the village…" (`app/player-dashboard.tsx:393`), and the real content appears only after hydration, a `setTimeout(0)` and the `/api/player` fetch (`app/player-dashboard.tsx:222-240`). `proxy.ts:9-16` already rewrites cookie-less visitors to the static `/landing-page`, so `/` is only reached by visitors with a session cookie. There is no `loading.tsx` anywhere under `app/`.

Do:

1. Make `app/page.tsx` an async server component with `export const dynamic = 'force-dynamic'`. Call `getCurrentPlayer()`; if it returns an identity, call `loadDashboard(identity.seatId)` (from Task 5) inside a try/catch; pass `initialData` (or `null`) and `initiallyUnauthenticated` to `PlayerDashboard`.
2. In `player-dashboard.tsx`, seed `data` from `initialData`, set `loading` to false when it is present, and set `unauthenticated` from the prop so an expired cookie still shows `PublicWelcome` without a client fetch. Keep the existing polling and `refresh()` unchanged; the first poll simply becomes a refresh.
3. Add `app/loading.tsx` that renders the topbar and empty card frames (`app-shell`, `topbar`, `workspace` with the three columns and their headings) so the streamed shell has the final layout and the data fills in without a layout shift. Do not invent new CSS classes; reuse the ones in `paper-theatre.css`.
4. `new Date(...).toLocaleString()` in the timeline already carries `suppressHydrationWarning`; check that nothing else in the dashboard reads `window` or `localStorage` during the first render (the `roleHidden` read happens inside `refresh()`, which is fine, but move it into a `useEffect` if server rendering makes the role flash visible).

Acceptance: `curl -b ww_player_session=<valid> https://<preview>/` returns HTML that already contains the player's display name and the phase heading; the readiness suite passes, including `FORBIDDEN_PLAYER_KEYS`; Lighthouse on the Preview dashboard shows LCP as the heading, not the spinner text.

### Task 7. Collapse the moderator console's startup waterfall

Evidence: `app/moderator/page.tsx:181-193` calls `/api/moderators/bootstrap`, then `loadGames()` calls `/api/games` (`:157-175`), then `loadGame()` calls `roster` and `assignments` (`:141-155`): three dependent round trips before anything renders. `app/moderator/player-preview/page.tsx:5-11` is `force-dynamic` and awaits a session lookup before sending any bytes.

Do:

1. Extend the `/api/games` GET response with `needsBootstrap: boolean` (computed by the same helper the bootstrap route uses) and, when a `gameId` query parameter is present or games exist, `selected: { gameId, roster, composition, batches, game: { status } }` using the same helpers the roster and assignments routes use. Extract those helpers into `lib/` if they are inline in the routes. Leave the existing routes in place.
2. Change the console's initial effect to one `requestJson('/api/games')` call and seed all state from it. `loadGames()` on the 10-second poll can pass `?gameId=` and reuse the same response, which also removes two of the seven polled endpoints.
3. Add `app/moderator/loading.tsx` and `app/moderator/player-preview/loading.tsx` rendering `BrandHeader` and the "Opening…" line so the shell streams before the database is consulted.

Acceptance: the console's first paint with data needs one API request (check the network tab); the moderator browser suite passes; the number of requests per 10-second poll cycle drops from 7 to 5 (or fewer if you also fold `moderators` and `rooms` into `operations`, which is allowed).

### Task 8. Conditional requests for all polled endpoints

Evidence: `next.config.ts:19-24` sets `Cache-Control: private, no-store` and no `ETag` on `/api/*`, so every 10-second poll (`app/player-dashboard.tsx:231`, `app/private-room-chat.tsx:87`, `app/moderator/page.tsx:196-200`, `app/moderator/operations-panel.tsx:64-90`, `app/moderator/live-game-panel.tsx:64-85`) re-sends an identical payload and calls `setData` with a new object, re-rendering the full page.

Do, without a schema change:

1. Add `lib/http/etag.ts` with `respondJsonWithEtag(request, payload)`: serialise once, compute `sha256` (from `lib/auth/crypto.ts`) of the body, return 304 with the `etag` header when `if-none-match` matches, otherwise the JSON with the `etag` header.
2. Use it in the GET handlers of `/api/player`, `/api/rooms/[roomId]/messages`, `/api/games`, `/api/games/[gameId]/phases`, `/api/games/[gameId]/operations`, `/api/games/[gameId]/rooms`, `/api/games/[gameId]/roster`, `/api/games/[gameId]/assignments`, `/api/games/[gameId]/moderators`.
3. Change the `/api/:path*` header in `next.config.ts` from `no-store` to `private, no-cache, max-age=0`. `no-cache` still forbids serving stale data; it only lets the browser send `If-None-Match`.
4. In every poller, treat a 304 as "no change" and skip the state update. The dashboard's `refresh()` must still handle 401 first.
5. Change the poll interval to 30 s by default and 10 s only while `phase.status === 'OPEN'` and the deadline is within 15 minutes; put the rule in `lib/http/poll-interval.ts` with a unit test. Update the sentence in `docs/TECHNICAL.md` under "Polling" and the guide caption at `app/guide/page.tsx:168` ("about every ten seconds").

Acceptance: a second poll with no game change returns 304 and the React DevTools profiler shows no dashboard re-render; the API suite passes; the private-data check passes (a 304 carries no body, so nothing leaks).

---

## Phase 3: landing page and guide. Lower priority; do only after Phase 2 is merged.

### Task 9. Make the theatre cheap to animate and honour reduced motion

Evidence: `app/landing/scenes/theatre.module.css:24` applies `filter: url(#theatre-sh)` (a `feGaussianBlur` + `feOffset` + `feMerge` filter defined in `theatre.tsx`) to 16 `.th-piece` groups, which are the groups that swing, bob, hop and flap (21 keyframe animations, `theatre.module.css:170-488`). Line 20 registers fill/stroke/opacity transitions on every SVG node (605+ paths). The reduced-motion block at lines 1022-1026 only zeroes delays and hides dust; the infinite animations keep running. On phones the stage is `display: none` (line 1044) but the 348 KB HTML and 79 KB theatre chunk are still shipped and hydrated.

Do:

1. In the reduced-motion block, replace the delay reset with `animation: none !important; transition: none !important;` for `.scene *, .scene *::before, .scene *::after`.
2. Add a `th-moving` class to the groups that animate (find them by the animated selectors: swing, bob, hop, flap, shake, gasp, leap) and give `.th-piece.th-moving` a CSS `drop-shadow()` filter instead of the SVG filter. Keep `#theatre-sh` for static layers only. Compare the look side by side; adjust the shadow offset and blur to match.
3. Split `TheatreScene` so the stage (everything hidden by the phone media query) is a separate component loaded with `next/dynamic` and `ssr: false`, rendered only when `matchMedia('(min-width: 721px) and (min-height: 501px)').matches`. Keep the marquee and the sign-in ticket in the server-rendered HTML so the form is visible before any JavaScript runs on every device.

Acceptance: the phone landing HTML drops below 60 KB raw; a Chrome performance trace during the day/night switch on desktop shows no long tasks over 50 ms after the initial recolour sweep; with "reduce motion" enabled in the OS, nothing on the page moves; the sign-in flow in the readiness suite passes on both projects.

### Task 10. Guide screenshots

Evidence: `public/guide/*.png` are eight 1440×900 PNGs of 268 to 518 KB each, used correctly through `next/image` in `app/guide/page.tsx:52`. Each width and format combination is a paid transformation and the optimizer cache is cleared on every deployment.

Do: re-encode the eight PNGs as WebP at the same dimensions (target 60 to 90 KB each, quality ~82) using a script under `scripts/` so `docs/TESTING.md`'s "regenerating guide media" section can reference it; update the `src` paths; add `images: { formats: ['image/avif', 'image/webp'], minimumCacheTTL: 2678400 }` to `next.config.ts`. Leave the video alone; it already has a poster and `preload="metadata"`.

Acceptance: `du -sh public/guide` drops by roughly 3 MB; the guide page renders every screenshot at the same size.

---

## Out of scope (do not do without the owner's decision)

- **Replacing polling with focus-driven refresh plus Web Push.** The audit recommends it (the game changes a few times a day, and Task 8's ETag is the first step), but it adds a `push_subscriptions` table, a service worker and a `web-push` dependency. Propose it in the final PR description as the next step, with the invocation numbers from Task 8 as the argument.
- **Removing or replacing the animated theatre.** Task 9 makes it cheap; whether to keep it is a product decision.
- **A `game_version` column.** Task 8 uses a content hash so no migration is needed. If the owner later wants a cheaper stamp, follow `docs/SETUP.md#schema-changes` (edit `db/schema.ts`, `npm run db:generate`, register the migration in `scripts/db-migration-runner.mjs` and `db/readiness.ts`).
- **Function region.** The audit could not read the Vercel function region from the API. Ask the owner to confirm in Project Settings → Functions that the region matches the Turso group location; if it does not, that setting change is worth more than Tasks 5 and 6 together and needs no code.

## What "done" looks like

For each task: a `fix/` branch from the version branch, `npm run verify` green locally, a pull request into the version branch whose description states in plain language what was wrong, what changed, the before/after measurement, and how the owner can see it on the Preview deployment. Before the last pull request of each phase, `npm run verify:full` green. At the end, update the baseline table at the top of this file with the new numbers and rename the file's heading to a record of what was done, so `docs/` does not keep a prompt as documentation.
