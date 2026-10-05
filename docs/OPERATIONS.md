# Operations and recovery

Reference for moderators and the site operator: what each operational control does and what it cannot undo. For how to play and run a normal game, see the in-app guide at `/guide`.

The moderator console groups its controls into five tabs under the game bar. Check **Selected game** first; every action applies only to that game.

| Tab | What is on it |
| --- | --- |
| **Setup** | **Game schedule**, **Sign-ups** (open and close the public link, **Waiting sign-ups**), **Import the roster** (**Change the roster**, **Waiting on N players**), **Balance the roles**, **Review assignment batch**, and **Start over** (cancel an unfinished setup). Opens first until roles are released. |
| **Run game** | Game health (**Roster**, **Living**, **Sessions**, **Deadlines**, **Activity (24h)**, **Check deadlines**), **Run the live game** (open a phase, **Still to respond**, lock, review and publish, **Automatic results**, **Elimination schedule**, **Add a late Villager**), **Player choices**, and **Village stats**. Opens first once roles are released. |
| **People** | **Player access recovery**, **Spectators**, **Co-moderator access**, and **Moderator applications** (owner only). |
| **Messages** | **Official announcement** and **Announcement copy**, **Chat rooms**, and **Feedback** with **Send your own feedback**. |
| **Safety & records** | **Event log**, **Verified backup**, **Recovery restore**, and **Fail-safe controls** (**Stop game**, **Reset to setup**) under **Danger zone**. |

Three things keep you oriented. The **Launch checklist** beside the page (above it on a phone) shows the four launch steps and jumps to each. A **Next step** note under the game bar says what to do now before and after a game, and the top of **Run the live game** says what to do for the current phase. A dot on **Run game** means a result, Hunter follow-up, or locked phase is waiting for you, and a number on **Safety & records** counts new problems in the event log (a failed email batch, or an automatic step that could not run), so nothing urgent hides behind another tab. Opening **Safety & records** clears the number, and a problem logged after that brings it back. A number on **Setup** counts people who signed up and are waiting for you to accept them, and a number on **People** counts moderator applications waiting for the owner; both stay until each is dealt with. What your last action did (a confirmation, or an error) is pinned under the tab bar wherever you have scrolled: a confirmation fades after a few seconds, and an error stays until you select **Dismiss** or do something else. A link such as `/moderator#messages` opens that tab.

## Who can do what

| Action | Any moderator of the game | Game owner only |
| --- | --- | --- |
| Run phases, publish, override | ✓ | |
| Announcements, room moderation, backups | ✓ | |
| Reset a player's PIN, sign out a player | ✓ | |
| Stop the game | ✓ | |
| Open, close, and review player sign-ups | ✓ | |
| Add or remove co-moderators, transfer ownership | | ✓ |
| Take and decide moderator applications | | ✓ |
| Reset, restore, cancel setup | | ✓ |

## Quick reference

| Need | Steps | Result |
| --- | --- | --- |
| Open each next phase automatically | **Run the live game** → **Change how results publish** → tick **Open the next Day or Night automatically after each result publishes** → **Save** | Off for every game until you tick it, and it works only in automatic mode. As soon as a result publishes (automatically or by you), the next phase opens: a Night after a Day, a Day after a Night, closing at the game's next Day or Night close time on an active weekday. A reset or restore turns it off again. It never opens the first Day or final showdown, and it leaves the game for you once the next close time would fall after the final cutoff. Players who turned email on get the usual "phase opened" email. The audit log records the change as `AUTOMATION_SETTINGS_UPDATED`, and the opening as `PHASE_OPENED` with no moderator. |
| Hold automatic results | **Run the live game** → **Pause automation** | Nothing calculates, publishes, or opens on its own until **Resume automation**. A deadline that passes still closes voting and shows the phase as Locked. Players see "The schedule is paused". |
| Switch to reviewing every result | **Run the live game** → **Change how results publish** → **I review and publish each result** → **Save** | Takes effect at once, including for a result already waiting. Switching back publishes a waiting result once it has waited the window. |
| Change eliminations per phase mid-game | **Run the live game** → **Elimination schedule** → **Change the elimination schedule** → edit the stages → **Save schedule** | Applies from the next phase to open, named in the panel; the open phase and earlier phases keep their slots. Stages already played show **Played** and the current game day's stage shows **Current**. Players aren't told; they see the new slot count when that phase opens. Recorded in the audit log with the schedule before and after. Editable until the game is completed, stopped, or cancelled; the players-per-elimination numbers stay locked after release. |
| Notify players | **Messages** → **Official announcement** → title and message → **Publish notice** | Appears in every player's updates. No email is sent; **Announcement copy** shows the email and a chat version of each announcement with **Copy email** and **Copy for chat**. |
| Chase missing responses | **Run the live game** → **Still to respond** → **Copy nudge message** | The list names living players who haven't saved a response for the open phase and is for the moderator only. The copied Day message names who hasn't voted; the Night message names and counts nobody, so it is safe to post in a group chat. |
| Check emails and automatic results | **Safety & records** → **Event log** | The last 20 entries, newest first: each email batch ("Day 2 opened: emailed 7 players.", and for a result whether its story was written by AI or came from the standard template), failed emails, automatic steps that could not run, and deadline locks. Warnings are highlighted. Late player attempts are counted in **Activity (24h)** instead of listed. |
| Read player feedback | **Messages** → **Feedback** | Every rating and comment for the game, newest first, with the average. The list says player or moderator, not who; the audit log and backups record the sender. |
| Use a list, sign-ups, or both | **Setup** → **Sign-ups** and/or **Import the roster** | Either alone works, and you can use both in either order. Open sign-ups first, accept people, then paste your list: with anyone already on the roster the button reads **Add these players to the roster**, and the list is added to them. Everyone already there keeps their seat and link, a person on the list who is already on the roster is skipped, and one who had signed up is shown as accepted. A roster of 6 or more starts from the standard role counts for its size (adding a single player keeps your counts). **Replace the whole roster** starts over from the list instead: it asks you to confirm, removes every seat (including people accepted from sign-ups, who go back to waiting and can be accepted again), and everyone must claim again. The invite file and **Email invites** cover everyone either way; the file from an add holds only the people just added. |
| Let people sign up for a game | **Setup** → **Sign-ups** → **Open sign-ups** → copy the link and share it | Anyone with the link can enter a name and an email. They wait under **Waiting sign-ups**; nothing is emailed to them and nothing reaches the roster until you accept them. **Replace link** ends the old link. Opens only before roles are randomized, and pauses while they are. |
| Accept people who signed up | **Setup** → **Sign-ups** → **Accept** beside a name, or **Accept all N** | Each becomes an unclaimed seat, exactly like an imported player, and one set of private links is shown once for **Download invite CSV**. A roster below 6 players has no role counts yet; at 6 the standard preset is set (a change of more than one player resets the counts to the preset for the new size). Then **Email invites** works as usual. |
| Stop taking sign-ups | **Setup** → **Sign-ups** → **Close sign-ups** | The link says sign-ups are closed. People already waiting stay on the list and can still be accepted or declined; **Reopen sign-ups** brings the same link back. |
| Turn someone down, or take them off again | **Setup** → **Sign-ups** → **Decline** beside a waiting name; for someone already accepted, **Remove** beside them under **Waiting on N players** | Declined and removed people are listed under **declined**, and **Put back** returns them to waiting. Someone you declined who signs up again changes nothing (they see the same confirmation), so put them back if you change your mind. Declining frees room on the list, which holds 300 pending and accepted sign-ups. |
| Let someone apply to co-moderate | **People** → **Moderator applications** → **Open applications** → share the link | The same public link shows an application form. Applications wait for the owner; nothing is emailed to the applicant until you approve. **Replace link** on this card ends the old link at any stage of the game (it replaces the sign-up link too). If you remove a co-moderator who joined by applying, their application moves to **declined**, where you can **Reconsider** it. |
| Approve an applicant | **People** → **Moderator applications** → **Approve** beside them | A new person gets an emailed setup link to choose their own password (one use, 7 days); if the site can't send email, the link is shown to you once to send yourself. Someone who already has an account is added at once. Either way they become a co-moderator. **Send a new link** under **approved** replaces a lost one; **Withdraw** cancels it. |
| Add a late player before roles are randomized | **Setup** → **Import the roster** → **Change the roster** → name and email → **Add player** | A new unclaimed seat and one more Villager. Copy the private link shown once, or **Email** it from **Waiting on N players**. Locked once roles are randomized. |
| Add a late player after roles are released | **Run the live game** → **Add a late Villager** → name and email → **Add late Villager** | Only during the first Day and Night. The player always joins as a Villager, and nothing is announced. Copy the private link shown once and send it to them; they choose a PIN when they open it. Once they sign in, the player counts players see go up by one. The audit log records `LATE_VILLAGER_ADDED`. An email that belongs to a spectator is refused; remove the spectator first. |
| Give players more time | **Run the live game** → **Change deadline** → a later date and time → **Change deadline** | Only while the phase is open and before its deadline passes. A deadline can be moved later, never earlier. Players see the new time on their next refresh, and the closing-soon email is sent again before the new deadline. The audit log records the old and new times. |
| Drop a no-show | **Setup** → **Import the roster** → **Waiting on N players** → **Remove** beside the player | Their link stops working and one Villager is removed. Only unclaimed players can be removed. Locked once roles are randomized. |
| Re-send a lost invitation | **Setup** → **Import the roster** → **Waiting on N players** → **Resend** beside the player | The player gets a fresh link by email; their old link stops working. Needs [invite email](SETUP.md#invite-email). |
| Add a helper | **People** → **Co-moderator access** → email and a 12+ character password → **Add co-moderator** | A new account shows one-time recovery codes; deliver access privately. An existing moderator keeps their password. To avoid handling a password, let them apply instead (see **Approve an applicant**). |
| Remove a helper | **People** → **Co-moderator access** → **Remove** beside them → confirm | They lose access to this game at once. Their account and any other games stay; you can add them again. |
| Hand the game to someone else | **People** → **Co-moderator access** → **Make owner** beside a co-moderator → confirm | They become the owner and you stay on as a co-moderator. Only the owner can reset, restore, cancel setup, or manage moderators, so the new owner has to transfer it back. |
| Player forgot their PIN, or their seat is locked | **People** → **Player access recovery** → player, new six-digit PIN, reason (5+ characters) → **Reset player PIN** | The player's old sessions are signed out and the seat unlocks. A seat locks after 10 wrong PINs in a row and is marked "locked" in the list. Deliver the PIN privately. |
| Moderator forgot their password | Sign-in page → **Forgot password? Use a recovery code** → email, unused code, new password → **Recover access** | The code is used up and old sessions end. Without a code, contact the operator. There is no email reset. |
| Let someone watch | **People** → **Spectators** → name and email → **Add spectator** | Copy the private link shown once and send it to them. They choose a PIN when they first open it. Afterwards they sign in on the home page with the email you entered and that PIN, or open the link again. They have no role or vote, see the public game, and can chat in the Afterlife. Only while the game runs, and never with a player's email. **Remove** ends their access; if they lose their link before opening it, remove and add again. A spectator who has chosen a PIN and forgets it, or is locked out, needs **Reset PIN** (next row). Reset removes all spectators. |
| Spectator forgot their PIN, or is locked out | **People** → **Spectators** → **Reset PIN** beside their name → new six-digit PIN, reason (5+ characters) → **Reset PIN** | Shown only for spectators who have opened their link. Everywhere they were signed in is signed out, a lockout (10 wrong PINs in a row, marked "locked" in the list) clears, and the new PIN works at once, from the home page with their email or from their link. Tell them the new PIN privately. The reason and your name go in the Event log as a warning from `SPECTATOR_ACCESS`; the PIN is never logged. |
| See every choice players made | **Run game** → **Player choices** (below **Run the live game**) → **Show player choices** | Every phase of the current run, newest first, with each player's current vote or Night action and everyone's role: the Seer's investigation, the Bodyguard's protection, Cupid's pair, each Werewolf's targets, the Hunter's shot, Day and Afterlife votes. In each phase the **Special powers** (Seer, Apprentice Seer, Bodyguard, Cupid, Hunter) are listed first, and the pack's targets and the votes are separate lists (**Pack targets**, **Day votes**, **Afterlife tiebreak votes**) that stay closed until you open them. The newest phase starts open and older phases closed; the line beside each phase counts what it holds. Open phases show choices as they are saved. Moderators only; it is meant for a moderator who isn't playing. It loads only while expanded, then refreshes every 30 seconds and after your own changes; what you opened stays open through a refresh, even a failed one. |
| See how the game is going | **Run game** → **Village stats** (below **Player choices**) → **Show the stats** | The same numbers players see on their **Village stats** tab: votes received per player for each day, turnout, who has left, chat activity, and who voted for whom. Nothing private is included. Chat messages in the headline count every room; the chat charts show the Town Hall only. It loads only while expanded and refreshes after your own changes. |
| Read a room | **Messages** → **Chat rooms** → **Open room** | Shows the room's whole history, newest at the top; **Load earlier messages** at the end pages back 100 at a time. The tabs switch rooms. The short feed under the rooms shows only the latest messages across all of them. |
| Post in a room | **Messages** → **Chat rooms** → **Open room** → message → **Post as Moderator** | Members see it as "Moderator", highlighted, never your name or email. Works in the Town Hall, Pack, Mason, and Afterlife rooms, only while the room is open and the game is running. Reopen a read-only room to post. |
| Moderate chat | **Messages** → **Chat rooms** → **Make read-only** / **Reopen**, or **Remove** a message with a reason | Removal and purges blank the message in the game, including moderator messages. |
| Clear old chat | **Messages** → **Chat rooms** → **Purge expired** | Blanks messages older than the retention period (default seven days). |
| Keep a record | **Safety & records** → **Download JSON backup** | A private file with roles and room contents. |
| End play | **Safety & records** → **Stop game** → reason → confirm | Permanent. See [Stop](#stop). |
| Start over | **Safety & records** → **Reset to setup** → exact game name → confirm | See [Reset](#reset). |
| Recover setup | **Safety & records** → **Recovery restore** → snapshot → **Restore to setup** → exact game name → confirm | See [Restore](#restore). |

## Backups

A backup contains the game's configuration, roster, role assignments, phases, actions, results, events, rooms and messages, announcements, notifications, feedback, and operational log. It never contains PIN or password hashes, claim codes, the public sign-up link, or session tokens. Spectators and their Afterlife messages, the sign-up list, and moderator applications are not included. Reset leaves the sign-up list alone. Restore removes the seats that were not in the backup, so anyone you had accepted from sign-ups after the backup goes back to waiting and can be accepted again.

Each backup has a SHA-256 checksum and is stored with the game. A backup is taken automatically before every Reset and Restore. Chat text in a backup is kept even after the live messages are purged or removed, so treat backups as private.

**Where backups live.** Stored backups are rows in the same Turso database as the game, so they protect against mistakes (a wrong Reset or Restore) but not against losing the database itself. For that, rely on Turso's point-in-time restore for the database, and on the JSON files a moderator downloads with **Download JSON backup**, which are the only copies outside Turso. Keep those files private. A scheduled export outside Turso is planned before the first paying company.

## Stop

Stop requires confirmation and a reason of at least five characters. It:

- sets the game to `STOPPED`, closes every open or pending phase, and blocks player actions;
- makes all rooms read-only; and
- shows players a stopped message.

There is no Resume. Stopping twice changes nothing. A completed or cancelled game cannot be stopped.

## Reset

Owner only; requires the exact game name. A backup is taken first. Reset returns the selected game to `DRAFT` and:

- signs out all players and invalidates every claim link;
- removes role assignments, phases, submissions, results, notifications, announcements, room memberships, and messages; and
- keeps the audit history and the backup.

Afterwards, import the roster again, send the new invitations, and release roles again. Resetting a clean draft is harmless; a cancelled game cannot be reset.

## Restore

Owner only; requires the exact game name. Restore rebuilds a game's **setup** (configuration, roster, and role counts) from a stored snapshot. It does not restore a game in progress, and there is no file upload.

It verifies the snapshot's checksum, takes a safety backup, and returns the game to `DRAFT`. Every seat gets a new one-time claim link, so **select Download fresh invites immediately** (the codes are not shown again) or use **Email invites** in the roster card. The console moves to **Setup** when the game returns there (a reset does the same). The result is in the banner under the tab bar, and Setup shows the **Download fresh invites** button at the top until you leave the game, so nothing is left behind on the tab you came from. PINs, sessions, and roles are never restored.

## Cancel setup

Owner only, for games that were never released. **Cancel setup and start new game** permanently cancels the unfinished game and invalidates its invitations and player sessions.

## Credentials

- The first moderator account is created by the operator with `npm run owner:bootstrap` (see [Setup](SETUP.md)). There is no public sign-up.
- Bootstrap and new co-moderator accounts show eight one-time recovery codes. Store them in a password manager; only hashes are kept.
- Players sign in with their invitation email and PIN, or their seat code.

## Player email

When the site operator has set up email ([SETUP](SETUP.md#player-email)), each player can turn on emails from their dashboard. They are off until a player chooses. You do nothing to send them.

- **Phase opened** goes out when you open a phase, to opted-in players who have something to do. On a Night, only players with a Night action are emailed; the wording never says what the action is.
- **Closes soon** goes out half an hour before a deadline to the same players if they have not saved yet. It is skipped for phases of an hour or less.
- **Result published** goes to every opted-in player, alive or eliminated, when a result is published by you or automatically. It is a short themed story built from the public result only.

Each batch leaves a line in the event log under **Safety & records** ("Day 2 opened: emailed 7 players.") and a warning if any email failed. A mail failure never blocks opening, locking, or publishing. Players who turned email on and later leave the game, or whose address is on a reserved test domain, are skipped.

## Deadlines and automatic results

Phases open on their own only when the moderator has ticked **Open the next Day or Night automatically after each result publishes** (see above); otherwise the moderator opens each one, and the first Day and final showdown are always the moderator's. Server-side deadlines reject late submissions even when no moderator is watching.

New games use **review** mode: the moderator locks, calculates, and publishes each result. A moderator can switch a game to **automatic** mode, when setting it up or at any time in **Run the live game**; it then runs itself. At the deadline the phase locks and the result is calculated. A Hunter follow-up finishes when the Hunter shoots or their window closes. The result publishes once it has waited the **review window** (60 minutes by default). Each automatic step runs on the next visit to the moderator console or a player dashboard after it is due, and on the scheduler route, so no cron is required. Automatic publications record no moderator, are marked "Published automatically after the review window" in the console and the Timeline, and use exactly the same calculation as **Approve & publish**.

The moderator always wins. Before the window ends you can **Approve & publish**, **Override calculated eliminations**, or **Pause automation**; an automatic publish that races any of these changes nothing, and so does an automatic opening of the next phase that races a pause, a switch to review mode, or unticking **Open the next Day or Night automatically**. **Pause automation** stops automatic calculation, Hunter follow-ups, and publication until **Resume automation**, and players see "The schedule is paused". **Change how results publish** switches between automatic and review mode and sets the window at any time. Each change, pause, and resume is recorded in the audit log. In review mode, including every game created before version 1.4, nothing calculates or publishes by itself. A reset or restore clears a pause and turns off **Open the next Day or Night automatically**, so a new run starts with it off; tick it again after you release roles if you want it.

A passed deadline always closes voting, in every mode and while paused: a late response is refused, and the phase shows as Locked once the moderator console or the scheduler route next checks it. Review mode and Pause only stop the automatic calculating and publishing that would follow.

If an automatic step cannot run, an `AUTOMATION` warning appears in the event log under **Safety & records** (and a number appears on that tab), and the step retries on the next check.

In review mode the moderator console still checks for expired phases every 30 seconds while it is open, on any tab, and locks them (a late response is refused at the deadline either way); **Check deadlines** does the same on demand.

The scheduler route `GET` or `POST /api/scheduler/deadlines` with `Authorization: Bearer <CRON_SECRET>` runs the automatic steps for every automatic game and locks expired phases in review-mode games. Without `CRON_SECRET`, the endpoint returns 503. See [Scheduler](SETUP.md#scheduler).
