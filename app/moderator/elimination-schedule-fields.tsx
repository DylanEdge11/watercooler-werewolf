'use client';

import { useState } from 'react';
import {
  describeScheduleRow,
  MAX_SCHEDULE_STAGES,
  resolveEliminationSchedule,
  scheduleProgress,
  scheduleRows,
  type EliminationSchedule,
  type LatestRegularPhase,
  type ScheduleRowState,
} from '@/lib/game/elimination-schedule';

interface DraftStage {
  day: string;
  night: string;
  days: string;
}

const STATE_LABEL: Record<ScheduleRowState, string> = { PLAYED: 'Played', CURRENT: 'Current', UPCOMING: 'Upcoming' };

/**
 * The stages of an elimination schedule, with a preview. Days already played
 * and the current game day are marked when `latest` is given (the live console).
 */
export function ScheduleList({ schedule, latest }: { schedule: EliminationSchedule; latest?: LatestRegularPhase | null }) {
  const rows = latest === undefined
    ? scheduleRows(schedule).map((row) => ({ ...row, state: null }))
    : scheduleProgress(schedule, latest).rows;
  return <ol className="schedule-preview" aria-label="Elimination schedule">
    {rows.map((row) => <li key={row.fromDay} className={row.state ? `schedule-${row.state.toLowerCase()}` : undefined}>
      <span>{describeScheduleRow(row)}</span>
      {row.state && <span className="schedule-state">{STATE_LABEL[row.state]}</span>}
    </li>)}
  </ol>;
}

function toDraft(schedule: EliminationSchedule | null): DraftStage[] {
  if (!schedule) return [{ day: '1', night: '1', days: '' }];
  return schedule.map((stage) => ({ day: String(stage.day), night: String(stage.night), days: stage.days === null ? '' : String(stage.days) }));
}

interface EliminationScheduleFieldsProps {
  initial: EliminationSchedule | null;
  disabled?: boolean;
  /** The newest Day or Night, in the live console; omitted during setup. */
  latest?: LatestRegularPhase | null;
}

/**
 * Edits the schedule and submits it as one hidden `eliminationSchedule` field:
 * the stages as JSON, or empty to use players per elimination instead.
 */
export default function EliminationScheduleFields({ initial, disabled = false, latest }: EliminationScheduleFieldsProps) {
  const [enabled, setEnabled] = useState(Boolean(initial));
  const [stages, setStages] = useState<DraftStage[]>(() => toDraft(initial));
  const { schedule, errors } = resolveEliminationSchedule(stages, null);

  function update(index: number, field: keyof DraftStage, value: string) {
    setStages((current) => current.map((stage, position) => position === index ? { ...stage, [field]: value } : stage));
  }

  function addStage() {
    setStages((current) => {
      const last = current[current.length - 1];
      // The old last stage now needs a length; the new one runs until the end.
      return [...current.slice(0, -1), { ...last, days: last.days || '5' }, { day: last.day, night: last.night, days: '' }];
    });
  }

  function removeStage(index: number) {
    setStages((current) => current.filter((_, position) => position !== index));
  }

  return <div className="elimination-schedule">
    <input type="hidden" name="eliminationSchedule" value={enabled ? JSON.stringify(stages) : ''} disabled={disabled} />
    <label className="schedule-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={disabled} />Use a fixed elimination schedule</label>
    <p className="field-hint">{enabled
      ? 'Set how many players each Day vote and each Night attack eliminates, stage by stage. A game day is one Day and the Night after it, counted Day 1, Day 2, and so on; skipped calendar days don’t count. The last stage runs until the game ends. Each phase eliminates at least 1 and always leaves at least one player alive. Final ballots still use players per Day elimination.'
      : 'Off: every Day and Night uses players per elimination.'}</p>
    {enabled && <>
      <div className="schedule-stages">
        {stages.map((stage, index) => {
          const last = index === stages.length - 1;
          return <fieldset className="schedule-stage" key={index} disabled={disabled}>
            <legend>Stage {index + 1}</legend>
            <label>Day eliminations<input type="number" min="1" max="79" step="1" inputMode="numeric" value={stage.day} onChange={(event) => update(index, 'day', event.target.value)} /></label>
            <label>Night kills<input type="number" min="1" max="79" step="1" inputMode="numeric" value={stage.night} onChange={(event) => update(index, 'night', event.target.value)} /></label>
            {last
              ? <p className="schedule-until-end">Until the game ends</p>
              : <label>For game days<input type="number" min="1" max="365" step="1" inputMode="numeric" value={stage.days} onChange={(event) => update(index, 'days', event.target.value)} /></label>}
            {stages.length > 1 && <button className="text-button" type="button" onClick={() => removeStage(index)}>Remove stage {index + 1}</button>}
          </fieldset>;
        })}
      </div>
      {stages.length < MAX_SCHEDULE_STAGES && <button className="secondary-button" type="button" onClick={addStage} disabled={disabled}>Add a stage</button>}
      {errors.length
        ? <ul className="slot-preview-warning schedule-errors" role="note">{errors.map((message) => <li key={message}>{message}</li>)}</ul>
        : schedule && <ScheduleList schedule={schedule} latest={latest} />}
    </>}
  </div>;
}
