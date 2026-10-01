'use client';

import { useState, type FormEvent } from 'react';
import CopyButton from './copy-button';

/**
 * Adds a late joiner to a running game during the first Day or Night. They are
 * always a Villager and join quietly; the private link is shown once.
 */
export default function LateVillagerForm({ gameId, onAdded }: { gameId: string; onAdded?: () => void }) {
  const [error, setError] = useState('');
  const [newLink, setNewLink] = useState<{ displayName: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    setNewLink(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/games/${gameId}/late-villagers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: data.get('displayName'), email: data.get('email') }),
      });
      const result = await response.json() as { seat?: { displayName: string }; claimUrl?: string; error?: string };
      if (!response.ok || !result.seat || !result.claimUrl) throw new Error(result.error ?? 'Unable to add the late Villager.');
      setNewLink({ displayName: result.seat.displayName, url: result.claimUrl });
      form.reset();
      onAdded?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add the late Villager.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="ops-block late-villager">
      <summary>Add a late Villager</summary>
      <form onSubmit={add}>
        <p className="field-help">For someone who missed the start. Available during the first Day and Night only. They always join as a Villager, and nothing is announced to other players, though the player count goes up once they sign in.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        <label>Display name<input name="displayName" maxLength={80} required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <button className="secondary-button" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add late Villager'}</button>
      </form>
      {newLink && <div className="notice success" role="status"><p><strong>{newLink.displayName}</strong> joins as a Villager with this private link. It is shown only now; send it to them yourself.</p><code className="recovery-list">{newLink.url}</code><div className="button-row"><CopyButton text={newLink.url} label="Copy link" accessibleLabel={`Copy seat link for ${newLink.displayName}`} /></div></div>}
    </details>
  );
}
