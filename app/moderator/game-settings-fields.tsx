'use client';

import { useState } from 'react';
import { DEFAULT_GAME_SETTINGS, slotTable, type GameSettings } from '../../lib/game/game-settings';

interface GameSettingsFieldsProps {
  initial?: Partial<GameSettings>;
  disabled?: boolean;
}

function SlotPreview({ label, divisor }: { label: string; divisor: string }) {
  const value = Number(divisor);
  if (!Number.isInteger(value) || value < 1 || value > 80) {
    return <p className="slot-preview-note">Enter a whole number from 1 to 80 to preview the {label} slots.</p>;
  }
  return <table className="slot-preview" aria-label={`${label} elimination slots`}>
    <thead><tr><th scope="col">Living players</th><th scope="col">{label} slots</th></tr></thead>
    <tbody>{slotTable(value).map((row) => <tr key={row.from}><td>{row.from === row.to ? row.from : `${row.from}–${row.to}`}</td><td>{row.slots}</td></tr>)}</tbody>
  </table>;
}

/**
 * The Hunter window and the elimination divisors. Both setup forms use this;
 * the fields are editable only while the rest of the setup is.
 */
export default function GameSettingsFields({ initial, disabled = false }: GameSettingsFieldsProps) {
  const settings: GameSettings = {
    hunterWindowMinutes: initial?.hunterWindowMinutes ?? DEFAULT_GAME_SETTINGS.hunterWindowMinutes,
    dayDivisor: initial?.dayDivisor ?? DEFAULT_GAME_SETTINGS.dayDivisor,
    nightDivisor: initial?.nightDivisor ?? DEFAULT_GAME_SETTINGS.nightDivisor,
  };
  const [dayDivisor, setDayDivisor] = useState(String(settings.dayDivisor));
  const [nightDivisor, setNightDivisor] = useState(String(settings.nightDivisor));
  return <>
    <label>Hunter window (hours)<input name="hunterWindowHours" type="number" min="0.25" max="168" step="0.25" defaultValue={Math.round((settings.hunterWindowMinutes / 60) * 100) / 100} disabled={disabled} required /><small className="field-hint">How long an eliminated Hunter has to take their shot before you can finalize the result.</small></label>
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
    </details>
  </>;
}
