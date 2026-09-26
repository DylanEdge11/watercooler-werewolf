import RoleMedallion from './role-medallion';
import { cycleSentences, roleName, type GameRecap } from '../lib/game/recap';

interface FinalCurtainProps {
  recap: GameRecap | null;
  error?: string;
  onBack: () => void;
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The end-of-game reveal: every role, the moments, and the story cycle by cycle. Completed games only. */
export default function FinalCurtain({ recap, error, onBack }: FinalCurtainProps) {
  const headline = recap?.winner === 'VILLAGE' ? 'The Village wins' : recap?.winner === 'WEREWOLF' ? 'The Werewolves win' : 'The final curtain';
  return (
    <section className="main-column final-curtain" id="final-curtain" aria-labelledby="final-curtain-title">
      <div className="welcome-row">
        <div><p className="eyebrow accent">The final curtain</p><h1 id="final-curtain-title">{headline}</h1><p>Every role is revealed. Here is how the story played out.</p></div>
        <button className="secondary-button" type="button" onClick={onBack}>Back to today</button>
      </div>
      {!recap ? <section className="ballot-card waiting-card"><span className="waiting-icon" aria-hidden="true">✦</span><div><h2>{error ? 'The recap could not load' : 'Raising the curtain…'}</h2><p>{error ?? 'Gathering the whole story.'}</p></div></section> : <>
        <section className="curtain-block" aria-labelledby="curtain-cast-title">
          <h2 id="curtain-cast-title">The cast</h2>
          <ul className="curtain-cast">
            {recap.cast.map((entry) => <li className={`${entry.team === 'Werewolves' ? 'wolf' : 'village'}${entry.survived ? ' survived' : ''}`} key={entry.name}>
              <span className="curtain-medallion"><RoleMedallion role={entry.role} /></span>
              <span className="curtain-cast-copy"><strong>{entry.name}</strong><span className="curtain-role">{roleName(entry.role)}</span><small>{entry.fate}</small></span>
            </li>)}
          </ul>
        </section>
        {recap.moments.length > 0 && <section className="curtain-block" aria-labelledby="curtain-moments-title">
          <h2 id="curtain-moments-title">Moments</h2>
          <ul className="curtain-moments">
            {recap.moments.map((moment) => <li key={moment.id}><p className="eyebrow">{moment.title}</p><p>{moment.detail}</p></li>)}
          </ul>
        </section>}
        <section className="curtain-block" aria-labelledby="curtain-story-title">
          <h2 id="curtain-story-title">The story</h2>
          {recap.cycles.length ? <ol className="curtain-cycles">
            {recap.cycles.map((cycle) => <li key={cycle.cycle} className={cycle.kind === 'NIGHT' ? 'night' : 'day'}>
              <p className="eyebrow">{cycle.label}</p>
              <ul>{cycleSentences(cycle).map((sentence, index) => <li key={index}>{capitalise(sentence)}</li>)}</ul>
            </li>)}
          </ol> : <p className="empty-note">No results were published.</p>}
        </section>
      </>}
    </section>
  );
}
