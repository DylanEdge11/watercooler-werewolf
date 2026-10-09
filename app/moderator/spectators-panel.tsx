'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { requestJson } from '@/lib/http/client';
import CopyButton from './copy-button';

interface Spectator {
  id: string;
  displayName: string;
  email: string;
  status: string;
  claimedAt: string | null;
  /** Too many wrong PINs in a row: they can't sign in until the moderator resets their PIN. */
  locked: boolean;
}

/**
 * Spectators for a running game: add one to get their private link, reset the
 * PIN of one who forgot it or is locked out, or remove one to end their access.
 * Spectators have no role or vote; they see the public game and can chat in the Afterlife.
 */
export default function SpectatorsPanel({ gameId, gameStatus }: { gameId: string; gameStatus: string }) {
  const [spectators, setSpectators] = useState<Spectator[]>([]);
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState<{ displayName: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState<Spectator | null>(null);
  const [notice, setNotice] = useState('');
  const canAdd = ['ACTIVE', 'FINAL_SHOWDOWN'].includes(gameStatus);

  const load = useCallback(async () => {
    const data = await requestJson<{ spectators?: Spectator[] }>(`/api/games/${gameId}/spectators`, { fallback: 'Unable to load spectators.' });
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
      const result = await requestJson<{ spectator?: Spectator; spectateUrl?: string }>(`/api/games/${gameId}/spectators`, {
        body: { displayName: data.get('displayName'), email: data.get('email') },
        fallback: 'Unable to add the spectator.',
      });
      if (!result.spectator || !result.spectateUrl) throw new Error('Unable to add the spectator.');
      setNewLink({ displayName: result.spectator.displayName, url: result.spectateUrl });
      form.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add the spectator.');
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !resetting) return;
    const data = new FormData(event.currentTarget);
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await requestJson(`/api/games/${gameId}/spectators/${resetting.id}/reset-pin`, {
        body: { newPin: data.get('newPin'), reason: data.get('reason') },
        fallback: 'Unable to reset the PIN.',
      });
      setNotice(`${resetting.displayName}’s PIN was replaced. They are signed out everywhere and unlocked. Tell them the new PIN privately.`);
      setResetting(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset the PIN.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(spectator: Spectator) {
    if (busy || !window.confirm(`Remove ${spectator.displayName} as a spectator? Their link stops working.`)) return;
    setError('');
    setBusy(true);
    try {
      await requestJson(`/api/games/${gameId}/spectators/${spectator.id}`, { method: 'DELETE', fallback: 'Unable to remove the spectator.' });
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
        ? <ul className="moderator-list" aria-label="Spectators">{spectators.map((spectator) => <li key={spectator.id}><span className="moderator-email">{spectator.displayName} · {spectator.email}</span><small>{spectator.status !== 'ACTIVE' ? 'Link not opened yet' : spectator.locked ? 'Watching · locked: too many wrong PINs' : 'Watching'}</small><span className="moderator-actions">{spectator.status === 'ACTIVE' && <button type="button" onClick={() => { setNotice(''); setResetting(spectator); }} disabled={busy} aria-label={`Reset PIN for ${spectator.displayName}`}>Reset PIN</button>}<button type="button" onClick={() => void remove(spectator)} disabled={busy}>Remove</button></span></li>)}</ul>
        : <p className="empty-note">No spectators yet.</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      {resetting && <form className="ops-block" onSubmit={resetPin} key={resetting.id}>
        <p className="eyebrow accent">Reset PIN for {resetting.displayName}</p>
        <p className="field-help">Use when they forget their PIN or are locked out after 10 wrong PINs in a row. Everywhere they are signed in is signed out, and they are unlocked. Tell them the new PIN privately.</p>
        <label>New six-digit PIN<input name="newPin" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="off" required /></label>
        <label>Reason<textarea name="reason" rows={2} minLength={5} required /></label>
        <div className="button-row"><button className="secondary-button" type="submit" disabled={busy}>{busy ? 'Resetting…' : 'Reset PIN'}</button><button className="text-button" type="button" onClick={() => setResetting(null)} disabled={busy}>Cancel</button></div>
      </form>}
      {canAdd ? <form className="ops-block" onSubmit={add}>
        <p className="eyebrow accent">Add a spectator</p>
        <label>Display name<input name="displayName" maxLength={80} required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <p className="field-help">A player in this game can’t also be a spectator. You’ll get a private link to send them; they choose a PIN the first time they open it. After that they can sign in on the home page with this email and their PIN. If they forget it or are locked out, use Reset PIN beside their name. If they lose their link before opening it, remove them and add them again.</p>
        <button className="secondary-button" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add spectator'}</button>
      </form> : <p className="field-help">Spectators can be added while the game is running.</p>}
      {newLink && <div className="notice success" role="status"><p><strong>{newLink.displayName}</strong> can watch with this private link. It is shown only now.</p><code className="recovery-list">{newLink.url}</code><div className="button-row"><CopyButton text={newLink.url} label="Copy link" accessibleLabel={`Copy spectator link for ${newLink.displayName}`} /></div></div>}
    </section>
  );
}
