'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { withRetryAfter } from '../../lib/http/retry-after';
import type { SignInChoice } from '../../lib/auth/login-matches';
import SignInChoices from '../sign-in-choices';

interface SignInCardProps {
  /** Extra class for scene-specific framing (tag, sticky note, library card…). */
  className?: string;
  /** Short line above the form, in the scene's voice. */
  kicker?: string;
  night: boolean;
}

/**
 * The functional part of the landing page: the real player sign-in (same
 * endpoint as /player-login) plus the moderator and invite routes.
 */
export default function SignInCard({ className = '', kicker, night }: SignInCardProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Set when the email and PIN fit seats in more than one game that has not ended: the person picks one.
  const [choices, setChoices] = useState<SignInChoice[]>([]);
  const credentials = useRef({ identifier: '', pin: '' });
  const warmed = useRef({ dashboard: false, moderator: false });

  // Someone reaching for the form is about to sign in: fetch the dashboard's
  // code now so it is already cached when the page reloads as signed in.
  function warmDashboard() {
    if (warmed.current.dashboard) return;
    warmed.current.dashboard = true;
    void import('../player-dashboard');
  }

  function warmModerator() {
    if (warmed.current.moderator) return;
    warmed.current.moderator = true;
    router.prefetch('/moderator');
  }

  async function submit(choiceId?: string) {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/seats/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...credentials.current, ...(choiceId ? { choiceId } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; choices?: SignInChoice[] };
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
      // On / the dashboard is already mounted and needs a fresh load to pick up the session.
      if (window.location.pathname === '/') window.location.reload();
      else router.push('/');
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
    <section className={`ll-signin ${className}`} data-night={night} aria-labelledby="ll-signin-title">
      {kicker && <p className="ll-signin-kicker">{kicker}</p>}
      <h2 id="ll-signin-title" className="ll-signin-title">{night ? 'Slip back in' : 'Return to the village'}</h2>
      <form className="ll-signin-form" onSubmit={signIn} onInput={() => setChoices([])} onFocus={warmDashboard} onPointerEnter={warmDashboard}>
        <label>
          <span>Email or seat code</span>
          <input name="identifier" autoComplete="username" required />
        </label>
        <label>
          <span>Six-digit PIN</span>
          <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="current-password" required />
        </label>
        {error && <p className="ll-signin-error" role="alert">{error}</p>}
        {choices.length > 1 && (
          <SignInChoices
            choices={choices}
            busy={busy}
            onChoose={(choice) => void submit(choice.id)}
            className="ll-signin-choices"
            headingClassName="ll-signin-choices-title"
            buttonClassName="ll-stamp-button ll-signin-choice"
          />
        )}
        <button className="ll-stamp-button" type="submit" disabled={busy}>
          {busy ? 'Checking…' : night ? 'Enter the night' : 'Enter the game'}
        </button>
      </form>
      <p className="ll-signin-links">
        <a href="/guide">New here? Learn how to play →</a>
        <a href="/moderator" onFocus={warmModerator} onPointerEnter={warmModerator}>Moderator console →</a>
        <span>Invite link? Open it directly to claim your seat.</span>
      </p>
    </section>
  );
}
