'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function PlayerLoginPage() {
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/seats/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatCode: form.get('seatCode'), pin: form.get('pin') }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setError(data.error ?? 'Unable to sign in.');
    window.location.href = '/';
  }

  return (
    <main className="setup-shell centered">
      <section className="auth-card claim-card">
        <div className="claim-moon" aria-hidden="true">☾</div>
        <p className="eyebrow accent">Return to the village</p>
        <h1>Player sign-in</h1>
        <p>Use the private seat code from your invitation and the PIN you chose.</p>
        <form className="form-stack" onSubmit={signIn}>
          <label>Seat code<input name="seatCode" autoComplete="username" required /></label>
          <label>Six-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">Enter the game</button>
        </form>
        <Link className="quiet-link" href="/moderator">Moderator console →</Link>
      </section>
    </main>
  );
}
