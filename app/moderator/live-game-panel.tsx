'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

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
  proposal: null | { id: string; outcome: Outcome; overrideReason: string | null };
}

interface RosterMember {
  id: string;
  displayName: string;
  alive: number | boolean;
  role: string;
}

function localDeadline(minutes = 60): string {
  const date = new Date(Date.now() + minutes * 60_000);
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function LiveGamePanel({ gameId, gameStatus }: { gameId: string; gameStatus: string }) {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [overrideIds, setOverrideIds] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/games/${gameId}/phases`);
    const data = await response.json() as { phases?: Phase[]; roster?: RosterMember[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to load the live game.');
    setPhases(data.phases ?? []);
    setRoster(data.roster ?? []);
  }, [gameId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load phases.'));
    }, 0);
    return () => window.clearTimeout(timer);
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
  }

  async function openPhase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutate({ action: 'OPEN', kind: form.get('kind'), closesAt: new Date(String(form.get('closesAt'))).toISOString() });
      setMessage('Phase opened. Eligible players can submit and revise responses.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open the phase.');
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
            : 'Hunter follow-up added to the review.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the phase.');
    }
  }

  const current = phases.find((phase) => !['PUBLISHED', 'SUPERSEDED'].includes(phase.status));
  const latest = current ?? phases[0];
  const byId = useMemo(() => new Map(roster.map((player) => [player.id, player])), [roster]);

  function toggleOverride(id: string, limit: number) {
    setOverrideIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < limit ? [...ids, id] : ids);
  }

  return (
    <section className="setup-card live-control">
      <div className="setup-card-heading"><span>05</span><div><h2>Run the live game</h2><p>Lock responses, inspect the calculated outcome, then publish one official result.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}

      {!current && gameStatus !== 'COMPLETED' && (
        <form className="phase-open-row" onSubmit={openPhase}>
          <label>Phase<select name="kind" defaultValue="DAY"><option value="DAY">Day ballot</option><option value="NIGHT">Night actions</option><option value="FINAL_BALLOT">Final ballot</option></select></label>
          <label>Deadline<input name="closesAt" type="datetime-local" defaultValue={localDeadline()} required /></label>
          <button className="primary-button" type="submit">Open phase</button>
        </form>
      )}

      {latest && (
        <div className="phase-review">
          <div className="phase-status-row"><div><p className="eyebrow accent">Cycle {latest.sequence} · {latest.kind.replaceAll('_', ' ')}</p><h3>{latest.status.replaceAll('_', ' ')}</h3></div><div><strong>{latest.currentSubmissions}</strong><small>current responses</small></div><div><strong>{latest.slots}</strong><small>elimination slots</small></div></div>
          {latest.status === 'OPEN' && <button className="danger-button" type="button" onClick={() => void run('LOCK_AND_PROPOSE', latest.id)}>Lock responses & calculate</button>}
          {latest.status === 'PENDING_HUNTER' && (
            <div className="hunter-callout"><span aria-hidden="true">➶</span><div><strong>Hunter follow-up required</strong><p>Deadline {latest.hunterDeadlineAt ? new Date(latest.hunterDeadlineAt).toLocaleString() : 'pending'}.</p></div><button className="primary-button" type="button" onClick={() => void run('FINALIZE_HUNTER', latest.id, { skipHunter: latest.hunterDeadlineAt ? new Date(latest.hunterDeadlineAt) <= new Date() : false })}>Finalize Hunter</button></div>
          )}

          {latest.proposal && (
            <>
              <div className="resolution-columns">
                <div><p className="eyebrow">Vote tally</p>{latest.proposal.outcome.tally.length ? latest.proposal.outcome.tally.map((entry) => <div className="tally-row" key={entry.playerId}><span>{byId.get(entry.playerId)?.displayName ?? 'Player'}</span><strong>{entry.votes}</strong></div>) : <p className="empty-note">No eligible votes were submitted.</p>}</div>
                <div><p className="eyebrow">Proposed outcome</p>{latest.proposal.outcome.eliminations.length ? latest.proposal.outcome.eliminations.map((item) => <div className="outcome-row" key={item.playerId}><span>{byId.get(item.playerId)?.displayName ?? 'Player'}</span><strong>{byId.get(item.playerId)?.role}</strong><small>{item.cause.replaceAll('_', ' ')}</small></div>) : <p className="empty-note">No elimination.</p>}{latest.proposal.outcome.protectedPlayerIds.length > 0 && <p className="protected-note">Protected: {latest.proposal.outcome.protectedPlayerIds.map((id) => byId.get(id)?.displayName).join(', ')}</p>}{latest.proposal.outcome.randomDraws.length > 0 && <p className="random-note">A recorded random draw resolved a boundary tie.</p>}</div>
              </div>
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
