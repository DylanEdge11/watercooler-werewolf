'use client';

import { useState } from 'react';
import { DEFAULT_NEW_GAME_AUTOMATION, type AutomationSettings } from '../../lib/game/automation';
import type { EliminationSchedule } from '../../lib/game/elimination-schedule';
import { DEFAULT_GAME_SETTINGS, heavySlotWarning, slotTable, type GameSettings } from '../../lib/game/game-settings';
import EliminationScheduleFields from './elimination-schedule-fields';

interface GameSettingsFieldsProps {
  initial?: Partial<GameSettings & AutomationSettings & { eliminationSchedule: EliminationSchedule | null }>;
  disabled?: boolean;
}

function SlotPreview({ label, divisor }: { label: string; divisor: string }) {
  const value = Number(divisor);
  if (!Number.isInteger(value) || value < 1 || value > 80) {
    return <p className="slot-preview-note">Enter a whole number from 1 to 80 to preview the {label} slots.</p>;
  }
  const rows = slotTable(value);
  const heavy = heavySlotWarning(rows);
  return <>
    <table className="slot-preview" aria-label={`${label} elimination slots`}>
      <thead><tr><th scope="col">Living players</th><th scope="col">{label} slots</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.from}><td>{row.from === row.to ? row.from : `${row.from}–${row.to}`}</td><td>{row.slots}</td></tr>)}</tbody>
    </table>
    {heavy && <p className="slot-preview-warning" role="note">{`With ${heavy.from} or more living players, one ${label} can eliminate ${heavy.slots} or more players. Most games keep it to 1–3; the default is 30.`}</p>}
  </>;
}

/**
 * The Hunter window, the elimination divisors, and the elimination schedule.
 * Both setup forms use this; the fields are editable only while the rest of
 * the setup is. After release, the schedule changes in the live console.
 */
export default function GameSettingsFields({ initial, disabled = false }: GameSettingsFieldsProps) {
  const settings: GameSettings = {
    hunterWindowMinutes: initial?.hunterWindowMinutes ?? DEFAULT_GAME_SETTINGS.hunterWindowMinutes,
    dayDivisor: initial?.dayDivisor ?? DEFAULT_GAME_SETTINGS.dayDivisor,
    nightDivisor: initial?.nightDivisor ?? DEFAULT_GAME_SETTINGS.nightDivisor,
  };
  const [publicationMode, setPublicationMode] = useState(initial?.publicationMode ?? DEFAULT_NEW_GAME_AUTOMATION.publicationMode);
  const reviewWindowMinutes = initial?.reviewWindowMinutes ?? DEFAULT_NEW_GAME_AUTOMATION.reviewWindowMinutes;
  const [dayDivisor, setDayDivisor] = useState(String(settings.dayDivisor));
  const [nightDivisor, setNightDivisor] = useState(String(settings.nightDivisor));
  return <>
    <label>Hunter window (hours)<input name="hunterWindowHours" type="number" min="0.25" max="168" step="0.25" defaultValue={Math.round((settings.hunterWindowMinutes / 60) * 100) / 100} disabled={disabled} required /><small className="field-hint">How long an eliminated Hunter has to take their shot before you can finalize the result.</small></label>
    <fieldset className="results-choice wide" disabled={disabled}>
      <legend>Results</legend>
      <label><input type="radio" name="publicationMode" value="REVIEW" checked={publicationMode === 'REVIEW'} onChange={() => setPublicationMode('REVIEW')} />I review and publish each result</label>
      <label><input type="radio" name="publicationMode" value="AUTOMATIC" checked={publicationMode === 'AUTOMATIC'} onChange={() => setPublicationMode('AUTOMATIC')} />Publish automatically after a review window</label>
      <label className="review-window-field">Review window (minutes)<input name="reviewWindowMinutes" type="number" min="0" max="1440" step="1" defaultValue={reviewWindowMinutes} required /><small className="field-hint">{publicationMode === 'AUTOMATIC' ? 'At each deadline the game locks and calculates. The result publishes after this many minutes unless you publish, override, or pause first.' : 'Voting closes at each deadline, but nothing calculates or publishes on its own. You can switch to automatic at any time in Run the live game.'}</small></label>
    </fieldset>
    <details className="advanced-settings wide">
      <summary>Advanced: eliminations per phase</summary>
      <p className="field-hint">Each phase can eliminate one player for every so many living players, counted when it opens. The default of 30 means one elimination up to 30 players, two up to 60, and so on.</p>
      <div className="advanced-settings-grid">
        <div>
          <label>Players per Day elimination<input name="dayDivisor" type="number" min="1" max="80" step="1" value={dayDivisor} onChange={(event) => setDayDivisor(event.target.value)} disabled={disabled} required /></label>
          <SlotPreview label="Day" divisor={dayDivisor} />
        </div>
        <div>
          <label>Players per Night elimination<input name="nightDivisor" type="number" min="1" max="80" step="1" value={nightDivisor} onChange={(event) => setNightDivisor(event.target.value)} disabled={disabled} required /></label>
          <SlotPreview label="Night" divisor={nightDivisor} />
        </div>
      </div>
      <h3 className="schedule-heading">Elimination schedule</h3>
      <EliminationScheduleFields initial={initial?.eliminationSchedule ?? null} disabled={disabled} />
    </details>
  </>;
}
