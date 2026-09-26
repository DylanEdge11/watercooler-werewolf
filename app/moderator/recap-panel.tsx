'use client';

import { useEffect, useState } from 'react';
import { cycleSentences, roleName, type GameRecap } from '../../lib/game/recap';
import CopyButton from './copy-button';

/** The end-of-game recap for moderators, with plain text to paste into the group chat. */
export default function RecapPanel({ gameId }: { gameId: string }) {
  const [state, setState] = useState<{ recap: GameRecap; text: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/games/${gameId}/recap`)
      .then(async (response) => {
        const body = await response.json() as { recap?: GameRecap; text?: string; error?: string };
        if (!response.ok || !body.recap || !body.text) throw new Error(body.error ?? 'Unable to load the recap.');
        if (!cancelled) setState({ recap: body.recap, text: body.text });
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to load the recap.'); });
    return () => { cancelled = true; };
  }, [gameId]);

  return (
    <section className="setup-card recap-panel" aria-labelledby="recap-panel-title">
      <div className="setup-card-heading"><span>✦</span><div><h2 id="recap-panel-title">The final curtain</h2><p>Players now see every role and this recap under <strong>Final curtain</strong>. Copy it for your group chat; roles are included because the game is over.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!state && !error && <p className="setup-loading compact">Loading the recap…</p>}
      {state && <>
        <div className="button-row"><CopyButton text={state.text} label="Copy recap" className="primary-button" /></div>
        <p className="eyebrow accent">{state.recap.winner === 'VILLAGE' ? 'The Village wins' : state.recap.winner === 'WEREWOLF' ? 'The Werewolves win' : 'Game complete'}</p>
        {state.recap.moments.length > 0 && <ul className="recap-moments">{state.recap.moments.map((moment) => <li key={moment.id}><strong>{moment.title}</strong> {moment.detail}</li>)}</ul>}
        <details className="recap-details">
          <summary>Cast and story</summary>
          <ul className="recap-cast">{state.recap.cast.map((entry) => <li key={entry.name}><strong>{entry.name}</strong> <span>{roleName(entry.role)}</span> <small>{entry.fate}</small></li>)}</ul>
          <ol className="recap-story">{state.recap.cycles.map((cycle) => <li key={cycle.cycle}><strong>{cycle.label}:</strong> {cycleSentences(cycle).join(' ')}</li>)}</ol>
        </details>
      </>}
    </section>
  );
}
