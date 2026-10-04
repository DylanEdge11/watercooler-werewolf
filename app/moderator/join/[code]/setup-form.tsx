'use client';

import { useState, type FormEvent } from 'react';
import { MODERATOR_SETUP_COPY } from '../../../../lib/game/join-copy';
import { withRetryAfter } from '../../../../lib/http/retry-after';

export default function SetupForm({ code, link, lookupError }: { code: string; link: { displayName: string; gameName: string } | null; lookupError: string }) {
  const [error, setError] = useState(lookupError);
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirm')) {
      setError('The two passwords don’t match.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/moderators/join/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: form.get('password') }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; recoveryCodes?: string[] };
      if (!response.ok) {
        setError(withRetryAfter(data.error ?? 'Unable to set up your sign-in.', response));
        setBusy(false);
        return;
      }
      setRecoveryCodes(data.recoveryCodes ?? []);
    } catch {
      setError('The server is out of reach. Try again in a moment.');
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <section className="auth-card">
        <p className="eyebrow accent">Moderator sign-in</p>
        <h1>{MODERATOR_SETUP_COPY.doneHeading}</h1>
        <div className="notice warning"><strong>{MODERATOR_SETUP_COPY.recoveryCodes}</strong><code>{recoveryCodes.join(' · ')}</code></div>
        <a className="primary-link" href="/moderator">{MODERATOR_SETUP_COPY.openConsole}</a>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <p className="eyebrow accent">Moderator sign-in</p>
      <h1>{MODERATOR_SETUP_COPY.heading}</h1>
      {link ? (
        <>
          <p>Hi {link.displayName}. {MODERATOR_SETUP_COPY.intro(link.gameName)}</p>
          <form className="form-stack" onSubmit={submit}>
            <label>Password<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
            <label>Type it again<input name="confirm" type="password" minLength={12} autoComplete="new-password" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? MODERATOR_SETUP_COPY.submitting : MODERATOR_SETUP_COPY.submit}</button>
          </form>
        </>
      ) : <p className="form-error" role="alert">{error || MODERATOR_SETUP_COPY.invalidLink}</p>}
    </section>
  );
}
