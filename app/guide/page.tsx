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
  { name: 'Mayor', team: 'Village', text: 'Your Day and Final ballot votes count twice. The published ballot shows your vote once, so your role stays hidden.' },
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
  ['My role says “Not released”', 'The moderator has not released roles yet. Every seat must be claimed first.'],
  ['Save response is unavailable', 'Select a legal player first. The phase may also be closed, your role may have no action this phase, or you may be eliminated.'],
  ['“Too many attempts”', 'Stop retrying and wait for the limit to reset (usually 15 minutes for sign-in).'],
  ['Moderator: Randomize is disabled', 'Every seat must be claimed and any edited role counts must be saved. Remove anyone who has decided not to play.'],
  ['Moderator: I can’t add or remove a player', 'The roster locks once roles are randomized. Select Save composition to discard the preview and unlock it. After release, the roster is final.'],
  ['Moderator: Hunter cannot be finalized', 'Wait for the Hunter to submit or for their window to expire, then try again.'],
  ['Moderator: an action shows an error', 'Refresh first. Another moderator may have completed it already.'],
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
            <li><strong>Results on time.</strong> At each deadline the app locks the phase and calculates the result. It publishes automatically after a review window (60 minutes by default), unless the moderator publishes, corrects, or pauses it first. A moderator can instead choose to review and publish every result by hand.</li>
            <li><strong>Your own pace.</strong> Each phase stays open for hours, so people play between meetings instead of all at once.</li>
          </ul>
          <p>Talk happens wherever your group already chats: in person, Slack, Teams, or email. Only what you save in the app counts.</p>
        </section>

        <section className="guide-section" id="rules">
          <h2>The rules</h2>
          <div className="guide-cards">
            <article><h3>Day</h3><p>Every living player votes to eliminate someone. Werewolves vote too, to blend in.</p></article>
            <article><h3>Night</h3><p>Werewolves choose whom to attack. The Seer investigates, the Bodyguard protects, and Cupid may link two lovers. Everyone else waits.</p></article>
            <article><h3>Results</h3><p>Each result publishes automatically after the moderator’s review window, or sooner if the moderator publishes it. While it waits, your deadline card says when it will publish. Eliminated players’ roles are revealed and they become spectators.</p></article>
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
          <p>The players with the most votes fill the slots. A tie for the last slot is settled by a recorded random draw. No votes means no elimination, and a Bodyguard’s protection can leave a slot empty.</p>
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
            <Shot src="/guide/role-werewolf.png" alt="Werewolf dashboard choosing a pack target at night" caption="A Werewolf choosing the pack’s target." />
            <Shot src="/guide/role-seer.png" alt="Seer dashboard choosing a player to investigate" caption="The Seer choosing whom to investigate, with past results on the right." />
            <Shot src="/guide/role-hunter.png" alt="Hunter dashboard choosing a final target" caption="A Hunter’s final shot after being eliminated." />
            <Shot src="/guide/role-bodyguard.png" alt="Bodyguard dashboard choosing a player to protect" caption="The Bodyguard choosing whom to protect tonight." />
          </div>
        </section>

        <section className="guide-section" id="players">
          <h2>For players</h2>
          <h3>1. Claim your seat</h3>
          <p>Open the private link your moderator sends you. Check your name, choose a six-digit PIN, and select <strong>Claim my seat</strong>. The link works once; keep your PIN private.</p>
          <Shot src="/guide/claim.png" alt="Claim page asking for a six-digit PIN" caption="Claiming a seat from an invitation link." width={760} height={640} narrow />
          <h3>2. Sign in later</h3>
          <p>Go to <Link href="/player-login">Player sign-in</Link> and enter your invitation email and PIN. Your seat code works too.</p>
          <h3>3. Vote or act</h3>
          <ol>
            <li>Open <strong>Today</strong> and read what the current phase asks of you and when it closes.</li>
            <li>Select one or more player cards, up to the limit shown.</li>
            <li>Select <strong>Save response</strong> and wait for the confirmation. Selecting cards alone does not count.</li>
            <li>You can change your mind and save again until the phase closes. Only your latest saved response counts.</li>
          </ol>
          <Shot src="/guide/player-day-ballot.png" alt="Player dashboard during a Day ballot with a player selected" caption="Casting a Day vote. The page refreshes by itself about every ten seconds." />
          <h3>4. Follow the story</h3>
          <p>The <strong>Official timeline</strong> shows each published result, who was eliminated, and their role. Select <strong>View votes</strong> to see how everyone voted on a Day, or select <strong>Timeline</strong> in the menu for the whole campaign on one page (the latest 100 updates), with each Day’s vote tally. Private results, such as a Seer’s investigation, appear under <strong>Private result history</strong>.</p>
          <Shot src="/guide/player-timeline.png" alt="Player dashboard showing the full Timeline of published results" caption="The full Timeline: each published result, who was eliminated and their role, and how everyone voted." />
          <h3>Good to know</h3>
          <ul>
            <li>Werewolves and Masons get a private room to chat with their team. Eliminated players can talk in the <strong>Afterlife</strong> room.</li>
            <li>Playing where others can see your screen? Use <strong>Hide role</strong> on your role card.</li>
            <li>Once eliminated, you can watch but not vote. Please don’t pass information back to living players.</li>
          </ul>
        </section>

        <section className="guide-section" id="moderators">
          <h2>For moderators</h2>
          <p>The moderator runs the game but does not play: the console shows every role. You need a moderator account from the site operator, 6–80 players with unique email addresses, and an agreed place for discussion.</p>
          <h3>Set up a game</h3>
          <ol>
            <li><strong>Create the game.</strong> In the <Link href="/moderator">Moderator console</Link>, enter a name, timezone, dates, a final cutoff, and the <strong>Hunter window</strong> (how long an eliminated Hunter has to shoot, 8 hours by default), then select <strong>Create game</strong>. <strong>Advanced: eliminations per phase</strong> sets how many living players each elimination slot covers, with a preview of the slots; most games keep the default of 30. Under <strong>Results</strong>, keep <strong>Publish automatically after a review window</strong> (60 minutes by default) or choose <strong>I review and publish each result</strong>. You can change all of these under <strong>Game schedule</strong> until roles are released; the Results choice can also change at any time in <strong>Run the live game</strong>.</li>
            <li><strong>Add players.</strong> Paste a roster with the header <code>display_name,email</code>, one email address per player, and select <strong>Create private seats</strong>. Then select <strong>Email invites</strong> to send each player their own private link (if the site operator has turned email on), or <strong>Download invite CSV</strong> and send each person only their own message. <strong>Waiting on</strong> lists who hasn’t claimed yet, with <strong>Resend</strong> for a lost email. A resent link replaces the old one. Before you randomize roles, use <strong>Change the roster</strong> to add a late joiner, or <strong>Remove</strong> beside someone who hasn’t claimed; everyone else keeps their seat, and each change adds or removes one Villager. Re-importing the CSV replaces every seat, so everyone would have to claim again.</li>
            <li><strong>Balance the roles.</strong> Accept the suggested counts or edit them and select <strong>Save composition</strong>. A 20-player game defaults to 12 Villagers, 3 Werewolves, a Seer, a Bodyguard, a Hunter, and 2 Masons.</li>
            <li><strong>Release roles.</strong> When every seat is claimed, select <strong>Randomize roles</strong>, review the result privately, then <strong>Release roles to players</strong>. Setup is locked after release.</li>
          </ol>
          <p>Want to see what a role looks like to players? <strong>View player preview</strong> opens the Player View Studio with sample data. <strong>Play elimination scene</strong> there replays the announcement players see when someone is eliminated.</p>
          <h3>Run each phase</h3>
          <p>Repeat this loop, starting with a Day and then alternating Night and Day:</p>
          <ol>
            <li><strong>Open.</strong> Choose the phase and a deadline, then select <strong>Open phase</strong>. Phases never open on their own; opening is the one step you always do.</li>
            <li><strong>Collect.</strong> <strong>Still to respond</strong> lists, for your eyes only, the living players who haven’t saved a response. Select <strong>Copy nudge message</strong> and paste it into your group chat. On a Day it names who hasn’t voted. At Night it names nobody, because the list would reveal who has a Night role.</li>
            <li><strong>Lock and calculate.</strong> With automatic results, this happens by itself at the deadline. In review mode, or to close early, select <strong>Lock responses &amp; calculate</strong>.</li>
            <li><strong>Hunter.</strong> If a Hunter is eliminated, they get the game’s Hunter window (8 hours by default) to shoot. With automatic results the game finishes this as soon as the Hunter shoots, or when the window closes. In review mode, select <strong>Finalize Hunter</strong>.</li>
            <li><strong>Review and publish.</strong> Check the tally and proposed outcome. With automatic results, the console says when it will publish; do nothing and it publishes then, marked “Published automatically after the review window”. Select <strong>Approve &amp; publish</strong> to publish sooner, <strong>Override calculated eliminations</strong> to correct it, or <strong>Pause automation</strong> to hold everything. In review mode, nothing publishes until you select <strong>Approve &amp; publish</strong>. Only publishing eliminates players, reveals roles, and checks for a winner.</li>
          </ol>
          <Shot src="/guide/moderator-live-game.png" alt="Moderator console reviewing a calculated result" caption="Reviewing a calculated Day result before publishing it." />
          <p>If a result must be corrected, <strong>Override calculated eliminations</strong> lets you publish a different list with a written reason. The original calculation stays on record.</p>
          <h3>Finish</h3>
          <p>The game completes as soon as a published result produces a winner. After the final cutoff, you can instead <strong>Enter final showdown</strong> and run Final ballots until someone wins. Afterwards, select <strong>Download JSON backup</strong> to keep a private record.</p>
          <h3>Moderator tools</h3>
          <ul>
            <li><strong>Announcements</strong> appear in every player’s updates. <strong>Announcement copy</strong> then shows each one ready to paste into an email or a group chat, with <strong>Copy email</strong> and <strong>Copy for chat</strong>.</li>
            <li><strong>Feedback</strong> lists the ratings and comments players and moderators send from the feedback card, with the average. It shows whether each came from a player or a moderator, never who.</li>
            <li><strong>Player access recovery</strong> sets a new PIN for a player who forgot theirs.</li>
            <li><strong>Private rooms</strong> can be made read-only, and individual messages removed with a reason.</li>
            <li><strong>Co-moderators</strong> can be added by the game owner.</li>
            <li><strong>Pause automation</strong> in <strong>Run the live game</strong> stops every automatic lock, calculation, and publication (for an offsite or a long weekend) until you select <strong>Resume automation</strong>. Players see “The schedule is paused”.</li>
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
