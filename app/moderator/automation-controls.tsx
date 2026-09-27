'use client';

import { useState, type FormEvent } from 'react';

export interface AutomationGameState {
  status: string;
  publicationMode: 'REVIEW' | 'AUTOMATIC';
  reviewWindowMinutes: number;
  automationPausedAt: string | null;
}

export interface NextAutomaticStep {
  kind: 'LOCK_AND_PROPOSE' | 'FINALIZE_HUNTER' | 'PUBLISH';
  at: string;
}

interface AutomationControlsProps {
  gameId: string;
  game: AutomationGameState;
  nextStep: NextAutomaticStep | null;
  formatTime: (iso: string) => string;
  onChanged: () => Promise<void> | void;
}

function statusLine(game: AutomationGameState, nextStep: NextAutomaticStep | null, formatTime: (iso: string) => string): string {
  if (game.automationPausedAt) return 'Paused. Deadlines still close voting, but nothing calculates or publishes on its own until you resume.';
  if (game.publicationMode === 'REVIEW') return 'Review mode: voting closes at each deadline, and you calculate and publish each result yourself.';
  if (nextStep?.kind === 'LOCK_AND_PROPOSE') return `Locks and calculates at ${formatTime(nextStep.at)}.`;
  if (nextStep?.kind === 'FINALIZE_HUNTER') return `Waiting for the Hunter: finishes as soon as they shoot, or at ${formatTime(nextStep.at)}.`;
  if (nextStep?.kind === 'PUBLISH') return `Publishes automatically at ${formatTime(nextStep.at)} unless you publish, override, or pause first.`;
  return `Automatic: each phase you open locks at its deadline and publishes ${game.reviewWindowMinutes} minutes later unless you act.`;
}

/** Pause, resume, and the publication choice for a running game. Every change is audited. */
export default function AutomationControls({ gameId, game, nextStep, formatTime, onChanged }: AutomationControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const paused = Boolean(game.automationPausedAt);
  const live = ['ACTIVE', 'FINAL_SHOWDOWN'].includes(game.status);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/games/${gameId}/automation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to update automation.');
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update automation.');
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({ action: 'SETTINGS', publicationMode: form.get('publicationMode'), reviewWindowMinutes: form.get('reviewWindowMinutes') });
  }

  return (
    <div className={`automation-block${paused ? ' paused' : ''}`}>
      <div className="ops-heading">
        <div><p className="eyebrow accent">Automatic results</p><p className="automation-status" role="status">{statusLine(game, nextStep, formatTime)}</p></div>
        {live && <button className="secondary-button" type="button" disabled={busy} onClick={() => void send({ action: paused ? 'RESUME' : 'PAUSE' })}>{paused ? 'Resume automation' : 'Pause automation'}</button>}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <details className="automation-settings">
        <summary>Change how results publish</summary>
        <form className="automation-form" onSubmit={save} key={`${game.publicationMode}-${game.reviewWindowMinutes}`}>
          <label><input type="radio" name="publicationMode" value="REVIEW" defaultChecked={game.publicationMode === 'REVIEW'} />I review and publish each result</label>
          <label><input type="radio" name="publicationMode" value="AUTOMATIC" defaultChecked={game.publicationMode === 'AUTOMATIC'} />Publish automatically after a review window</label>
          <label>Review window (minutes)<input name="reviewWindowMinutes" type="number" min="0" max="1440" step="1" defaultValue={game.reviewWindowMinutes} required /></label>
          <button className="secondary-button" type="submit" disabled={busy}>Save</button>
        </form>
      </details>
    </div>
  );
}
