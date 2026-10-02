'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import CopyButton from './copy-button';

interface Spectator {
  id: string;
  displayName: string;
  email: string;
  status: string;
  claimedAt: string | null;
}

/**
 * Spectators for a running game: add one to get their private link, or
 * remove one to end their access. Spectators have no role or vote; they see
 * the public game and can chat in the Afterlife.
 */
export default function SpectatorsPanel({ gameId, gameStatus }: { gameId: string; gameStatus: string }) {
  const [spectators, setSpectators] = useState<Spectator[]>([]);
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState<{ displayName: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canAdd = ['ACTIVE', 'FINAL_SHOWDOWN'].includes(gameStatus);

  const load = useCallback(async () => {
    const response = await fetch(`/api/games/${gameId}/spectators`);
    const data = await response.json() as { spectators?: Spectator[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Unable to load spectators.');
    setSpectators(data.spectators ?? []);
  }, [gameId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load spectators.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    setNewLink(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/games/${gameId}/spectators`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: data.get('displayName'), email: data.get('email') }),
      });
      const result = await response.json() as { spectator?: Spectator; spectateUrl?: string; error?: string };
      if (!response.ok || !result.spectator || !result.spectateUrl) throw new Error(result.error ?? 'Unable to add the spectator.');
      setNewLink({ displayName: result.spectator.displayName, url: result.spectateUrl });
      form.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add the spectator.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(spectator: Spectator) {
    if (busy || !window.confirm(`Remove ${spectator.displayName} as a spectator? Their link stops working.`)) return;
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/games/${gameId}/spectators/${spectator.id}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Unable to remove the spectator.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove the spectator.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setup-card spectators-card" id="spectators">
      <div className="setup-card-heading"><span>◉</span><div><h2>Spectators</h2><p>Let people watch after the game starts. Spectators have no role and no vote. They see who is alive, published results and ballots, and can chat in the Afterlife.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {spectators.length
        ? <ul className="moderator-list" aria-label="Spectators">{spectators.map((spectator) => <li key={spectator.id}><span className="moderator-email">{spectator.displayName} · {spectator.email}</span><small>{spectator.status === 'ACTIVE' ? 'Watching' : 'Link not opened yet'}</small><span className="moderator-actions"><button type="button" onClick={() => void remove(spectator)} disabled={busy}>Remove</button></span></li>)}</ul>
        : <p className="empty-note">No spectators yet.</p>}
      {canAdd ? <form className="ops-block" onSubmit={add}>
        <p className="eyebrow accent">Add a spectator</p>
        <label>Display name<input name="displayName" maxLength={80} required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <p className="field-help">A player in this game can’t also be a spectator. You’ll get a private link to send them; they choose a PIN the first time they open it. After that they can sign in on the home page with this email and their PIN. If they forget the PIN, remove them and add them again for a new link.</p>
        <button className="secondary-button" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add spectator'}</button>
      </form> : <p className="field-help">Spectators can be added while the game is running.</p>}
      {newLink && <div className="notice success" role="status"><p><strong>{newLink.displayName}</strong> can watch with this private link. It is shown only now.</p><code className="recovery-list">{newLink.url}</code><div className="button-row"><CopyButton text={newLink.url} label="Copy link" accessibleLabel={`Copy spectator link for ${newLink.displayName}`} /></div></div>}
    </section>
  );
}
