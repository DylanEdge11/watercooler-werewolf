# Product review: what would take Watercooler Werewolf to the next level

- **Date:** September 26, 2026, against `main` at version 1.3 (commit `5904476`).
- **Lens:** UX design, game design, and product management.
- **Scope:** the playable rules (`lib/game/`), the player dashboard, the moderator console, the guide, operations, and the docs. Compared against real-time Werewolf apps, play-by-post Mafia communities, chat-bot Werewolf, and hosted office team-building products.

This is a dated record. It recommends; it does not decide. Findings that are bugs or inconsistencies are marked **[fix]** so they can be pulled into a `fix/` branch without waiting for the roadmap.

## 1. Verdict in one paragraph

The foundation is unusually solid for a v1.3: transactional rules engine with recorded random draws, a reviewed-then-published result pipeline, real privacy boundaries with tests that enforce them, race-safe writes, backups and restore, a distinctive Paper Theatre look, and an in-app guide with video. Nothing on the market does *asynchronous, moderator-reviewed Werewolf for a workplace* this carefully. What holds it back is that the game currently lives entirely inside one browser tab that people have to remember to open, and every phase needs a human to open, lock, review, and publish it. The next level is not "more roles". It is (1) letting the game run itself on a schedule so a month-long campaign costs the moderator minutes a day, (2) meeting players where the office already talks (Slack and Teams, email, calendar), and (3) giving players things to do between ballots so the game stays alive in their heads. Roles, rule options, and a third faction come after those three.

## 2. Where it stands against the field

| Product family | Examples | What they do that this app does not | What this app does that they do not |
| --- | --- | --- | --- |
| Real-time Werewolf apps | Wolvesville, Werewolf Online, Town of Salem | Dozens of roles and a third faction; the role list is public; last wills and death notes; ranked seasons, stats, achievements, cosmetics; in-app village chat with live vote counts; a full role reveal at the end. | Plays over days, not minutes; a human moderator with review and override; audit trail; no accounts or app store; works for 80 people at once. |
| Play-by-post Mafia | MafiaScum, Mafia Universe, Epicmafia forum games | Public running vote counts; inactivity rules with prods and replacements mid-game; "no lynch" as a ballot option; a public role list; end-of-game "dead thread" and mod notes; game archives and player histories. | Official ballots that cannot be miscounted; private night actions that do not depend on the moderator's inbox; tie resolution on record; a mobile-first UI instead of a forum thread. |
| Chat-bot Werewolf | Telegram Werewolf bot, Discord bots, older Slack Werewolf apps | Live where the group already talks; reminders and pings are native; joining is one tap; results post to the channel. | Slow-burn pacing; privacy that survives screenshots; a moderator; scale beyond a dozen players; a real UI for roles and history. |
| Hosted office activities | Team-building vendors offering facilitated Werewolf, Jackbox at work, Slack apps such as Donut or trivia bots | Zero setup for the organiser; a host runs everything; calendar invites; recurring seasons; per-team dashboards; SSO. | Free to run; lasts weeks instead of an hour; the whole company can play; nothing to install. |
| Storyteller-led tabletop | Blood on the Clocktower | Dead players keep one vote and stay engaged; a rich public grimoire for the storyteller; the storyteller narrates and bends the story; role information is deliberately unreliable. | Runs without a room; official record; multi-elimination scaling. |

The gap that matters most: every competitor that succeeds asynchronously (forum Mafia, chat bots) is *where the conversation already is* and *pokes people*. This app is a destination that stays silent. Every competitor that succeeds in offices is *effortless for the organiser*. Here the organiser must be present at every phase boundary.

## 3. Findings and recommendations

Effort tags: **S** under a day, **M** a few days, **L** a week or more. Impact is judged for the stated goal: best office social activity and best Werewolf game.

### A. Let the campaign run itself (highest impact)

Today `publicationMode: 'AUTOMATIC'` exists in the schema but is unused, the weekday cadence and "Day ballot closes / Night actions close" times are informational, phases never open on their own, and `vercel.json` has no cron. For a four-week game that is roughly forty manual open/lock/review/publish cycles, at fixed times, by one person.

1. **Scheduled phases (L, essential).** Use the cadence that is already collected at setup: on each active weekday, open the Day at the configured time, lock at the close time, open the Night, lock it, and so on. Vercel Cron (`crons` in `vercel.json`) calling the existing `/api/scheduler/deadlines` route, extended to open the next phase, is enough. Keep the moderator's deadline override.
2. **Auto-publish with a review window (M, essential, pairs with 1).** Give the moderator a configurable review window (for example 30 minutes) after lock. If nobody intervenes, publish the calculated outcome. Every safeguard already exists: `proposedOutcome`, `reviewedOutcome`, `publishedOutcome`, overrides with reasons. This turns "moderator must act" into "moderator may act". A game with an eliminated Hunter should still wait for the Hunter window.
3. **Moderator digest, not console-watching (M).** One email or Slack message per phase boundary: what published, who has not responded, what needs a decision (Hunter pending, tie, override suggested). The console then becomes an exception tool.
4. **Show who is outstanding, with a one-tap nudge (S).** The live panel shows a count of responses. Moderators nudging in Slack need names. List the players who have not saved a response and add "Copy nudge message" (and, once integrations exist, "Send reminder").
5. **Pause (M).** There is Stop (permanent) and Reset. A month-long game also needs "pause over the long weekend / during the offsite": freeze deadlines, shift the schedule, resume.

### B. Meet players where the office already talks

Discussion is deliberately external ("Talk happens wherever your group already chats"). That is the right call for the office, but the app never reaches into that place, and it never reaches out at all: no reminders, no phase-open notices, no result posts. The only email is the invitation.

6. **Slack and Microsoft Teams app (L, the single biggest adoption lever).** Minimum viable version: an incoming webhook per game that posts phase opens, deadline reminders, and published results (public data only, the same payload the timeline shows) to a chosen channel; a private DM to the Hunter when their window opens. Next: `/werewolf vote` and a "Your turn" DM with a deep link, then sign-in through Slack identity. Two obvious markets (Slack-first startups, Teams-first enterprises); the webhook step alone covers both cheaply.
7. **Email notifications beyond the invite (M).** SMTP is already wired. Add per-player opt-in mail for: phase opened, four hours before close if you have not responded, result published, and Hunter window opened. A daily digest option for people who hate mail.
8. **Web push (M).** The dashboard already polls while visible; a service worker plus the Push API gives phone notifications without an app store.
9. **Calendar feed (S).** An `.ics` subscription per game (and per player) with each phase's close time in the game timezone. Office players live in their calendars.
10. **Copy-for-Slack buttons everywhere (S).** Announcements already generate "email-ready copy" nobody can see. Expose it, add a Slack-formatted variant, and add the same for published results and reminders. This is the cheap bridge until item 6 ships.

### C. Keep players engaged between ballots

A player's visit today is: read the result, pick a card, save, leave. Every successful social deduction product gives players something to *think with* and something to *leave behind*.

11. **Private notebook (S, high value).** A per-player free-text note on the dashboard, autosaved, never shared. Town of Salem, Wolvesville, and every forum player keep one. Cheap, and it turns a 30-second visit into a five-minute one.
12. **Last words and the death note (M).** Let every player pre-write a "last will" that is published when they are eliminated (Seer results, suspicions, jokes). Let Werewolves attach a short death note to a kill. These are the two most-quoted features in Town of Salem and they create the stories people retell at the watercooler.
13. **Publish the role list (S, standard in every version of the game).** Players cannot see which roles are in play. Every real-time app, forum game, and tabletop edition shows the setup. Show the released composition on the dashboard and in the timeline at release, with a per-game option to hide it for hard mode.
14. **Full reveal and recap at the end (M) [fix-adjacent].** On completion, survivors' roles are never shown to players; only eliminated players are revealed. Publish everyone's role at game end, plus a recap: night-by-night what happened, each Seer's results, the Cupid pairing, protection saves, the closest votes, the "MVP" by votes received or cast. This is the moment the whole office talks about; today it ends with a one-line "Village wins".
15. **Suspicion board or public accusation (M).** An optional, non-binding "who I suspect" marker per player, visible to all living players, updated any time. It makes the Day feel alive between the open and the close without moving discussion into the app. Forum games do this with public vote counts; this is the softer version.
16. **Vote visibility option (M).** Today ballots are secret until publication. Offer "open ballot" (live running tally with names, the forum-Mafia standard) as a per-game option. Secret by default stays right for offices where politics are real.
17. **Dead players stay in the game (M).** The Afterlife room is good. Add a "ghost prediction" (dead players guess the wolves; scored at the end) and consider the Clocktower rule where each dead player keeps one final vote for the whole game.
18. **Seasons, stats, and hall of fame (L, later).** Cross-game player history (wins, survival rate, correct votes, times fooled), a season leaderboard, and a per-company "hall of fame". Needs a player identity that persists across games (today a player is a seat in one game). This is what makes it a recurring office ritual instead of a one-off.
19. **Moderator flavour text (S).** Let the moderator attach a short narration to each published result (and pre-write default templates: "The village gathered at the kettle…"). The Paper Theatre curtain call deserves a script.

### D. Rules, roles, and options

The nine roles and the slot system are a sound core. Several standard options are missing, and a few defaults will surprise experienced players.

20. **A third faction (L, the biggest rules gap).** Two-team games get predictable by week two. Add at least one solo role with its own win condition: the **Tanner/Jester** (wins if voted out during the Day) is the classic first pick and needs no night action. Then a **Serial Killer** (kills at night, wins alone) for large games. `evaluateWinner` and the faction type assume two teams, so this is engine work, but it unlocks everything the community expects.
21. **Wolf-side roles (M each).** The pack has no texture. Highest value: **Sorcerer/Wolf Seer** (investigates for the pack), **Minion/Traitor** (knows the wolves, does not appear as one), **Alpha Wolf** (appears as Villager to the Seer once), **Wolf Cub** (two kills the night after it dies), **Lycan** (a Villager who reads as a Werewolf). Even one or two of these fix the "Seer is a truth oracle" problem noted below.
22. **Village roles (S–M each).** **Witch** (one heal, one poison), **Priest/Aura Seer** (learns team only), **Prince** (survives one Day vote), **Tough Guy**, **Old Hag**, **Medium** (reads the Afterlife room), **Village Idiot**, **Spellcaster**, **Troublemaker** (one Day with two eliminations). Pick by what adds stories, not by count.
23. **Lovers' win condition (S).** Cupid pairs across teams but the pair cannot win together. The standard rule (if the two lovers are the last two standing, they win as a couple) is the whole point of Cupid. Add it.
24. **Seer strength (S, option).** The Seer learns the *exact role*. Most rulesets return team only; exact role plus no wolf-side counter-roles makes a confirmed Seer nearly unbeatable. Offer "team only" as the default and "exact role" as an option, and add item 21 for counterplay.
25. **Ballot options (S–M).** Add **abstain / no elimination** as a ballot choice (forum standard; today the only way to skip is not voting, which looks like inactivity). Make **tie handling** configurable: random draw (current), no elimination, revote, or Mayor decides. Consider majority rather than plurality as an option for small games.
26. **Bodyguard limits (S).** No restriction on protecting the same player every night. Add the standard "not the same player two nights in a row" option.
27. **Day 1 with no information (S).** The game starts with a Day, so the first ballot is a blind guess over several real days. Options: start at Night (classic), or a **Day 0 / introductions** phase with no elimination where roles are released and people can post suspicions or a "claim" without consequence. At least make first-phase kind configurable.
28. **Hunter window (S) [fix].** The default is 60 minutes in a game where phases last a working day, and there is no notification channel, so a Hunter eliminated overnight will miss their shot unless they happen to open the page. Default to something like eight hours or "until the next phase closes", surface the setting in the console (it is not editable there today), and pair with item 6/7.
29. **Presets and balance (M).** One preset ladder by size, and a linear power score. Add named presets (Beginner, Classic, Chaos, Large office) and replace the score with a quick simulation (a few thousand random rollouts of the current engine) so "Balanced" means something. The engine is pure, so this is straightforward.
30. **Mid-game twists (L, later).** Moderator-triggered events (a fog night with no Seer result, a double-elimination Day, an anonymous night). Keep for after the core is automated.

### E. Survive a month in a real office

The setup flow handles late joiners and no-shows well. After release, the roster is frozen, and real offices are not.

31. **Replace a player mid-game (M, essential).** Vacations, departures, and quiet quitters happen over four weeks. The schema already has `REPLACED` seats and `predecessor_seat_id`, but no route uses them. Add "replace this seat": a new claim link, the same role and status, chat history retained, an audit event. Forum Mafia has done this for twenty years.
32. **Inactivity policy (M).** Nothing happens to a player who never votes; they simply weaken the village. Add per-game rules: an automatic reminder after N missed phases, a visible "away" flag other players can see, and a moderator "mod-kill / remove from play" with a reason, distinct from a Day vote. Show a per-player participation record to moderators.
33. **Spectator seats (S).** Someone who joined the company in week two, the organiser's manager, or HR often wants to watch. A spectator seat sees the public timeline and the Afterlife room, never a role.
34. **Multiple concurrent games and departments (M).** Large companies will run one game per floor. The console supports several games; the player side assumes one seat per session, so a person in two games has to sign in twice. Consider a lightweight player identity that lists their seats.
35. **Timezone-aware display (S).** Deadlines show as "3h 20m" on the dashboard, which is good, but the absolute time is in the game timezone only on the console. Show both relative and absolute local time to players; distributed teams need it.

### F. Getting in the door

36. **Self-serve organiser sign-up and workspaces (L, needed to be "on the market").** Today an operator bootstraps one owner from a terminal and there is no public sign-up. To be a product, a team lead needs to sign up, create a workspace, and invite co-moderators without touching a shell. Multi-tenant scoping (workspace → games → seats) is the prerequisite for item 18 too.
37. **Magic-link and SSO sign-in (M).** Email plus six-digit PIN is fine for a pilot and the rate limits are good. Offices expect "Sign in with Google / Microsoft" or at least a magic link, and it removes the "I forgot my PIN, ask the moderator" support path entirely.
38. **A playable demo (M).** The Player View Studio is close to a demo but is behind the moderator login. A public "try a five-minute game against bots" (the e2e bot farm already exists) or at least a public Studio would do more for adoption than any landing-page animation.
39. **First-time player onboarding (S).** The role card is one sentence. Add a role-specific "what to do tonight / how to blend in / common mistakes" card that appears once at release, and a "what happens next" strip on the dashboard (Day closes at…, then Night, then results).
40. **Landing page copy (S).** The theatre is beautiful, and it is where organisers land. It needs a plain "What is this, how long does it take me as the organiser, what do players need" section above the fold, and a path to item 38.

### G. Consistency and correctness findings [fix]

These were found while reading; none is a security issue.

41. **Mayor's double vote is not shown in the public record.** The engine counts a Mayor's Day vote twice (`lib/game/engine.ts`), but the player-facing tally in `lib/game/timeline-view.ts` counts one per voter, and the vote ledger lists one line per voter. A player can see "A 3, B 3" with B eliminated and no tie note. Either show weighted totals (and say so in the guide) or hide totals when a Mayor is in play. Showing the weight also quietly reveals that a Mayor exists, which the guide should acknowledge.
42. **Survivors' roles are never revealed to players at completion** (see item 14). The moderator console shows them; players only ever see eliminated players' roles.
43. **"Bodyguard protection stopped a pack attack" is public.** The timeline announces a save. This tells the village the Bodyguard is alive and chose correctly, and tells the wolves the target was protected. Many rulesets just say "no one died". Make it a per-game option; default to the quieter version.
44. **Hunter window default and visibility** (item 28).
45. **Setup fields collected but unused.** `finalRoundMinutes` and `publicationMode: AUTOMATIC` are stored and restored but never used; the weekday cadence and close times are informational. Either wire them (section A) or drop them from the form so moderators do not expect behaviour that is not there. Also, `dayDivisor`, `nightDivisor`, and `hunterWindowMinutes` are not editable in the console at all.
46. **Pilot feedback is written but never read.** Players and moderators can submit ratings; they only appear inside a JSON backup. Add a feedback tab in the console (and later, per-season NPS for organisers).
47. **Announcements' email copy is generated and hidden.** The route builds `emailSubject` and `emailBody`; the console tells the moderator "email-ready copy was generated" with no way to see or send it.
48. **Timeline limit of 100 updates** is fine for now but a 40-player, five-week game with announcements will pass it. Paginate instead of truncating.
49. **Public "N of M submitted" reveals Werewolf count changes.** For a Night phase the participation counter is computed only for the actor's own action kind, so it is safe, but worth re-checking whenever a new night role is added (section D). Add it to the privacy test list in `e2e/readiness/browser-fixture.ts`.

### H. Platform and development items

50. **Notification infrastructure (M, prerequisite for B).** A single `notifications` outbox with channels (in-app, email, Slack, push) and per-player preferences, drained by the cron route. The in-app `notifications` table is the seed.
51. **Vercel Cron (S).** Add the `crons` entry for `/api/scheduler/deadlines` now; it removes "Check deadlines" from the moderator's job even before automation lands.
52. **Multi-tenancy (L, with item 36).** A `workspaces` table above `games`, and moderator accounts scoped to a workspace.
53. **Observability (S).** Operational events exist per game; add a global operator view (error rate, late rejections, mail failures) and Vercel log drains, so the site operator learns about a broken SMTP password before the moderator does.
54. **Accessibility pass (S–M).** Keyboard and reduced-motion are handled in places; run an audit on the candidate grid, the curtain call, the colour contrast of the paper palette, and screen-reader wording for "N of M selected".
55. **Internationalisation (M, later).** All copy is inline English. Offices in Europe and Latin America are a natural market; extract strings before the copy grows further.
56. **Game-engine simulation harness (S).** The engine is pure and well-tested. A small script that plays thousands of random games per composition is cheap and unlocks item 29 and safer role additions.
57. **CI budget (note).** The local-first verify flow is the right response to the Actions cap. When Slack/Teams and notifications arrive, add a contract test that runs against recorded webhook fixtures so those integrations stay inside the fast gates.

## 4. What makes the most sense: a recommended order

The principle: reduce the organiser's cost first, then raise the players' reasons to come back, then widen the rules. Each step should ship as its own version branch through the existing `/werewolf-dev` → `/werewolf-uat` → `/werewolf-prod` flow.

**Version 1.4, "fixes and quick wins" (one to two weeks).** Items 41, 42/14 (at least the full reveal), 43 (option), 28, 45 (wire or remove), 46, 47, 4, 9, 10, 11, 13, 23, 51, 35. Nothing here changes architecture; most are S.

**Version 2.0, "the campaign runs itself" (three to five weeks).** Items 1, 2, 3, 5, 50, 7, 8, 31, 32. After this, a moderator's daily job is reading one digest and occasionally overriding. This is the release that makes a second game likely.

**Version 2.1, "where the office talks" (three to four weeks).** Item 6 (webhook posts and Hunter DM first, then commands), 12, 15, 19, 39, 40, 33. This is the release that makes the game spread inside a company.

**Version 3.0, "a real Werewolf" (four to six weeks).** Items 20, 21, 22 (a curated set of six to eight new roles), 24, 25, 26, 27, 29, 56, 16, 17. Ship roles in pairs with a preset that uses them, and update the guide's role gallery each time.

**Version 3.x, "a product" (ongoing).** Items 36, 37, 52, 38, 18, 34, 53, 54, 55, 30.

If only three things can be done: scheduled phases with auto-publish (1+2), Slack/Teams result posts and reminders (6, webhook level), and a proper end-of-game reveal and recap (14). Those three convert a well-built pilot into something an office keeps running.
