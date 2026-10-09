'use client';

import { useState, type FormEvent } from 'react';
import { JOIN_COPY } from '@/lib/game/join-copy';
import { sendJson } from '@/lib/http/client';
import { withRetryAfter } from '@/lib/http/retry-after';
import type { PublicJoinPage } from '@/lib/join/lookup';
import BrandMark from '../../brand-mark';

type Kind = 'signup' | 'apply';

/** A field real visitors never see or fill in. A bot that fills every field is quietly ignored. */
function Honeypot() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
      <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    </div>
  );
}

export default function JoinForms({ code, page, lookupError }: { code: string; page: PublicJoinPage | null; lookupError: string }) {
  const [done, setDone] = useState<Record<Kind, boolean>>({ signup: false, apply: false });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [errors, setErrors] = useState<Record<Kind, string>>({ signup: '', apply: '' });

  async function submit(kind: Kind, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second tap while the first is in flight would spend more of the hourly allowance.
    if (busy) return;
    setErrors((current) => ({ ...current, [kind]: '' }));
    setBusy(kind);
    const form = new FormData(event.currentTarget);
    try {
      const { response, data } = await sendJson(`/api/join/${encodeURIComponent(code)}/${kind === 'signup' ? 'signup' : 'apply'}`, {
        body: { displayName: form.get('displayName'), email: form.get('email'), note: form.get('note') ?? undefined, website: form.get('website') },
      });
      if (!response.ok) {
        setErrors((current) => ({ ...current, [kind]: withRetryAfter(data.error ?? JOIN_COPY.botFailure, response) }));
      } else {
        setDone((current) => ({ ...current, [kind]: true }));
      }
    } catch {
      setErrors((current) => ({ ...current, [kind]: 'The village is out of reach. Try again in a moment.' }));
    } finally {
      setBusy(null);
    }
  }

  if (!page) {
    return (
      <section className="auth-card claim-card">
        <div className="claim-seal"><BrandMark /></div>
        <p className="eyebrow accent">Game sign-up</p>
        <h1>This link can’t be opened.</h1>
        <p className="form-error" role="alert">{lookupError || JOIN_COPY.invalidLink}</p>
        <a className="quiet-link" href="/guide">New to Werewolf? Read how to play →</a>
      </section>
    );
  }

  const playing = page.signups === 'OPEN';
  const nothingOpen = !playing && !page.applications;
  return (
    <section className="auth-card claim-card">
      <div className="claim-seal"><BrandMark /></div>
      <p className="eyebrow accent">Game sign-up</p>
      <h1>{playing ? JOIN_COPY.playerHeading(page.gameName) : page.gameName}</h1>

      {nothingOpen && <p role="status">{page.signups === 'NOT_OPEN' ? JOIN_COPY.noneOpen(page.gameName) : JOIN_COPY.closed(page.gameName)}</p>}
      {!playing && page.signups === 'CLOSED' && page.applications && <p role="status">{JOIN_COPY.closed(page.gameName)}</p>}

      {playing && (
        <>
          <p>{JOIN_COPY.playerSubline(page.startDateLabel)}</p>
          {page.note && <p style={{ whiteSpace: 'pre-line' }}>{page.note}</p>}
          {done.signup ? <p role="status">{JOIN_COPY.playerDone}</p> : (
            <form className="form-stack" aria-label="Sign up to play" onSubmit={(event) => void submit('signup', event)}>
              <label>{JOIN_COPY.nameLabel}<input name="displayName" maxLength={80} autoComplete="name" required /></label>
              <label>{JOIN_COPY.emailLabel}<input name="email" type="email" maxLength={254} autoComplete="email" required /></label>
              <Honeypot />
              {errors.signup && <p className="form-error" role="alert">{errors.signup}</p>}
              <button className="primary-button" type="submit" disabled={busy !== null}>{busy === 'signup' ? JOIN_COPY.playerSubmitting : JOIN_COPY.playerSubmit}</button>
            </form>
          )}
        </>
      )}

      {page.applications && (
        <>
          <h2 style={{ fontSize: 22, margin: '26px 0 6px' }}>{JOIN_COPY.moderatorHeading}</h2>
          <p>{JOIN_COPY.moderatorIntro}</p>
          {done.apply ? <p role="status">{JOIN_COPY.moderatorDone}</p> : (
            <form className="form-stack" aria-label="Apply to moderate" onSubmit={(event) => void submit('apply', event)}>
              <label>{JOIN_COPY.moderatorNameLabel}<input name="displayName" maxLength={80} autoComplete="name" required /></label>
              <label>{JOIN_COPY.moderatorEmailLabel}<input name="email" type="email" maxLength={254} autoComplete="email" required /></label>
              <label>{JOIN_COPY.moderatorNoteLabel}<textarea name="note" rows={3} maxLength={500} /></label>
              <Honeypot />
              {errors.apply && <p className="form-error" role="alert">{errors.apply}</p>}
              <button className="primary-button" type="submit" disabled={busy !== null}>{busy === 'apply' ? JOIN_COPY.moderatorSubmitting : JOIN_COPY.moderatorSubmit}</button>
            </form>
          )}
        </>
      )}

      <a className="quiet-link" href="/guide">New to Werewolf? Read how to play →</a>
    </section>
  );
}
