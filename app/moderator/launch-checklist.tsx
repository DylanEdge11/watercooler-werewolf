'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- the public entry links intentionally use full-page navigation. */

import type { LaunchChecklist } from '@/lib/game/console-guidance';
import { MAX_PLAYERS, MIN_PLAYERS } from '@/lib/game/player-count';

/** The four launch steps beside the console, each a button that jumps to its card. */
export default function LaunchChecklistAside({ checklist, reviewingSchedule, hasGame, rolesTarget, rolesEnabled, hasBatch, onOpenSchedule, onGoToStep }: {
  checklist: LaunchChecklist;
  /** The schedule card or the new-game form is open. */
  reviewingSchedule: boolean;
  hasGame: boolean;
  /** Where the "Role balance" step jumps: the counts while they can still change, otherwise the batch. */
  rolesTarget: string;
  rolesEnabled: boolean;
  hasBatch: boolean;
  onOpenSchedule: () => void;
  onGoToStep: (sectionId: string) => void;
}) {
  return (
    <aside className={`setup-progress${checklist.release === 'done' ? ' launched' : ''}`}>
      <p className="eyebrow">Launch checklist</p>
      {checklist.release === 'done' && <p className="launch-complete">All four launch steps are done.</p>}
      <ol>
        <li className={`${checklist.schedule} ${reviewingSchedule ? 'reviewing' : ''}`}><button className="checklist-step" type="button" onClick={onOpenSchedule} aria-controls="game-schedule"><span>1</span><div><strong>Game schedule</strong><small>Open timezone and cadence</small></div></button></li>
        <li className={checklist.roster}><button className="checklist-step" type="button" onClick={() => onGoToStep('setup-roster')} disabled={!hasGame}><span>2</span><div><strong>Player roster</strong><small>Minimum {MIN_PLAYERS} · up to {MAX_PLAYERS} private seats</small></div></button></li>
        <li className={checklist.roles}><button className="checklist-step" type="button" onClick={() => onGoToStep(rolesTarget)} disabled={!rolesEnabled}><span>3</span><div><strong>Role balance</strong><small>Compose and randomize</small></div></button></li>
        <li className={checklist.release}><button className="checklist-step" type="button" onClick={() => onGoToStep('setup-release')} disabled={!hasBatch}><span>4</span><div><strong>Release roles</strong><small>Irreversible launch</small></div></button></li>
      </ol>
      <nav className="console-links" aria-label="Moderator links">
        <a className="quiet-link" href="/guide#moderators" target="_blank" rel="noopener noreferrer">Moderator guide →<span className="sr-only"> (opens in a new tab)</span></a>
        <a className="quiet-link" href="/">View current player session →</a>
        <a className="quiet-link" href="/moderator/player-preview">Open Player View Studio →</a>
      </nav>
    </aside>
  );
}
