import { describeTimelineEvent, eliminationCause, readableRole, type PublicTimelineEvent } from '@/lib/game/timeline-view';
import { VoteLedger, type BallotVotesState } from './ballot-votes';

interface FullTimelineProps {
  events: PublicTimelineEvent[];
  /** The server returned only the latest updates; older ones exist. */
  hasMore?: boolean;
  onBack: () => void;
  /** Votes for a ballot: sent with the newest one, loaded on request for older ones. */
  votesFor: (event: PublicTimelineEvent) => BallotVotesState;
  onOpenVotes: (event: PublicTimelineEvent, retry?: boolean) => void;
}

/** The whole published record of the campaign, newest first. Public data only. */
export default function FullTimeline({ events: unordered, hasMore = false, onBack, votesFor, onOpenVotes }: FullTimelineProps) {
  const events = [...unordered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newestBallotId = events.find((event) => describeTimelineEvent(event).publicBallot)?.id;
  return (
    <section className="main-column timeline-view" id="full-timeline" aria-labelledby="full-timeline-title">
      <div className="welcome-row">
        <div><p className="eyebrow accent">Official record</p><h1 id="full-timeline-title">Timeline</h1><p>Everything the moderator has published in this campaign, newest first.</p>{hasMore && <p className="timeline-cap-note">Showing the latest {events.length} updates; older ones aren’t shown.</p>}</div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to today</button>
      </div>
      {events.length ? <ol className="timeline-full">
        {events.map((event) => {
          const view = describeTimelineEvent(event);
          const eliminations = event.payload.eliminations ?? [];
          const voteCount = event.payload.voteCount ?? event.payload.votes?.length ?? 0;
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
              {event.payload.afterlifeBrokeTie && <p>The village vote tied, and the Afterlife broke the tie.</p>}
              {event.payload.publishedAutomatically && <p className="timeline-auto-note">Published automatically after the review window.</p>}
              {view.publicBallot && (voteCount ? <details className="timeline-votes" open={event.id === newestBallotId} onToggle={(toggle) => { if (toggle.currentTarget.open) onOpenVotes(event); }}>
                <summary>{voteCount} {voteCount === 1 ? 'vote' : 'votes'}</summary>
                <VoteLedger state={votesFor(event)} keyPrefix={event.id} emptyText="No public votes were recorded." onRetry={() => onOpenVotes(event, true)} />
              </details> : <p className="empty-note">No public votes were recorded.</p>)}
            </> : view.description && <p>{view.description}</p>}
          </li>;
        })}
      </ol> : <section className="ballot-card waiting-card"><span className="waiting-icon" aria-hidden="true">≋</span><div><h2>Nothing published yet</h2><p>Results appear here after the moderator publishes each Day and Night.</p></div></section>}
    </section>
  );
}
