'use client';

import { useMemo, type FormEvent } from 'react';
import type { GameSummary } from '@/lib/game/setup-view';
import GameSettingsFields from './game-settings-fields';
import ScheduleFields, { newGameSchedule, savedSchedule } from './schedule-fields';

/** The first card of a new setup: the schedule, with suggested values, and the button that creates the game. */
export function NewGameCard({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const values = useMemo(() => newGameSchedule(), []);
  return (
    <section className="setup-card" id="game-schedule">
      <div className="setup-card-heading"><span>01</span><div><h2>Schedule the campaign</h2><p>Weekday phases keep the game lively without disrupting work.</p></div></div>
      <form className="setup-grid" onSubmit={onSubmit}>
        <ScheduleFields values={values} />
        <GameSettingsFields />
        <button className="primary-button" type="submit">Create game</button>
      </form>
    </section>
  );
}

/** An existing game's schedule: editable during setup, read-only once roles are released. */
export function GameScheduleCard({ game, editable, onSubmit, onClose }: { game: GameSummary; editable: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return (
    <section className="setup-card" id="game-schedule">
      <div className="setup-card-heading"><span>01</span><div><h2>Game schedule</h2><p>{editable ? 'Review or update the setup details, then continue where you left off.' : 'Review the launch schedule. It becomes read-only after roles are released.'}</p></div></div>
      <form className="setup-grid" key={`schedule-${game.id}-${game.finalCutoffAt}-${game.hunterWindowMinutes}-${game.dayDivisor}-${game.nightDivisor}-${JSON.stringify(game.eliminationSchedule ?? null)}-${game.publicationMode}-${game.reviewWindowMinutes}`} onSubmit={onSubmit}>
        <ScheduleFields values={savedSchedule(game)} disabled={!editable} />
        <GameSettingsFields initial={{ hunterWindowMinutes: game.hunterWindowMinutes, dayDivisor: game.dayDivisor, nightDivisor: game.nightDivisor, eliminationSchedule: game.eliminationSchedule ?? null, publicationMode: game.publicationMode, reviewWindowMinutes: game.reviewWindowMinutes }} disabled={!editable} />
        <div className="button-row wide">
          {editable && <button className="primary-button" type="submit">Save schedule</button>}
          <button className="secondary-button" type="button" onClick={onClose}>Close schedule</button>
        </div>
      </form>
      {!editable && <p className="notice warning schedule-lock-note">Schedule changes are locked for this {game.status.replaceAll('_', ' ').toLowerCase()} game.</p>}
    </section>
  );
}

/** Shown before the moderator has any game: what the console is for. */
export function WelcomeCard() {
  return (
    <section className="setup-card welcome-card" aria-labelledby="console-welcome-title">
      <div className="setup-card-heading"><span aria-hidden="true">★</span><div><h2 id="console-welcome-title">Welcome, moderator</h2><p>You run the game but don’t play it, so this console shows every role. A game has three parts.</p></div></div>
      <ol className="welcome-steps">
        <li><strong>Set up.</strong> Choose the dates and rules below, add your players (import a list, let them sign up from a link, or both), balance the roles, then release them. Use the launch checklist beside this page to see where you are.</li>
        <li><strong>Run.</strong> Each Day and Night: open a phase, nudge anyone who hasn’t responded, lock it, check the result, and publish it. Or let the app publish for you.</li>
        <li><strong>Look after people.</strong> Reset a forgotten PIN, announce news, add spectators, and keep an eye on the chat.</li>
      </ol>
      <p className="field-help">New to this? <a href="/guide#moderators" target="_blank" rel="noopener noreferrer">Read the moderator guide<span className="sr-only"> (opens in a new tab)</span></a>, or open <a href="/moderator/player-preview">Player View Studio</a> to see what your players will see.</p>
    </section>
  );
}
