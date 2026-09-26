'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import BrandMark from '../brand-mark';
import { withRetryAfter } from '../../lib/http/retry-after';

export default function PlayerLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second Enter while the first check runs would spend another of the eight attempts.
    if (busy) return;
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
        setBusy(false);
        return;
      }
      router.push('/');
    } catch {
      setError('The village is out of reach. Try again in a moment.');
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
