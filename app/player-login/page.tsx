'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function PlayerLoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/seats/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: form.get('identifier'), pin: form.get('pin') }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setError(data.error ?? 'Unable to sign in.');
    router.push('/');
  }

  return (
    <main className="setup-shell centered">
      <section className="auth-card claim-card">
        <div className="claim-moon" aria-hidden="true">☾</div>
        <p className="eyebrow accent">Return to the village</p>
        <h1>Player sign-in</h1>
        <p>Use the email address from your invitation and the PIN you chose. Your seat code also works if you need it.</p>
        <form className="form-stack" onSubmit={signIn}>
          <label>Email or seat code<input name="identifier" autoComplete="username" required /></label>
          <label>Six-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">Enter the game</button>
        </form>
        <div className="button-row">
          <a className="quiet-link" href="/guide">How to play →</a>
          <a className="quiet-link" href="/moderator">Moderator console →</a>
        </div>
      </section>
    </main>
  );
}
