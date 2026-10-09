import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import RoleMedallion from './role-medallion';
import type { RoleKey } from './player-dashboard';
import { eliminationCause, phaseName, readableRole, type PublicTimelineEvent } from '@/lib/game/timeline-view';

/**
 * The elimination "curtain call". Curtains close, a spotlight comes up, and
 * each eliminated player's name card drops in, is stamped, then flips to show
 * their role with a small mark of how they died. The player's own card tears
 * instead. Everything is CSS transform and opacity on a handful of elements,
 * and prefers-reduced-motion shows the finished scene. The resting styles are
 * the final frame, so skipping only has to stop the animations.
 */

// How long the full sequence runs, so a tap on the backdrop first skips to
// the end instead of dismissing a scene the player hasn't seen.
const SEQUENCE_MS = 2900;


function CauseMark({ cause }: { cause: string }): ReactNode {
  if (cause === 'WEREWOLF_ATTACK') {
    return <svg className="cause-mark claws" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M18 8L34 52M30 6L46 50M42 8L56 44" />
    </svg>;
  }
  if (cause === 'DAY_VOTE') {
    return <svg className="cause-mark gavel" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="gavel-block" d="M30 54H58V60H30Z" />
      <g className="gavel-swing">
        <path className="gavel-handle" d="M14 26L38 50" />
        <path className="gavel-head" d="M8 20L24 4L34 14L18 30Z" />
      </g>
    </svg>;
  }
  if (cause === 'HUNTER_SHOT') {
    return <svg className="cause-mark arrow" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g className="arrow-flight">
        <path className="arrow-shaft" d="M4 60L46 18" />
        <path className="arrow-head" d="M52 12L41 16L48 23Z" />
        <path className="arrow-fletch" d="M4 60L4 52M4 60L12 60M9 55L9 47M9 55L17 55" />
      </g>
    </svg>;
  }
  if (cause === 'LOVER_BOND') {
    return <svg className="cause-mark heart" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="heart-left" d="M32 18C30 14 27 11 22 11C16 11 10 16 10 24C10 32 16 40 32 52L29 44L34 36L29 28L34 22Z" />
      <path className="heart-right" d="M32 18C34 14 37 11 42 11C48 11 54 16 54 24C54 32 48 40 32 52L29 44L34 36L29 28L34 22Z" />
    </svg>;
  }
  return null;
}

interface DeathCurtainCallProps {
  event: PublicTimelineEvent;
  onDismiss: () => void;
}

export default function DeathCurtainCall({ event, onDismiss }: DeathCurtainCallProps) {
  const [settled, setSettled] = useState(false);
  // The dashboard keys this component by event, so each announcement starts unsettled.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), SEQUENCE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const eliminations = event.payload.eliminations ?? [];
  const self = eliminations.some((item) => item.isYou);
  const phase = event.payload.kind ? phaseName(event.payload.kind, event.payload.sequence) : 'The latest phase';
  const heading = self
    ? 'You have been eliminated'
    : eliminations.length > 1 ? `${eliminations.length} players have been eliminated` : 'A player has been eliminated';

  return (
    <div
      className={`modal-backdrop curtain-call${settled ? ' settled' : ''}`}
      role="presentation"
      onMouseDown={(mouse) => {
        if (mouse.target !== mouse.currentTarget) return;
        if (settled) onDismiss();
        else setSettled(true);
      }}
    >
      <div className="curtain-spotlight" aria-hidden="true" />
      <section className={`game-modal death-modal${self ? ' self-death' : ''}`} role="dialog" aria-modal="true" aria-labelledby="death-alert-title" aria-describedby="death-alert-summary">
        <p className="eyebrow accent">{self ? 'Your final scene' : 'Official game update'}</p>
        <h2 id="death-alert-title">{heading}</h2>
        <p className="modal-intro">{phase}</p>
        <ul className="death-cards" id="death-alert-summary">
          {eliminations.map((item, index) => {
            const cause = eliminationCause(item.cause);
            return <li className={`death-card cause-${item.cause.toLowerCase()}${item.isYou ? ' is-you' : ''}`} key={`${event.id}-${item.displayName}-${index}`} style={{ '--i': index } as CSSProperties}>
              <span className="sr-only">{item.isYou ? 'You' : item.displayName}, {readableRole(item.role)}{cause ? `, ${cause}` : ''}.</span>
              <div className="death-card-inner" aria-hidden="true">
                <div className="death-card-face death-card-back">
                  <span className="death-card-medallion"><RoleMedallion role={item.role as RoleKey} /></span>
                  <strong>{item.displayName}</strong>
                  <span>{readableRole(item.role)}</span>
                  {cause && <small>{cause}</small>}
                  <CauseMark cause={item.cause} />
                </div>
                {item.isYou ? <>
                  <div className="death-card-face death-card-front tear-left"><small>{phase}</small><strong>{item.displayName}</strong></div>
                  <div className="death-card-face death-card-front tear-right"><small>{phase}</small><strong>{item.displayName}</strong></div>
                </> : <div className="death-card-face death-card-front">
                  <small>{phase}</small>
                  <strong>{item.displayName}</strong>
                  <span className="death-stamp">Eliminated</span>
                </div>}
              </div>
            </li>;
          })}
        </ul>
        {self && <p className="death-self-note">You can keep watching as a spectator. Please don’t pass information to living players.</p>}
        <button className="primary-button" type="button" onClick={onDismiss} autoFocus>I understand</button>
      </section>
    </div>
  );
}
