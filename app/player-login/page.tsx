'use client';

import { useRef, useState, type FormEvent } from 'react';
import BrandMark from '../brand-mark';
import SignInChoices from '../sign-in-choices';
import { sendJson } from '@/lib/http/client';
import { withRetryAfter } from '@/lib/http/retry-after';
import type { SignInChoice } from '@/lib/auth/login-matches';

export default function PlayerLoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when the email and PIN fit seats in more than one game that has not ended: the person picks one.
  const [choices, setChoices] = useState<SignInChoice[]>([]);
  const credentials = useRef({ identifier: '', pin: '' });

  async function submit(choiceId?: string) {
    // A second Enter while the first check runs would spend another of the eight attempts.
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const { response, data } = await sendJson<{ choices?: SignInChoice[] }>('/api/seats/login', { body: { ...credentials.current, ...(choiceId ? { choiceId } : {}) } });
      if (response.status === 409 && Array.isArray(data.choices) && data.choices.length > 1) {
        setChoices(data.choices);
        setBusy(false);
        return;
      }
      if (!response.ok) {
        // After a choice that failed, the list stays so another game can still be picked.
        if (!choiceId) setChoices([]);
        setError(withRetryAfter(data.error ?? 'Unable to sign in.', response));
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
      setBusy(false);
    }
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    credentials.current = { identifier: String(form.get('identifier') ?? ''), pin: String(form.get('pin') ?? '') };
    setChoices([]);
    void submit();
  }

  return (
    <main className="setup-shell centered front-of-house">
      <section className="auth-card claim-card">
        <div className="claim-seal"><BrandMark /></div>
        <p className="eyebrow accent">Return to the village</p>
        <h1>Player sign-in</h1>
        <p>Use the email address from your invitation and the PIN you chose. Your seat code also works if you need it.</p>
        <form className="form-stack" onSubmit={signIn} onInput={() => setChoices([])}>
          <label>Email or seat code<input name="identifier" autoComplete="username" required /></label>
          <label>Six-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {choices.length > 1 && (
            <SignInChoices
              choices={choices}
              busy={busy}
              onChoose={(choice) => void submit(choice.id)}
              className="signin-choices"
              headingClassName="signin-choices-title"
              buttonClassName="secondary-button"
            />
          )}
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
