'use client';

import { ROLE_CATALOG } from '@/lib/game/catalog';
import type { AssignmentBatchView, RosterSeatView } from '@/lib/game/setup-view';
import { ROLE_KEYS } from '@/lib/game/types';
import type { Composition } from './console-types';

/** How far the counts lean toward the Village (positive) or the Werewolves (negative). */
function balanceScore(composition: Composition): number {
  return composition.VILLAGER - composition.WEREWOLF * 5 + composition.SEER * 3 + composition.BODYGUARD * 2 + composition.HUNTER + composition.MASON + composition.APPRENTICE_SEER * 2 + composition.MAYOR * 2 + composition.CUPID;
}

/** Step 3 of the launch checklist: how many of each role, then randomize them. */
export function RoleBalanceCard({ composition, rosterCount, allClaimed, hasUnsavedCounts, onChange, onSave, onRandomize }: {
  composition: Composition;
  rosterCount: number;
  /** Every seat has been claimed, which unlocks randomizing. */
  allClaimed: boolean;
  hasUnsavedCounts: boolean;
  onChange: (next: Composition) => void;
  onSave: () => void;
  onRandomize: () => void;
}) {
  const score = balanceScore(composition);
  return (
    <section className="setup-card" id="setup-roles">
      <div className="setup-card-heading"><span>03</span><div><h2>Balance the roles</h2><p>Counts must equal the roster. Unique roles cap at one; Masons travel in groups. Small-game presets are editable before release.</p></div></div>
      <div className="role-composer">
        {ROLE_KEYS.map((role) => (
          <label key={role}>{ROLE_CATALOG[role].name}
            <input type="number" min="0" max={ROLE_CATALOG[role].unique ? 1 : rosterCount} value={composition[role]} onChange={(event) => onChange({ ...composition, [role]: Number(event.target.value) })} />
          </label>
        ))}
      </div>
      <div className="balance-bar"><div><strong>Signed balance score</strong><small>Village positive · Werewolf negative</small></div><b className={Math.abs(score) <= Math.max(2, rosterCount * .15) ? 'balanced' : ''}>{score > 0 ? '+' : ''}{score}</b></div>
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={onSave}>Save composition</button>
        <button className="primary-button" type="button" onClick={onRandomize} disabled={!allClaimed || hasUnsavedCounts}>Randomize roles</button>
      </div>
      {!allClaimed && <p className="field-help">Randomization unlocks when every seat is claimed.</p>}
      {hasUnsavedCounts && <p className="field-help">Save the role composition before randomizing; the preview is invalidated when counts change.</p>}
    </section>
  );
}

/** Step 4: the randomized assignments, privately, and the button that releases them to the players. */
export function AssignmentReviewCard({ batch, roster, setupEditable, onRelease }: {
  batch: AssignmentBatchView;
  roster: RosterSeatView[];
  setupEditable: boolean;
  onRelease: (batchId: string) => void;
}) {
  const names = new Map(roster.map((seat) => [seat.id, seat.displayName]));
  return (
    <section className="setup-card assignment-review" id="setup-release">
      <div className="setup-card-heading"><span>04</span><div><h2>Review assignment batch {batch.revision}</h2><p>Random evidence <code>{batch.randomEvidenceHash.slice(0, 16)}…</code></p></div></div>
      <div className="assignment-grid">
        {batch.assignments.map((assignment) => <div key={assignment.seatId}><span>{names.get(assignment.seatId) ?? 'Player'}</span><strong>{ROLE_CATALOG[assignment.role].name}</strong></div>)}
      </div>
      {batch.releasedAt ? <p className="notice success">Released {new Date(batch.releasedAt).toLocaleString()}</p> : setupEditable ? <button className="danger-button" type="button" onClick={() => onRelease(batch.id)}>Release roles to players</button> : <p className="notice warning">This preview cannot be released because setup is locked.</p>}
    </section>
  );
}
