'use client';

import { useState, type FormEvent } from 'react';
import { scheduleProgress, type EliminationSchedule, type LatestRegularPhase } from '../../lib/game/elimination-schedule';
import { phaseName } from '../../lib/game/timeline-view';
import EliminationScheduleFields, { ScheduleList } from './elimination-schedule-fields';

interface EliminationSchedulePanelProps {
  gameId: string;
  status: string;
  schedule: EliminationSchedule | null;
  /** The newest Day or Night phase, whatever its status. */
  latest: LatestRegularPhase | null;
  onChanged: () => Promise<void> | void;
}

/**
 * The elimination schedule in the live console. Played game days and the
 * current one are marked; a saved change applies from the next phase to open.
 */
export default function EliminationSchedulePanel({ gameId, status, schedule, latest, onChanged }: EliminationSchedulePanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const next = scheduleProgress(schedule ?? [], latest).next;
  const nextName = `${next.kind === 'DAY' ? 'Day' : 'Night'} ${next.gameDay}`;
  const finalShowdown = status === 'FINAL_SHOWDOWN';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/games/${gameId}/elimination-schedule`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eliminationSchedule: form.get('eliminationSchedule') || null }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Unable to update the elimination schedule.');
      setMessage(`Saved. The change applies from ${nextName}.`);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the elimination schedule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="schedule-block">
      <div>
        <p className="eyebrow accent">Elimination schedule</p>
        <p className="schedule-status" role="status">{finalShowdown
          ? 'Final ballots use players per Day elimination, not this schedule.'
          : `${latest ? `Latest phase: ${phaseName(latest.kind, latest.sequence)}. ` : ''}A saved change applies from ${nextName}, the next phase to open. Phases already opened keep their slots.`}</p>
      </div>
      {schedule
        ? <ScheduleList schedule={schedule} latest={latest} />
        : <p className="field-help">No schedule: each Day and Night uses players per elimination.</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      <details className="schedule-settings">
        <summary>Change the elimination schedule</summary>
        <form className="schedule-form" onSubmit={save} key={JSON.stringify(schedule)}>
          <EliminationScheduleFields initial={schedule} latest={latest} />
          <button className="secondary-button" type="submit" disabled={busy}>Save schedule</button>
        </form>
      </details>
    </div>
  );
}
