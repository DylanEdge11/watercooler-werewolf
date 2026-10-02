import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import BrandMark from '../brand-mark';

export const metadata: Metadata = {
  title: 'How to play · Watercooler Werewolf',
  description: 'Rules, roles, and step-by-step instructions for players and moderators of Watercooler Werewolf.',
};

const SECTIONS = [
  ['what', 'What it is'],
  ['rules', 'The rules'],
  ['roles', 'Roles'],
  ['players', 'For players'],
  ['moderators', 'For moderators'],
  ['help', 'Help'],
] as const;

const ROLES = [
  { name: 'Villager', team: 'Village', text: 'No special power. Discuss, read the timeline, and vote wisely.' },
  { name: 'Werewolf', team: 'Werewolves', text: 'Each Night, vote with your pack on whom to attack. You know your packmates and share a private Pack room. You cannot attack another Werewolf.' },
  { name: 'Seer', team: 'Village', text: 'Each Night, investigate one living player. After the result is published, you privately learn their exact role.' },
  { name: 'Bodyguard', team: 'Village', text: 'Each Night, protect one other living player from the pack. Protection does not stop a Day vote or a Hunter shot.' },
  { name: 'Hunter', team: 'Village', text: 'When you are eliminated, you get a short window to take one living player with you.' },
  { name: 'Mason', team: 'Village', text: 'You know the other Masons and share a private Mason room. There are always zero or at least two.' },
  { name: 'Apprentice Seer', team: 'Village', text: 'Waits while the Seer lives. After the Seer is eliminated, inherit their past results and investigate each Night.' },
  { name: 'Mayor', team: 'Village', text: 'Your Day and Final ballot votes count twice. The published ballot lists your vote once, like everyone else’s, and shows no vote totals.' },
  { name: 'Cupid', team: 'Village', text: 'Once, on a Night, link two living players as lovers (yourself included). If one is eliminated, so is the other, whatever their team.' },
] as const;

const SLOT_ROWS = [
  ['1–30', '1'],
  ['31–60', '2'],
  ['61–80', '3'],
] as const;

const HELP_ROWS = [
  ['I lost my invitation link', 'Sign in at Player sign-in with your invitation email and PIN. If that fails, ask the moderator for your seat code.'],
  ['I forgot my PIN', 'Ask the moderator. They can set a new PIN, which signs out your old sessions.'],
  ['“This seat is locked”', 'After 10 wrong PINs in a row your seat stops accepting sign-in. Ask the moderator for a new PIN; that unlocks it.'],
  ['My role says “Not released”', 'The moderator has not released roles yet. Every seat must be claimed first.'],
  ['Save response is unavailable', 'Select a legal player first. The phase may also be closed, your role may have no action this phase, or you may be eliminated.'],
  ['“Too many attempts”', 'Stop retrying and wait as long as the message says (usually up to 15 minutes for sign-in).'],
  ['Moderator: Randomize is disabled', 'Every seat must be claimed and any edited role counts must be saved. Remove anyone who has decided not to play.'],
  ['Moderator: I can’t add or remove a player', 'The roster locks once roles are randomized. Select Save composition to discard the preview and unlock it. After release, the roster is final, but you can add someone as a spectator.'],
  ['Moderator: Hunter cannot be finalized', 'Wait for the Hunter to submit or for their window to expire, then try again.'],
  ['Moderator: an action shows an error', 'Refresh first. Another moderator may have completed it already.'],
  ['Moderator: did the emails go out?', 'Check the Event log under Communications & operations. Each email batch, failed emails, and automatic steps that could not run are listed there, newest first.'],
] as const;

function Shot({ src, alt, caption, width = 1440, height = 900, narrow = false }: { src: string; alt: string; caption: string; width?: number; height?: number; narrow?: boolean }) {
  return (
    <figure className={narrow ? 'guide-shot narrow' : 'guide-shot'}>
      <Image src={src} alt={alt} width={width} height={height} sizes={narrow ? '(max-width: 600px) 100vw, 480px' : '(max-width: 900px) 100vw, 860px'} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export default function GuidePage() {
  return (
    <div className="guide-shell">
      <header className="guide-header">
        <Link className="brand" href="/" aria-label="Watercooler Werewolf home">
          <BrandMark />
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </Link>
        <nav className="guide-header-links" aria-label="Sign in">
          <Link href="/player-login">Player sign-in</Link>
          <Link href="/moderator">Moderator console</Link>
        </nav>
      </header>

      <main className="guide-main">
        <section className="guide-hero">
          <p className="eyebrow accent">How to play</p>
          <h1>A slow-burn game of hidden roles, played between meetings.</h1>
          <p>
            Watercooler Werewolf runs the classic party game over days or weeks. Everyone gets a secret role on their own device,
            votes on their own time, and a moderator publishes each result.
          </p>
          <nav className="guide-toc" aria-label="Guide sections">
            {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
        </section>

        <section className="guide-video" aria-labelledby="video-title">
          <h2 id="video-title" className="sr-only">Walkthrough video</h2>
          <video controls preload="metadata" playsInline poster="/guide/walkthrough-poster.jpg">
            <source src="/guide/walkthrough.webm" type="video/webm" />
            <source src="/guide/walkthrough.mp4" type="video/mp4" />
            Your browser cannot play this video.
          </video>
          <p>A two-minute tour with fictional players: claiming a seat, receiving a role, voting, and the moderator publishing a result.</p>
        </section>

        <section className="guide-section" id="what">
          <h2>What it is</h2>
          <p>
            Werewolf (also called Mafia) is a social deduction game. Most players are Villagers; a few are secretly Werewolves.
            The Village tries to find and vote out the Werewolves. The Werewolves pretend to be Villagers and pick off the Village at night.
          </p>
          <p>This app makes the game work for a busy group spread across a workday:</p>
          <ul>
            <li><strong>Private roles.</strong> Each player sees only their own role and anything their role is allowed to know.</li>
            <li><strong>Official ballots.</strong> Votes and night actions are saved in the app, so nobody has to track them by hand.</li>
            <li><strong>Reviewed results.</strong> A moderator checks each calculated result and publishes it. A moderator can instead switch a game to automatic results: at each deadline the app locks and calculates, then publishes after a review window (60 minutes by default) unless the moderator publishes, corrects, or pauses it first.</li>
            <li><strong>Your own pace.</strong> Each phase stays open for hours, so people play between meetings instead of all at once.</li>
          </ul>
          <p>Talk happens in the app’s <strong>Town Hall</strong> or wherever your group already chats: in person, Slack, Teams, or email. Only what you save in the app counts.</p>
        </section>

        <section className="guide-section" id="rules">
          <h2>The rules</h2>
          <div className="guide-cards">
            <article><h3>Day</h3><p>Every living player votes to eliminate someone. Werewolves vote too, to blend in.</p></article>
            <article><h3>Night</h3><p>Werewolves choose whom to attack. The Seer investigates, the Bodyguard protects, and Cupid may link two lovers. Everyone else waits.</p></article>
            <article><h3>Results</h3><p>The moderator publishes each result. In a game with automatic results, it publishes after the moderator’s review window, or sooner if the moderator publishes it, and your deadline card says when. Eliminated players’ roles are revealed and they become spectators.</p></article>
          </div>
          <p>The game starts with a Day, then alternates Night and Day.</p>
          <ul>
            <li><strong>The Village wins</strong> when no Werewolves are left alive.</li>
            <li><strong>The Werewolves win</strong> when living Werewolves equal or outnumber everyone else still alive.</li>
          </ul>
          <h3>How many players are eliminated</h3>
          <p>Each Day, Night attack, and Final ballot has a number of <em>slots</em>: the most players it can eliminate. Each voter may pick up to that many targets. Slots depend on how many players are alive when the phase opens. With the default setting:</p>
          <table className="guide-table">
            <thead><tr><th scope="col">Living players</th><th scope="col">Slots</th></tr></thead>
            <tbody>{SLOT_ROWS.map(([living, slots]) => <tr key={living}><td>{living}</td><td>{slots}</td></tr>)}</tbody>
          </table>
          <p>Your moderator may set a fixed schedule instead, for example 2 Day eliminations and 2 Night attacks a day for the first week. Either way, each phase shows its slots when it opens, and a phase never eliminates every player left.</p>
          <p>The players with the most votes fill the slots. No votes means no elimination, and a Bodyguard’s protection can leave a slot empty.</p>
          <h3>Ties and the Afterlife</h3>
          <p>During each Day and Final ballot, eliminated players may cast an optional <strong>Afterlife tiebreak vote</strong>. It only matters if the living vote ties for the last slot: then the tied player with the most Afterlife votes goes. If the Afterlife ties too, or didn’t vote for any of the tied players, a recorded random draw decides. The timeline notes when the Afterlife settled a tie on its own, but its votes aren’t published. Night ties among the pack are always settled by a random draw.</p>
          <h3>Final showdown</h3>
          <p>If no team has won by the organizer’s final cutoff, the moderator can start a Final showdown: repeated Final ballots, with no more Nights, until one team wins.</p>
        </section>

        <section className="guide-section" id="roles">
          <h2>Roles</h2>
          <p>Every living player votes during the Day, whatever their role. The moderator chooses which roles are in each game.</p>
          <div className="guide-roles">
            {ROLES.map((role) => (
              <article key={role.name} className={role.team === 'Werewolves' ? 'wolf' : undefined}>
                <h3>{role.name}</h3>
                <p className="guide-team">{role.team}</p>
                <p>{role.text}</p>
              </article>
            ))}
          </div>
          <div className="guide-gallery">
            <Shot src="/guide/role-werewolf.webp" alt="Werewolf dashboard choosing a pack target at night" caption="A Werewolf choosing the pack’s target." />
            <Shot src="/guide/role-seer.webp" alt="Seer dashboard choosing a player to investigate" caption="The Seer choosing whom to investigate, with past results on the right." />
            <Shot src="/guide/role-hunter.webp" alt="Hunter dashboard choosing a final target" caption="A Hunter’s final shot after being eliminated." />
            <Shot src="/guide/role-bodyguard.webp" alt="Bodyguard dashboard choosing a player to protect" caption="The Bodyguard choosing whom to protect tonight." />
          </div>
        </section>

        <section className="guide-section" id="players">
          <h2>For players</h2>
          <h3>1. Claim your seat</h3>
          <p>Open the private link your moderator sends you. Check your name, choose a six-digit PIN, and select <strong>Claim my seat</strong>. The link works once; keep your PIN private.</p>
          <Shot src="/guide/claim.webp" alt="Claim page asking for a six-digit PIN" caption="Claiming a seat from an invitation link." width={760} height={640} narrow />
          <h3>2. Sign in later</h3>
          <p>Go to <Link href="/player-login">Player sign-in</Link> and enter your invitation email and PIN. Your seat code works too.</p>
          <h3>3. Vote or act</h3>
          <ol>
            <li>Open <strong>Today</strong> and read what the current phase asks of you and when it closes.</li>
            <li>Select one or more player cards, up to the limit shown.</li>
            <li>Select <strong>Save response</strong> and wait for the confirmation. Selecting cards alone does not count.</li>
            <li>You can change your mind and save again until the phase closes. Only your latest saved response counts.</li>
          </ol>
          <Shot src="/guide/player-day-ballot.webp" alt="Player dashboard during a Day ballot with a player selected" caption="Casting a Day vote. The page refreshes by itself: every 10 seconds in the last 15 minutes before a deadline, otherwise every 30 seconds. After five minutes without a tap or key press it pauses and says so; tap anywhere to catch up. Once the game ends it stops refreshing." />
          <h3>4. Follow the story</h3>
          <p>The <strong>Official timeline</strong> shows each published result, who was eliminated, and their role. Select <strong>View votes</strong> to see how everyone voted on a Day, or select <strong>Timeline</strong> in the menu for the whole campaign on one page (the latest 100 updates), with who voted for whom each Day. Private results, such as a Seer’s investigation, appear under <strong>Private result history</strong>.</p>
          <Shot src="/guide/player-timeline.webp" alt="Player dashboard showing the full Timeline of published results" caption="The full Timeline: each published result, who was eliminated and their role, and how everyone voted." />
          <p>For the bigger picture, select <strong>Village stats</strong> in the menu (<strong>Stats</strong> on a phone). Pick a day to see how many votes each player received, or choose <strong>All days</strong> to see who has collected the most. You will also find how many players voted each day and how close the vote was, how many players and werewolves are left after each result, a record of who has left, how busy the Town Hall is by day and hour, and a grid of who voted for whom. It uses only what is already public: published results and message counts, never an open ballot, anyone’s private result, or a living player’s role. The chat total counts every room, including private ones; the chat charts show the Town Hall only. It updates by itself when a result is published, and every chart has a <strong>View as table</strong> twin.</p>
          <h3>5. Get email nudges (optional)</h3>
          <p>If your site operator has turned email on, your dashboard has an <strong>Email</strong> card. It is off until you select <strong>Turn email on</strong>. Once it is on you get an email when a phase opens and you have something to do, another half an hour before it closes if you haven’t saved yet, and a short, silly story when each result is published. The emails never say what your role is or what your action is. They do go only to players with something to do, so if your screen is visible to others, know that getting a phase email on a Night means you have a Night action. Every email has a link to turn them off again.</p>
          <h3>Good to know</h3>
          <ul>
            <li>The <strong>Town Hall</strong> is the whole village’s chat, open day and night. Every player and spectator can read it; only living players can post.</li>
            <li>Werewolves and Masons get a private room to chat with their team. Eliminated players can talk in the <strong>Afterlife</strong> room.</li>
            <li>Every chat shows the newest message at the top.</li>
            <li>Select <strong>Town Hall</strong> or <strong>Private room</strong> in the menu to jump to that chat; it lights up briefly so you can spot it.</li>
            <li>The moderator can read every room and may post in them. Their messages are labelled <strong>Moderator</strong> and highlighted.</li>
            <li>Playing where others can see your screen? Use <strong>Hide role</strong> on your role card. It also hides your private rooms, teammates, private results, and any role-only action, so your page looks like any villager’s. The Day vote and the Town Hall stay. At Night you’ll see “You may have a private action”; show your role to see it.</li>
            <li>Once eliminated, you can watch but no longer vote in the village ballot. On each Day you can cast the optional Afterlife tiebreak vote. Please don’t pass information back to living players.</li>
            <li>The moderator may add <strong>spectators</strong> after the game starts. They have no role or vote, see what every player sees publicly, and can chat in the Afterlife, where their name is marked “(spectator)”. They can read the Town Hall but not post there.</li>
          </ul>
        </section>

        <section className="guide-section" id="moderators">
          <h2>For moderators</h2>
          <p>The moderator runs the game but does not play: the console shows every role. You need a moderator account from the site operator, 6–80 players with unique email addresses, and an agreed place for discussion.</p>
          <h3>Set up a game</h3>
          <ol>
            <li><strong>Create the game.</strong> In the <Link href="/moderator">Moderator console</Link>, enter a name, timezone, dates, a final cutoff, and the <strong>Hunter window</strong> (how long an eliminated Hunter has to shoot, 8 hours by default), then select <strong>Create game</strong>. <strong>Advanced: eliminations per phase</strong> sets how many living players each elimination slot covers, with a preview of the slots; most games keep the default of 30. Below it, <strong>Use a fixed elimination schedule</strong> sets exact numbers instead, in stages, such as 2 Day eliminations and 2 Night kills for game days 1–5, then 1 and 1 until the end; a game day is one Day and the Night after it, and skipped calendar days don’t count. The preview lists each stage, and final ballots still use players per Day elimination. Under <strong>Results</strong>, keep <strong>I review and publish each result</strong> or choose <strong>Publish automatically after a review window</strong> (60 minutes by default). You can change all of these under <strong>Game schedule</strong> until roles are released; the Results choice and the elimination schedule can also change at any time in <strong>Run the live game</strong>.</li>
            <li><strong>Add players.</strong> Paste a roster with the header <code>display_name,email</code>, one email address per player, and select <strong>Create private seats</strong>. Then select <strong>Email invites</strong> to send each player their own private link (if the site operator has turned email on), or <strong>Download invite CSV</strong> and send each person only their own message. <strong>Waiting on</strong> lists who hasn’t claimed yet, with <strong>Resend</strong> for a lost email. A resent link replaces the old one. Before you randomize roles, use <strong>Change the roster</strong> to add a late joiner, or <strong>Remove</strong> beside someone who hasn’t claimed; everyone else keeps their seat, and each change adds or removes one Villager. Re-importing the CSV replaces every seat, so everyone would have to claim again. After roles are released, someone who missed the start can still join during the first Day or Night: in <strong>Run the live game</strong>, use <strong>Add a late Villager</strong> and send them the private link it shows. They always join as a Villager, and nothing is announced to other players.</li>
            <li><strong>Balance the roles.</strong> Accept the suggested counts or edit them and select <strong>Save composition</strong>. A 20-player game defaults to 12 Villagers, 3 Werewolves, a Seer, a Bodyguard, a Hunter, and 2 Masons.</li>
            <li><strong>Release roles.</strong> When every seat is claimed, select <strong>Randomize roles</strong>, review the result privately, then <strong>Release roles to players</strong>. Setup is locked after release.</li>
          </ol>
          <p>Want to see what a role looks like to players? <strong>View player preview</strong> opens the Player View Studio with sample data. <strong>Play elimination scene</strong> there replays the announcement players see when someone is eliminated.</p>
          <h3>Run each phase</h3>
          <p>Repeat this loop, starting with a Day and then alternating Night and Day:</p>
          <ol>
            <li><strong>Open.</strong> Choose the phase and a deadline, then select <strong>Open phase</strong>. The deadline starts at the next Day or Night close time from your game settings (for example 4:00 pm for a Day ballot); check it before you open. Phases never open on their own; opening is the one step you always do. To give players more time once a phase is open, enter a later time beside <strong>Change deadline</strong>. A deadline can be moved later but not earlier, and only before voting closes. A phase’s slots are fixed when it opens. To change future slots, use <strong>Elimination schedule</strong> → <strong>Change the elimination schedule</strong>: it marks game days already played and the current one, and a saved change applies from the next phase to open.</li>
            <li><strong>Collect.</strong> <strong>Still to respond</strong> lists, for your eyes only, the living players who haven’t saved a response. Select <strong>Copy nudge message</strong> and paste it into your group chat. On a Day it names who hasn’t voted. At Night it names nobody, because the list would reveal who has a Night role.</li>
            <li><strong>Lock and calculate.</strong> Voting always closes at the deadline, and the console then shows the phase as Locked. With automatic results, the result is also calculated by itself. In review mode or while paused, or to close early, select <strong>Lock responses &amp; calculate</strong>.</li>
            <li><strong>Hunter.</strong> If a Hunter is eliminated, they get the game’s Hunter window (8 hours by default) to shoot. With automatic results the game finishes this as soon as the Hunter shoots, or when the window closes. In review mode, select <strong>Finalize Hunter</strong>.</li>
            <li><strong>Review and publish.</strong> Check the tally and proposed outcome. On a Day, the console also lists the Afterlife’s tiebreak votes and says when they broke a tie. With automatic results, the console says when it will publish; do nothing and it publishes then, marked “Published automatically after the review window”. Select <strong>Approve &amp; publish</strong> to publish sooner, <strong>Override calculated eliminations</strong> to correct it, or <strong>Pause automation</strong> to hold it. In review mode, nothing publishes until you select <strong>Approve &amp; publish</strong>. Only publishing eliminates players, reveals roles, and checks for a winner.</li>
          </ol>
          <Shot src="/guide/moderator-live-game.webp" alt="Moderator console reviewing a calculated result" caption="Reviewing a calculated Day result before publishing it." />
          <p>If a result must be corrected, <strong>Override calculated eliminations</strong> lets you publish a different list with a written reason. The original calculation stays on record. If the corrected list eliminates the Hunter, the Hunter gets a fresh window and chooses their shot again.</p>
          <h3>Finish</h3>
          <p>The game completes as soon as a published result produces a winner. After the final cutoff, you can instead <strong>Enter final showdown</strong> and run Final ballots until someone wins. Afterwards, select <strong>Download JSON backup</strong> to keep a private record.</p>
          <h3>Moderator tools</h3>
          <ul>
            <li><strong>Player choices</strong>, below <strong>Run the live game</strong>, shows every vote and Night action in every phase, with each player’s role: whom the Seer investigated, whom the Bodyguard protected, Cupid’s lovers, the pack’s targets, and the Hunter’s shot. Open phases show choices as they are saved, and a changed choice replaces the earlier one. Select <strong>Show player choices</strong> to open it. Only moderators can see it, so it suits a moderator who isn’t playing.</li>
            <li><strong>Village stats</strong>, below <strong>Player choices</strong>, shows you the same numbers players see: votes per player each day, turnout, who has left, chat activity, and who voted for whom. Select <strong>Show the stats</strong> to open it. It shows no living player’s role and no private result; the chat total counts private rooms too, but only as one number.</li>
            <li><strong>Player email is each player’s choice.</strong> When the site operator has turned email on, players can switch on emails for a phase opening, a half-hour warning, and a themed recap of each result. Phase and warning emails go only to players who have something to do; the recap goes to everyone who turned email on. Your <strong>Operations</strong> event log shows how many players each batch reached, and flags any that failed. Nothing is required from you.</li>
            <li><strong>Announcements</strong> appear in every player’s updates. <strong>Announcement copy</strong> then shows each one ready to paste into an email or a group chat, with <strong>Copy email</strong> and <strong>Copy for chat</strong>.</li>
            <li><strong>Feedback</strong> lists the ratings and comments players and moderators send from the feedback card, with the average. It shows whether each came from a player or a moderator. The list doesn’t name the sender, but the audit log and backups record who sent each one.</li>
            <li><strong>Player access recovery</strong> sets a new PIN for a player who forgot theirs, and unlocks a seat locked after 10 wrong PINs (marked “locked” in the list).</li>
            <li><strong>Chat rooms</strong> (the Town Hall and the private rooms) can be made read-only, and individual messages removed with a reason. Select <strong>Open room</strong> to read a room’s whole history, newest first (<strong>Load earlier messages</strong> at the end goes further back), and to post there. Your messages show to the room as <strong>Moderator</strong>, never your name or email. You can post only while the room is open and the game is running; reopen a read-only room first.</li>
            <li><strong>Spectators</strong> can be added once roles are released and while the game runs. Enter a name and email, select <strong>Add spectator</strong>, and send them the private link shown once. They choose a PIN when they first open it and use the link and PIN to sign in again. They have no role or vote, see the public game (who is alive, published results and ballots), and can read and post in the Afterlife. A player in the game can’t be a spectator. <strong>Remove</strong> ends their access; to replace a lost link, remove them and add them again. Resetting the game removes its spectators.</li>
            <li><strong>Co-moderators</strong> can be added by the game owner, who can also <strong>Remove</strong> one or <strong>Make owner</strong> to hand the game over and stay on as a co-moderator.</li>
            <li><strong>Pause automation</strong> in <strong>Run the live game</strong> stops automatic calculation and publication (for an offsite or a long weekend) until you select <strong>Resume automation</strong>. Deadlines still close voting. Players see “The schedule is paused”.</li>
            <li><strong>Stop game</strong> ends play permanently. <strong>Reset to setup</strong> (owner only) clears the game back to setup after taking a backup.</li>
          </ul>
        </section>

        <section className="guide-section" id="help">
          <h2>Help</h2>
          <table className="guide-table guide-help">
            <thead><tr><th scope="col">Problem</th><th scope="col">What to do</th></tr></thead>
            <tbody>{HELP_ROWS.map(([problem, answer]) => <tr key={problem}><td>{problem}</td><td>{answer}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="guide-cta">
          <h2>Ready?</h2>
          <div className="button-row">
            <Link className="primary-link" href="/player-login">Player sign-in</Link>
            <Link className="secondary-link" href="/moderator">Moderator console</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
