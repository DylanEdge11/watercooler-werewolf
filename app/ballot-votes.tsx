import { useCallback, useRef, useState } from 'react';
import type { PublicTimelineEvent } from '../lib/game/timeline-view';

export type BallotVotes = NonNullable<PublicTimelineEvent['payload']['votes']>;

export type BallotVotesState =
  | { status: 'loaded'; votes: BallotVotes }
  | { status: 'loading' }
  | { status: 'error' };

/**
 * The dashboard sends who voted for whom for the newest ballot only. This
 * loads an older ballot's votes the first time a player opens it and keeps
 * them, since a published ballot never changes.
 */
export function useBallotVotes(previewMode: boolean) {
  const [loaded, setLoaded] = useState<Record<string, BallotVotesState>>({});
  const requested = useRef(new Set<string>());

  const votesFor = useCallback((event: PublicTimelineEvent): BallotVotesState => {
    if (event.payload.votes) return { status: 'loaded', votes: event.payload.votes };
    const phaseId = event.payload.phaseId;
    if (!phaseId || event.payload.voteCount === 0 || previewMode) return { status: 'loaded', votes: [] };
    return loaded[phaseId] ?? { status: 'loading' };
  }, [loaded, previewMode]);

  const requestVotes = useCallback(async (event: PublicTimelineEvent, retry = false) => {
    const phaseId = event.payload.phaseId;
    if (previewMode || event.payload.votes || !phaseId || event.payload.voteCount === 0) return;
    if (requested.current.has(phaseId) && !retry) return;
    requested.current.add(phaseId);
    setLoaded((current) => ({ ...current, [phaseId]: { status: 'loading' } }));
    try {
      const response = await fetch(`/api/phases/${encodeURIComponent(phaseId)}/votes`);
      if (!response.ok) throw new Error(`Votes request failed (${response.status}).`);
      const data = await response.json() as { votes: BallotVotes };
      setLoaded((current) => ({ ...current, [phaseId]: { status: 'loaded', votes: data.votes } }));
    } catch {
      requested.current.delete(phaseId);
      setLoaded((current) => ({ ...current, [phaseId]: { status: 'error' } }));
    }
  }, [previewMode]);

  return { votesFor, requestVotes };
}

/** Who voted for whom, or a loading or retry note while an older ballot loads. */
export function VoteLedger({ state, keyPrefix, emptyText, onRetry }: {
  state: BallotVotesState;
  keyPrefix: string;
  emptyText: string;
  onRetry: () => void;
}) {
  if (state.status === 'loading') return <p className="empty-note" role="status">Loading votes…</p>;
  if (state.status === 'error') {
    return <p className="form-error" role="alert">These votes didn’t load. <button className="text-button" type="button" onClick={onRetry}>Try again</button></p>;
  }
  if (!state.votes.length) return <p className="empty-note">{emptyText}</p>;
  return <div className="vote-ledger">{state.votes.map((vote, index) => <div className="vote-ledger-row" key={`${keyPrefix}-${vote.actorName}-${index}`}><strong>{vote.actorName}</strong><span aria-hidden="true">→</span><span>{vote.targetNames.length ? vote.targetNames.join(', ') : 'No target recorded'}</span></div>)}</div>;
}
