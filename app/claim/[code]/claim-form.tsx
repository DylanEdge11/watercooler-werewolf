'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- use a reliable full-page transition after seat claim. */

import { useState, type FormEvent } from 'react';
import type { ClaimSeat } from '../../../lib/auth/claim';
import { withRetryAfter } from '../../../lib/http/retry-after';
import BrandMark from '../../brand-mark';

export default function ClaimForm({ code, seat, lookupError }: { code: string; seat: ClaimSeat | null; lookupError: string }) {
  const [error, setError] = useState(lookupError);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);

  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second tap while the first claim is in flight would spend another of the three hourly attempts.
    if (busy) return;
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/seats/claim/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: form.get('pin') }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(withRetryAfter(data.error ?? 'Unable to claim this seat.', response));
        setBusy(false);
        return;
      }
      setClaimed(true);
    } catch {
      setError('The village is out of reach. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <section className="auth-card claim-card">
      <div className="claim-seal"><BrandMark /></div>
      <p className="eyebrow accent">Private invitation</p>
      <h1>{claimed ? 'Your seat is ready.' : seat ? `Welcome, ${seat.displayName}.` : 'This invitation can’t be opened.'}</h1>
      {claimed ? (
        <><p>You are signed in. Your role will appear after the moderator releases assignments.</p><a className="primary-link" href="/">Enter the game</a></>
      ) : seat ? (
        <>
          <p>You’ve been invited to <strong>{seat.gameName}</strong>. Choose a six-digit PIN you’ll remember.</p>
          <form className="form-stack" onSubmit={claim}>
            <label>Six-digit PIN<input name="pin" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Claiming…' : 'Claim my seat'}</button>
          </form>
          <p className="privacy-note">This invitation identifies only your private seat. Never forward it.</p>
        </>
      ) : <p className="form-error" role="alert">{error}</p>}
      <a className="quiet-link" href="/guide">New to Werewolf? Read how to play →</a>
    </section>
  );
}
