'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function ClaimForm({ code }: { code: string }) {
  const [seat, setSeat] = useState<{ displayName: string; gameName: string; status: string } | null>(null);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    void fetch(`/api/seats/claim/${encodeURIComponent(code)}`)
      .then(async (response) => {
        const data = await response.json() as { seat?: typeof seat; error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Seat not found.');
        setSeat(data.seat ?? null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Seat not found.'));
  }, [code]);

  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/seats/claim/${encodeURIComponent(code)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: form.get('pin') }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setError(data.error ?? 'Unable to claim this seat.');
    setClaimed(true);
  }

  return (
    <section className="auth-card claim-card">
      <div className="claim-moon" aria-hidden="true">☾</div>
      <p className="eyebrow accent">Private invitation</p>
      <h1>{claimed ? 'Your seat is ready.' : seat ? `Welcome, ${seat.displayName}.` : 'Checking your invitation…'}</h1>
      {claimed ? (
        <><p>You are signed in. Your role will appear after the moderator releases assignments.</p><Link className="primary-link" href="/">Enter the game</Link></>
      ) : seat ? (
        <>
          <p>You’ve been invited to <strong>{seat.gameName}</strong>. Choose a six-digit PIN you’ll remember.</p>
          <form className="form-stack" onSubmit={claim}>
            <label>Six-digit PIN<input name="pin" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit">Claim my seat</button>
          </form>
          <p className="privacy-note">This invitation identifies only your private seat. Never forward it.</p>
        </>
      ) : error ? <p className="form-error" role="alert">{error}</p> : <p>Please wait a moment.</p>}
    </section>
  );
}
