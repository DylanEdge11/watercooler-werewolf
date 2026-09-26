'use client';

import { useRef, useState, type FormEvent } from 'react';
import BrandMark from '../brand-mark';
import { withRetryAfter } from '../../lib/http/retry-after';

export default function PlayerLoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second Enter is refused even before React re-renders.
  const inFlight = useRef(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second Enter while the first check runs would spend another of the eight attempts.
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/seats/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: form.get('identifier'), pin: form.get('pin') }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(withRetryAfter(data.error ?? 'Unable to sign in.', response));
        inFlight.current = false;
        setBusy(false);
        return;
      }
      // A full page load, like the claim page's "Enter the game" link: the server
      // renders the dashboard for the new session, and nothing from the
      // signed-out page carries over.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full-page transition after sign-in, as after seat claim.
      window.location.assign('/');
    } catch {
      setError('The village is out of reach. Try again in a moment.');
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="setup-shell centered front-of-house">
      <section className="auth-card claim-card">
        <div className="claim-seal"><BrandMark /></div>
        <p className="eyebrow accent">Return to the village</p>
        <h1>Player sign-in</h1>
        <p>Use the email address from your invitation and the PIN you chose. Your seat code also works if you need it.</p>
        <form className="form-stack" onSubmit={signIn}>
          <label>Email or seat code<input name="identifier" autoComplete="username" required /></label>
          <label>Six-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Enter the game'}</button>
        </form>
        <div className="button-row">
          <a className="quiet-link" href="/guide">How to play →</a>
          <a className="quiet-link" href="/moderator">Moderator console →</a>
        </div>
      </section>
    </main>
  );
}
