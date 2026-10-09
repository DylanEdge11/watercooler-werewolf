'use client';

import { useState, type FormEvent } from 'react';
import { requestJson } from '@/lib/http/client';
import BrandHeader from './brand-header';

/** What the console needs to know after a successful sign-in or password recovery. */
export interface SignedIn {
  /** New one-time recovery codes, shown once; empty after an ordinary sign-in. */
  recoveryCodes: string[];
  /** True when the moderator got in by choosing a new password with a recovery code. */
  recovered: boolean;
}

/** The signed-out console: sign in, or choose a new password with a one-time recovery code. */
export default function ModeratorSignIn({ needsBootstrap, onSignedIn }: { needsBootstrap: boolean; onSignedIn: (result: SignedIn) => Promise<void> }) {
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [error, setError] = useState('');

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await requestJson<{ recoveryCodes?: string[] }>(recoveryMode ? '/api/moderators/recover' : '/api/moderators/login', {
        body: recoveryMode
          ? { email: form.get('email'), recoveryCode: form.get('recoveryCode'), newPassword: form.get('newPassword') }
          : { email: form.get('email'), password: form.get('password') },
      });
      const recovered = recoveryMode;
      setRecoveryMode(false);
      await onSignedIn({ recoveryCodes: data.recoveryCodes ?? [], recovered });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    }
  }

  return (
    <main className="setup-shell backstage">
      <BrandHeader />
      <section className="auth-card">
        <p className="eyebrow accent">Private game control</p>
        <h1>{needsBootstrap ? 'Owner setup required' : recoveryMode ? 'Recover moderator access' : 'Moderator sign-in'}</h1>
        <p>{needsBootstrap ? 'Create the first moderator once from a trusted operator machine, then return here to sign in.' : recoveryMode ? 'Use one unused recovery code to choose a new password. Previous moderator sessions will be signed out.' : 'Sign in to resume setup or run an active game.'}</p>
        {needsBootstrap ? (
          <div className="form-stack">
            <p className="notice warning">Public account creation is disabled. On the server or a trusted operator machine, configure <code>WATERCOOLER_OWNER_EMAIL</code> and run <code>npm run owner:bootstrap</code>. The command prompts for the password without echoing it and displays recovery codes once.</p>
            <p className="field-help">After the command succeeds, reload this page to sign in with the app-owned moderator credentials.</p>
          </div>
        ) : <form className="form-stack" onSubmit={handleAuth}>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          {recoveryMode ? <><label>One-time recovery code<input name="recoveryCode" autoComplete="one-time-code" required /></label><label>New moderator password<input name="newPassword" type="password" minLength={12} autoComplete="new-password" required /></label></> : <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">{recoveryMode ? 'Recover access' : 'Sign in'}</button>
          <button className="text-button" type="button" onClick={() => { setRecoveryMode((current) => !current); setError(''); }}>{recoveryMode ? 'Back to sign in' : 'Forgot password? Use a recovery code'}</button>
        </form>}
      </section>
    </main>
  );
}
