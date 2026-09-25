import { describeTimelineEvent, eliminationCause, readableRole, tallyVotes, type PublicTimelineEvent } from '../lib/game/timeline-view';

interface FullTimelineProps {
  events: PublicTimelineEvent[];
  onBack: () => void;
}

/** The whole published record of the campaign, newest first. Public data only. */
export default function FullTimeline({ events: unordered, onBack }: FullTimelineProps) {
  const events = [...unordered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newestBallotId = events.find((event) => describeTimelineEvent(event).publicBallot)?.id;
  return (
    <section className="main-column timeline-view" id="full-timeline" aria-labelledby="full-timeline-title">
      <div className="welcome-row">
        <div><p className="eyebrow accent">Official record</p><h1 id="full-timeline-title">Timeline</h1><p>Everything the moderator has published in this campaign, newest first.</p></div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to today</button>
      </div>
      {events.length ? <ol className="timeline-full">
        {events.map((event) => {
          const view = describeTimelineEvent(event);
          const eliminations = event.payload.eliminations ?? [];
          const votes = event.payload.votes ?? [];
          const tally = tallyVotes(votes);
          return <li className={`timeline-full-entry ${view.tone}`} key={event.id}>
            <div className="timeline-full-heading">
              <p className="eyebrow">{view.eyebrow}</p>
              <small suppressHydrationWarning>{new Date(event.createdAt).toLocaleString()}</small>
            </div>
            <h2>{view.headline}</h2>
            {view.tone === 'phase' ? <>
              {eliminations.length > 0 && <ul className="timeline-eliminations">
                {eliminations.map((item, index) => <li key={`${event.id}-${item.displayName}-${index}`}><strong>{item.displayName}</strong><span>{readableRole(item.role)}{eliminationCause(item.cause) ? ` · ${eliminationCause(item.cause)}` : ''}</span></li>)}
              </ul>}
              {event.payload.protectedAttackBlocked && <p>Bodyguard protection stopped a pack attack.</p>}
              {view.publicBallot && (votes.length ? <details className="timeline-votes" open={event.id === newestBallotId}>
                <summary>{votes.length} {votes.length === 1 ? 'vote' : 'votes'}{tally.length ? ` · ${tally.map((item) => `${item.name} ${item.count}`).join(', ')}` : ''}</summary>
                <div className="vote-ledger">{votes.map((vote, index) => <div className="vote-ledger-row" key={`${event.id}-${vote.actorName}-${index}`}><strong>{vote.actorName}</strong><span aria-hidden="true">→</span><span>{vote.targetNames.length ? vote.targetNames.join(', ') : 'No target recorded'}</span></div>)}</div>
              </details> : <p className="empty-note">No public votes were recorded.</p>)}
            </> : view.description && <p>{view.description}</p>}
          </li>;
        })}
      </ol> : <section className="ballot-card waiting-card"><span className="waiting-icon" aria-hidden="true">≋</span><div><h2>Nothing published yet</h2><p>Results appear here after the moderator publishes each Day and Night.</p></div></section>}
    </section>
  );
}
