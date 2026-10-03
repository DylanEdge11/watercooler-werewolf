'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhaseChoices } from '../../lib/game/moderator-choices';
import { phaseName } from '../../lib/game/timeline-view';
import { conditionalGet, responseEtag } from '../../lib/http/conditional-get';
import { IDLE_AFTER_MS, pollWhileVisible } from '../../lib/http/poll-while-visible';
import { RELAXED_POLL_MS } from '../../lib/http/poll-interval';

function ChoicesList({ gameId, refreshToken }: { gameId: string; refreshToken: number }) {
  const [phases, setPhases] = useState<PhaseChoices[] | null>(null);
  const [error, setError] = useState('');
  const etag = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await conditionalGet(`/api/games/${gameId}/choices`, etag.current);
      if (!response) return;
      const data = await response.json() as { phases?: PhaseChoices[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to load player choices.');
      etag.current = responseEtag(response);
      setPhases(data.phases ?? []);
      setError('');
    } catch (caught) {
      // Forget the tag: the next refresh must fetch in full, because an unchanged-data answer (304) would leave this error on screen.
      etag.current = null;
      setError(caught instanceof Error ? caught.message : 'Unable to load player choices.');
    }
  }, [gameId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const stopPolling = pollWhileVisible(() => void load(), RELAXED_POLL_MS, { idleAfterMs: IDLE_AFTER_MS });
    return () => {
      window.clearTimeout(timer);
      stopPolling();
    };
  }, [load, refreshToken]);

  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!phases) return <p className="empty-note">Loading player choices…</p>;
  if (!phases.length) return <p className="empty-note">No phase has opened yet.</p>;
  return <div className="player-choices">
    {phases.map((phase) => (
      <section key={phase.phaseId} aria-label={phaseName(phase.kind, phase.sequence)}>
        <p className="eyebrow accent">{phaseName(phase.kind, phase.sequence)} · {phase.status.replaceAll('_', ' ').toLowerCase()}</p>
        {phase.choices.length
          ? phase.choices.map((choice) => (
            <div className="outcome-row" key={`${choice.actorId}-${choice.kind}`}>
              <span>{choice.actorName}{choice.actorRole ? ` (${choice.actorRole})` : ''}</span>
              <strong>{choice.label}</strong>
              <small>{choice.targets.map((target) => `${target.displayName}${target.role ? ` (${target.role})` : ''}`).join(', ')}</small>
            </div>
          ))
          : <p className="empty-note">No choices saved.</p>}
      </section>
    ))}
  </div>;
}

/**
 * Every player's saved choice in every phase: ballots, the pack's targets, and
 * each Night role's action, with everyone's role. For a moderator who is not
 * playing. Choices load only while the panel is open, and refresh while it stays open.
 */
export default function PlayerChoicesPanel({ gameId, refreshToken }: { gameId: string; refreshToken: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="setup-card" id="player-choices" aria-labelledby="console-player-choices-title">
      <div className="setup-card-heading">
        <span aria-hidden="true">◎</span>
        <div>
          <h2 id="console-player-choices-title">Player choices</h2>
          <p>Every vote and Night action, phase by phase, with each player’s role: who the Seer investigated, whom the Bodyguard protected, Cupid’s lovers, and the pack’s targets. Open phases show choices as they are saved. Only moderators can see this.</p>
        </div>
      </div>
      <details className="stats-panel-toggle" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{open ? 'Hide player choices' : 'Show player choices'}</summary>
        {open && <ChoicesList gameId={gameId} refreshToken={refreshToken} />}
      </details>
    </section>
  );
}
