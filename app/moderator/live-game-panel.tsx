'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { shouldRefreshOperations } from '../../lib/game/operations-refresh';
import { formatZonedDateTimeLocal } from '../../lib/game/scheduling';
import { pollWhileVisible } from '../../lib/http/poll-while-visible';

interface Outcome {
  tally: Array<{ playerId: string; votes: number }>;
  selectedTargets: string[];
  protectedPlayerIds: string[];
  eliminations: Array<{ playerId: string; cause: string }>;
  investigations: Array<{ seerId: string; targetId: string; role: string }>;
  hunterRequiredIds: string[];
  randomDraws: Array<{ candidates: string[]; selected: string[]; rolls: number[] }>;
  warnings: Array<{ reason: string }>;
}

interface Phase {
  id: string;
  sequence: number;
  kind: 'DAY' | 'NIGHT' | 'FINAL_BALLOT';
  status: string;
  closesAt: string;
  hunterDeadlineAt: string | null;
  slots: number;
  currentSubmissions: number;
  proposal: null | { id: string; outcome: Outcome; proposedOutcome?: Outcome; reviewedOutcome?: Outcome | null; publishedOutcome?: Outcome | null; overrideReason: string | null; reviewedAt?: string | null };
}

interface RosterMember {
  id: string;
  displayName: string;
  alive: number | boolean;
  role: string;
}

function localDeadline(minutes = 60, timeZone = 'UTC'): string {
  const date = new Date(Date.now() + minutes * 60_000);
  return formatZonedDateTimeLocal(date, timeZone);
}

interface GameState {
  status: string;
  finalCutoffAt: string;
  timezone: string;
  updatedAt: string;
}

export default function LiveGamePanel({ gameId, gameStatus, onChanged }: { gameId: string; gameStatus: string; onChanged?: (action?: string) => void }) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [overrideIds, setOverrideIds] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deadlineDraft, setDeadlineDraft] = useState<{ gameId: string; timeZone: string; value: string } | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const response = await fetch('/api/games/' + gameId + '/phases');
    const data = await response.json() as { game?: GameState; phases?: Phase[]; roster?: RosterMember[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to load the live game.');
    if (sequence !== refreshSequence.current) return;
    setPhases(data.phases ?? []);
    setRoster(data.roster ?? []);
    setGame(data.game ?? null);
  }, [gameId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load phases.'));
    }, 0);
    const stopPolling = pollWhileVisible(() => {
      void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh phases.'));
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
      stopPolling();
    };
  }, [refresh]);

  async function mutate(payload: Record<string, unknown>) {
    setError('');
    const response = await fetch(`/api/games/${gameId}/phases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to update the phase.');
    await refresh();
    const action = typeof payload.action === 'string' ? payload.action : undefined;
    if (shouldRefreshOperations(action)) onChanged?.(action);
  }

  async function openPhase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      // The server interprets datetime-local in the game's configured timezone.
      await mutate({ action: 'OPEN', kind: form.get('kind'), closesAt: String(form.get('closesAt')) });
      setMessage('Phase opened. Eligible players can submit and revise responses.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open the phase.');
    }
  }

  async function enterFinalShowdown() {
    try {
      await mutate({ action: 'ENTER_FINAL_SHOWDOWN' });
      setMessage('Final showdown entered. The final ballot is now the only legal phase.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to enter final showdown.');
    }
  }

  async function run(action: string, phaseId: string, extra: Record<string, unknown> = {}) {
    try {
      await mutate({ action, phaseId, ...extra });
      setMessage(
        action === 'LOCK_AND_PROPOSE'
          ? 'Responses locked. The deterministic outcome is ready for review.'
          : action === 'PUBLISH'
            ? 'Outcome published to the official timeline.'
          : action === 'ENTER_FINAL_SHOWDOWN'
            ? 'Final showdown entered. The final ballot is now available.'
            : 'Hunter follow-up added to the review.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the phase.');
    }
  }

  const current = phases.find((phase) => !['PUBLISHED', 'SUPERSEDED'].includes(phase.status));
  const latest = current ?? phases[0];
  const effectiveStatus = game?.status ?? gameStatus;
  const latestPublished = phases.find((phase) => phase.status === 'PUBLISHED');
  const nextKind = effectiveStatus === 'FINAL_SHOWDOWN'
    ? 'FINAL_BALLOT'
    : latestPublished?.kind === 'DAY'
      ? 'NIGHT'
      : 'DAY';
  const byId = useMemo(() => new Map(roster.map((player) => [player.id, player])), [roster]);
  const gameTimeZone = game?.timezone ?? 'UTC';
  const defaultDeadline = useMemo(() => localDeadline(60, gameTimeZone), [gameTimeZone]);
  const deadlineInput = deadlineDraft?.gameId === gameId && deadlineDraft.timeZone === gameTimeZone
    ? deadlineDraft.value
    : defaultDeadline;
  const proposedOutcome = latest?.proposal?.proposedOutcome ?? latest?.proposal?.outcome ?? null;
  const reviewedOutcome = latest?.proposal?.reviewedOutcome ?? null;
  const publishedOutcome = latest?.proposal?.publishedOutcome ?? null;
  const authoritativeOutcome = latest?.status === 'PUBLISHED' && publishedOutcome ? publishedOutcome : reviewedOutcome ?? proposedOutcome;

  function gameTime(value: string | null | undefined): string {
    if (!value) return 'Not configured';
    return new Date(value).toLocaleString(undefined, { timeZone: game?.timezone ?? 'UTC' });
  }

  function toggleOverride(id: string, limit: number) {
    setOverrideIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < limit ? [...ids, id] : ids);
  }

  return (
    <section className="setup-card live-control">
      <div className="setup-card-heading"><span>05</span><div><h2>Run the live game</h2><p>Lock responses, inspect the calculated outcome, then publish one official result.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}

      {!current && !['COMPLETED', 'STOPPED'].includes(effectiveStatus) && (
        <form className="phase-open-row" onSubmit={openPhase}>
          <label>Phase<select name="kind" defaultValue={nextKind}><option value={nextKind}>{nextKind === 'DAY' ? 'Day ballot' : nextKind === 'NIGHT' ? 'Night actions' : 'Final ballot'}</option></select></label>
          <label>Deadline ({gameTimeZone})<input name="closesAt" type="datetime-local" value={deadlineInput} onChange={(event) => setDeadlineDraft({ gameId, timeZone: gameTimeZone, value: event.target.value })} required /></label>
          <button className="primary-button" type="submit">Open phase</button>
        </form>
      )}

      {!current && effectiveStatus === 'ACTIVE' && latestPublished && <div className="final-showdown-callout"><div><p className="eyebrow accent">Final cutoff · {game?.timezone ?? 'UTC'}</p><strong>{game?.finalCutoffAt ? gameTime(game.finalCutoffAt) : 'Configured in the game schedule'}</strong><p>When the cutoff has passed, enter final showdown to unlock the final ballot.</p></div><button className="secondary-button" type="button" onClick={() => void enterFinalShowdown()}>Enter final showdown</button></div>}

      {latest && (
        <div className="phase-review">
          <div className="phase-status-row"><div><p className="eyebrow accent">Cycle {latest.sequence} · {latest.kind.replaceAll('_', ' ')}</p><h3>{latest.status.replaceAll('_', ' ')}</h3></div><div><strong>{latest.currentSubmissions}</strong><small>current responses</small></div><div><strong>{latest.slots}</strong><small>elimination slots</small></div></div>
          {['OPEN', 'LOCKED'].includes(latest.status) && <button className="danger-button" type="button" onClick={() => void run('LOCK_AND_PROPOSE', latest.id)}>{latest.status === 'LOCKED' ? 'Calculate locked responses' : 'Lock responses & calculate'}</button>}
          {latest.status === 'PENDING_HUNTER' && (
            <div className="hunter-callout"><span aria-hidden="true">➶</span><div><strong>Hunter follow-up required</strong><p>Deadline {latest.hunterDeadlineAt ? gameTime(latest.hunterDeadlineAt) : 'pending'} ({game?.timezone ?? 'UTC'}).</p></div><button className="primary-button" type="button" onClick={() => void run('FINALIZE_HUNTER', latest.id, { skipHunter: latest.hunterDeadlineAt ? new Date(latest.hunterDeadlineAt) <= new Date() : false })}>Finalize Hunter</button></div>
          )}

          {latest.proposal && authoritativeOutcome && (
            <>
              <div className="resolution-columns">
                <div><p className="eyebrow">Vote tally</p>{proposedOutcome?.tally.length ? proposedOutcome.tally.map((entry) => <div className="tally-row" key={entry.playerId}><span>{byId.get(entry.playerId)?.displayName ?? 'Player'}</span><strong>{entry.votes}</strong></div>) : <p className="empty-note">No eligible votes were submitted.</p>}</div>
                <div><p className="eyebrow">{latest.status === 'PUBLISHED' ? 'Authoritative published outcome' : reviewedOutcome ? 'Reviewed outcome awaiting follow-up' : 'Proposed outcome'}</p>{authoritativeOutcome.eliminations.length ? authoritativeOutcome.eliminations.map((item) => <div className="outcome-row" key={item.playerId}><span>{byId.get(item.playerId)?.displayName ?? 'Player'}</span><strong>{byId.get(item.playerId)?.role}</strong><small>{item.cause.replaceAll('_', ' ')}</small></div>) : <p className="empty-note">No elimination.</p>}{authoritativeOutcome.protectedPlayerIds.length > 0 && <p className="protected-note">Protected: {authoritativeOutcome.protectedPlayerIds.map((id) => byId.get(id)?.displayName).join(', ')}</p>}{authoritativeOutcome.randomDraws.length > 0 && <p className="random-note">A recorded random draw resolved a boundary tie.</p>}</div>
              </div>
              {publishedOutcome && proposedOutcome && JSON.stringify(publishedOutcome) !== JSON.stringify(proposedOutcome) && <div className="notice warning"><strong>Override published.</strong> The original calculation remains preserved for audit. {latest.proposal.overrideReason ? 'Reason: ' + latest.proposal.overrideReason : ''}</div>}
              {latest.status === 'PUBLISHED' && latest.proposal.overrideReason && <p className="field-help">Review note: {latest.proposal.overrideReason}{latest.proposal.reviewedAt ? ` Review recorded ${gameTime(latest.proposal.reviewedAt)}.` : ''}</p>}
              {latest.status === 'PENDING_APPROVAL' && (
                <div className="review-actions">
                  <button className="primary-button" type="button" onClick={() => void run('PUBLISH', latest.id)}>Approve & publish</button>
                  <details>
                    <summary>Override calculated eliminations</summary>
                    <p className="field-help">Choose up to {latest.slots + 1} living players. The reason is permanently recorded.</p>
                    <div className="override-grid">{roster.filter((player) => Boolean(player.alive)).map((player) => <button className={overrideIds.includes(player.id) ? 'selected' : ''} type="button" key={player.id} onClick={() => toggleOverride(player.id, latest.slots + 1)}>{player.displayName}</button>)}</div>
                    <label>Audit reason<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={3} placeholder="Explain why the calculated outcome is being changed…" /></label>
                    <button className="danger-button" type="button" onClick={() => void run('PUBLISH', latest.id, { overrideEliminationIds: overrideIds, overrideReason })}>Publish override</button>
                  </details>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {phases.filter((phase) => phase.status === 'PUBLISHED').length > 0 && <p className="field-help">Published cycles: {phases.filter((phase) => phase.status === 'PUBLISHED').map((phase) => phase.sequence).join(', ')}</p>}
    </section>
  );
}
