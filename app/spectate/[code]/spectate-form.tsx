'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- use a reliable full-page transition after signing in. */

import { useState, type FormEvent } from 'react';
import type { SpectatorLink } from '../../../lib/auth/spectator-link';
import { withRetryAfter } from '../../../lib/http/retry-after';
import BrandMark from '../../brand-mark';

export default function SpectateForm({ code, spectator, lookupError }: { code: string; spectator: SpectatorLink | null; lookupError: string }) {
  const [error, setError] = useState(lookupError);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const firstVisit = spectator?.status === 'INVITED';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/spectate/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: form.get('pin') }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(withRetryAfter(data.error ?? 'Unable to open this link.', response));
        setBusy(false);
        return;
      }
      setSignedIn(true);
    } catch {
      setError('The village is out of reach. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <section className="auth-card claim-card">
      <div className="claim-seal"><BrandMark /></div>
      <p className="eyebrow accent">Spectator seat</p>
      <h1>{signedIn ? 'Your seat in the gallery is ready.' : spectator ? `Welcome, ${spectator.displayName}.` : 'This link can’t be opened.'}</h1>
      {signedIn ? (
        <><p>You are signed in as a spectator. You have no role and no vote. You can follow the game and chat in the Afterlife.</p><a className="primary-link" href="/">Watch the game</a></>
      ) : spectator ? (
        <>
          <p>You’re spectating <strong>{spectator.gameName}</strong>. {firstVisit ? 'Choose a six-digit PIN you’ll remember. To come back later, sign in on the home page with your email and this PIN, or use this link.' : 'Enter the PIN you chose for this link.'}</p>
          <form className="form-stack" onSubmit={submit}>
            <label>Six-digit PIN<input name="pin" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete={firstVisit ? 'new-password' : 'current-password'} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Opening…' : firstVisit ? 'Start spectating' : 'Sign in'}</button>
          </form>
          <p className="privacy-note">This link is yours alone. Keep what you read in the Afterlife to yourself until the game ends.</p>
        </>
      ) : <p className="form-error" role="alert">{error}</p>}
      <a className="quiet-link" href="/guide">New to Werewolf? Read how to play →</a>
    </section>
  );
}
