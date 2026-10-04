'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeChoiceCounts, groupPhaseChoices, type PhaseChoices, type PlayerChoice } from '../../lib/game/moderator-choices';
import { phaseName } from '../../lib/game/timeline-view';
import { conditionalGet, responseEtag } from '../../lib/http/conditional-get';
import { IDLE_AFTER_MS, pollWhileVisible } from '../../lib/http/poll-while-visible';
import { RELAXED_POLL_MS } from '../../lib/http/poll-interval';

function ChoiceRows({ choices }: { choices: PlayerChoice[] }) {
  return <>
    {choices.map((choice) => (
      <div className="outcome-row" key={`${choice.actorId}-${choice.kind}`}>
        <span>{choice.actorName}{choice.actorRole ? ` (${choice.actorRole})` : ''}</span>
        <strong>{choice.label}</strong>
        <small>{choice.targets.map((target) => `${target.displayName}${target.role ? ` (${target.role})` : ''}`).join(', ')}</small>
      </div>
    ))}
  </>;
}

/**
 * One phase: special powers in plain view, then the pack's targets and the votes as lists to open. The newest
 * phase starts open and older ones closed; after that the moderator's own opening and closing is left alone.
 */
function PhaseChoicesCard({ phase, newest }: { phase: PhaseChoices; newest: boolean }) {
  const [startsOpen] = useState(newest);
  const name = phaseName(phase.kind, phase.sequence);
  const grouped = groupPhaseChoices(phase.kind, phase.choices);
  const counts = describeChoiceCounts(grouped);
  return (
    <section aria-label={name}>
      <details className="choices-phase" open={startsOpen}>
        <summary>
          <span className="eyebrow accent">{name} · {phase.status.replaceAll('_', ' ').toLowerCase()}</span>
          <small>{counts || 'nothing saved yet'}</small>
        </summary>
        {phase.choices.length === 0 ? <p className="empty-note">No choices saved.</p> : <>
          {grouped.powers.length > 0
            ? <div className="choices-powers"><p className="eyebrow">Special powers</p><ChoiceRows choices={grouped.powers} /></div>
            : phase.kind === 'NIGHT' && <p className="empty-note">No special powers used yet.</p>}
          {grouped.groups.map((group) => (
            <details className="choices-group" key={group.key}>
              <summary>{group.title} <small>· {group.choices.length}</small></summary>
              <ChoiceRows choices={group.choices} />
            </details>
          ))}
        </>}
      </details>
    </section>
  );
}

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

  // A failed refresh shows its error above the last list instead of replacing it, so what the moderator opened stays open.
  return <>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!phases ? (error ? null : <p className="empty-note">Loading player choices…</p>)
      : !phases.length ? <p className="empty-note">No phase has opened yet.</p>
        : <div className="player-choices">
          {phases.map((phase, index) => <PhaseChoicesCard key={phase.phaseId} phase={phase} newest={index === 0} />)}
        </div>}
  </>;
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
          <p>Every vote and Night action, phase by phase, with each player’s role. Special powers come first: who the Seer investigated, whom the Bodyguard protected, Cupid’s lovers, and the Hunter’s shot. The pack’s targets and the votes are lists you open when you want them. Open phases show choices as they are saved. Only moderators can see this.</p>
        </div>
      </div>
      <details className="stats-panel-toggle" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{open ? 'Hide player choices' : 'Show player choices'}</summary>
        {open && <ChoicesList gameId={gameId} refreshToken={refreshToken} />}
      </details>
    </section>
  );
}
