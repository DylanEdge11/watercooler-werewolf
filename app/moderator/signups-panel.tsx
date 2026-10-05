'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { conditionalGet, responseEtag } from '../../lib/http/conditional-get';
import { RELAXED_POLL_MS } from '../../lib/http/poll-interval';
import { pollWhileVisible } from '../../lib/http/poll-while-visible';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../lib/game/player-count';
import { MAX_SIGNUP_NOTE_LENGTH } from '../../lib/game/signups';
import type { RoleComposition } from '../../lib/game/types';
import CopyButton from './copy-button';

interface SignupRow {
  id: string;
  displayName: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  createdAt: string;
}

interface SignupsData {
  state: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  live: boolean;
  note: string;
  link: string | null;
  counts: { pending: number; accepted: number; declined: number };
  signups: SignupRow[];
}

/** What accepting sign-ups returns: the new seats' private links (shown once) and the roster's new role counts. */
export interface AcceptedSignups {
  added: number;
  message: string;
  composition: RoleComposition;
  resetToPreset: boolean;
  playerCount: number;
  invites: Array<{ displayName: string; email: string; claimUrl: string; inviteCode: string }>;
}

class PanelError extends Error {}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new PanelError(data.error ?? 'Request failed.');
  return data;
}

const STATE_LABEL = { NOT_OPEN: 'Not open', OPEN: 'Open', CLOSED: 'Closed' } as const;

/**
 * The Sign-ups card on the Setup tab: open sign-ups and share the public link, then accept the
 * people you want. Accepted people become ordinary unclaimed seats in the roster below, so
 * emailing invitations and the invite CSV work as they do for an imported roster.
 */
export default function SignupsPanel({ gameId, gameStatus, active, refreshKey, onAccepted, onRosterChanged }: {
  gameId: string;
  gameStatus: string;
  /** The Setup tab is showing, so the list is kept fresh. */
  active: boolean;
  /** Changes when the console's own refresh sees the sign-up counts move, so the list reloads at once. */
  refreshKey: string;
  onAccepted: (result: AcceptedSignups) => void;
  onRosterChanged: () => void;
}) {
  const [data, setData] = useState<SignupsData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const etag = useRef<string | null>(null);
  const request = useRef(0);
  const canManage = ['DRAFT', 'REGISTRATION'].includes(gameStatus);
  const canReview = ['DRAFT', 'REGISTRATION', 'ASSIGNMENT_PREVIEW'].includes(gameStatus);

  const load = useCallback(async () => {
    const id = ++request.current;
    const response = await conditionalGet(`/api/games/${gameId}/signups`, etag.current);
    if (!response) return;
    const body = await response.json() as SignupsData & { error?: string };
    if (!response.ok) throw new PanelError(body.error ?? 'Unable to load the sign-ups.');
    if (id !== request.current) return;
    etag.current = responseEtag(response);
    setData(body);
  }, [gameId]);

  useEffect(() => {
    if (!active) return;
    const reload = () => void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load the sign-ups.'));
    const timer = window.setTimeout(reload, 0);
    const stop = pollWhileVisible(reload, RELAXED_POLL_MS);
    return () => { window.clearTimeout(timer); stop(); };
  }, [active, load, refreshKey]);

  async function run<T>(action: () => Promise<T>, fallback: string): Promise<T | null> {
    if (busy) return null;
    setError('');
    setMessage('');
    setBusy(true);
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function manage(action: 'OPEN' | 'CLOSE' | 'ROTATE_LINK' | 'SET_NOTE', note?: string) {
    const next = await run(() => post<SignupsData>(`/api/games/${gameId}/signups`, { action, note }), 'Unable to update sign-ups.');
    if (!next) return;
    etag.current = null;
    // A refresh that started before this change must not overwrite it when it lands.
    request.current += 1;
    setData(next);
    // The console's next-step note and tab numbers follow the sign-up state, so tell it now rather than at its next refresh.
    onRosterChanged();
    if (action === 'SET_NOTE') { setNoteDraft(null); setMessage('Note saved.'); }
    if (action === 'OPEN') setMessage('Sign-ups are open. Share the link below.');
    if (action === 'CLOSE') setMessage('Sign-ups are closed. People with the link now see that. You can still accept the people who signed up.');
    if (action === 'ROTATE_LINK') setMessage('The link was replaced. The old one no longer works.');
  }

  async function decide(decision: 'ACCEPT' | 'DECLINE' | 'RESTORE', ids: string[]) {
    if (!ids.length) return;
    const result = await run(() => post<AcceptedSignups & { changed?: number }>(`/api/games/${gameId}/signups/review`, { decision, signupIds: ids }), 'Unable to update the sign-ups.');
    if (!result) return;
    etag.current = null;
    request.current += 1;
    if (decision === 'ACCEPT') {
      onAccepted(result);
      const counts = result.playerCount < MIN_PLAYERS
        ? `The roster has ${result.playerCount} so far, and a game needs at least ${MIN_PLAYERS}.`
        : result.resetToPreset
          ? `Role counts were set to the standard preset for ${result.playerCount} players.`
          : `Role counts now have ${result.composition.VILLAGER} ${result.composition.VILLAGER === 1 ? 'Villager' : 'Villagers'}; other roles are unchanged.`;
      setMessage(`${result.message} ${counts} Email their invitations below, or download the invite file now; the links are not shown again.`);
    } else {
      onRosterChanged();
    }
    await load().catch(() => {});
  }

  const waiting = data?.signups.filter((row) => row.status === 'PENDING') ?? [];
  const accepted = data?.signups.filter((row) => row.status === 'ACCEPTED') ?? [];
  const declined = data?.signups.filter((row) => row.status === 'DECLINED') ?? [];
  const state = data?.state ?? 'NOT_OPEN';
  const note = noteDraft ?? data?.note ?? '';

  return (
    <section className="setup-card" id="setup-signups">
      <div className="setup-card-heading"><span>02</span><div><h2>Sign-ups</h2><p>Let people sign up from a link, instead of or as well as importing a roster. If you do both, import your list first and accept sign-ups afterwards. You choose who joins. Everyone you accept gets an ordinary private seat, so you can email their invitations or download the invite file exactly as you would for an imported roster. A game needs {MIN_PLAYERS} to {MAX_PLAYERS} players.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      <div className="button-row signup-state">
        <span className="status-pill" aria-label={`Sign-ups: ${STATE_LABEL[state]}`}>{STATE_LABEL[state]}</span>
        {state === 'OPEN' && <button className="secondary-button" type="button" onClick={() => void manage('CLOSE')} disabled={busy}>Close sign-ups</button>}
        {state !== 'OPEN' && <button className="primary-button" type="button" onClick={() => void manage('OPEN')} disabled={busy || !canManage}>{state === 'CLOSED' ? 'Reopen sign-ups' : 'Open sign-ups'}</button>}
      </div>
      {state === 'OPEN' && !data?.live && <p className="field-help">Sign-ups pause while roles are randomized. They reopen by themselves when you save the composition again and unlock the roster.</p>}
      {!canManage && state !== 'OPEN' && <p className="field-help">Sign-ups can be opened before roles are randomized.</p>}

      {data?.link && <div className="ops-block signup-link">
        <p className="eyebrow accent">Sign-up link</p>
        <div className="button-row">
          <input readOnly value={data.link} aria-label="Public sign-up link" onFocus={(event) => event.currentTarget.select()} />
          <CopyButton text={data.link} label="Copy link" accessibleLabel="Copy the public sign-up link" />
          <button className="text-button" type="button" onClick={() => { if (window.confirm('Replace the sign-up link? The old link stops working, so anyone you already sent it to needs the new one.')) void manage('ROTATE_LINK'); }} disabled={busy}>Replace link</button>
        </div>
        <p className="field-help">Anyone with this link can ask to join, so share it only where you want sign-ups from. Nothing is emailed to someone who signs up until you accept them and send invitations.</p>
      </div>}

      {canReview && <form className="ops-block" onSubmit={(event) => { event.preventDefault(); void manage('SET_NOTE', note); }}>
        <label>Note on the sign-up page (optional)<textarea name="note" rows={2} maxLength={MAX_SIGNUP_NOTE_LENGTH} value={note} onChange={(event) => setNoteDraft(event.target.value)} /></label>
        <div className="button-row"><button className="secondary-button" type="submit" disabled={busy || noteDraft === null || noteDraft === (data?.note ?? '')}>Save note</button><span className="field-help">{note.length} of {MAX_SIGNUP_NOTE_LENGTH}</span></div>
      </form>}

      {data && (data.signups.length > 0 || state !== 'NOT_OPEN') && <>
        <p className="field-help" aria-live="polite">{data.counts.pending} waiting · {data.counts.accepted} accepted · {data.counts.declined} declined</p>
        {waiting.length > 0 && <div className="invite-email">
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => void decide('ACCEPT', waiting.map((row) => row.id))} disabled={busy || !canManage}>Accept all {waiting.length}</button>
          </div>
          {!canManage && canReview && <p className="field-help">Roles have been randomized, so people can’t be added. Save the composition again to discard the preview and unlock the roster.</p>}
          <ul className="invite-list" aria-label="Waiting sign-ups">
            {waiting.map((row) => <li key={row.id}>
              <span><strong>{row.displayName}</strong><small>{row.email} · signed up {new Date(row.createdAt).toLocaleString()}</small></span>
              <span className="button-row">
                <button className="text-button" type="button" onClick={() => void decide('ACCEPT', [row.id])} disabled={busy || !canManage} aria-label={`Accept ${row.displayName}`}>Accept</button>
                <button className="text-button" type="button" onClick={() => void decide('DECLINE', [row.id])} disabled={busy || !canReview} aria-label={`Decline ${row.displayName}`}>Decline</button>
              </span>
            </li>)}
          </ul>
        </div>}
        {waiting.length === 0 && state === 'OPEN' && data.live && <p className="empty-note">Nobody is waiting yet. Share the link above.</p>}
        {accepted.length > 0 && <details>
          <summary>{accepted.length} accepted</summary>
          <ul className="invite-list" aria-label="Accepted sign-ups">{accepted.map((row) => <li key={row.id}><span><strong>{row.displayName}</strong><small>{row.email}</small></span></li>)}</ul>
          <p className="field-help">Accepted players are in the roster below. To take one off, use Remove there; they move to Declined here.</p>
        </details>}
        {declined.length > 0 && <details>
          <summary>{declined.length} declined</summary>
          <ul className="invite-list" aria-label="Declined sign-ups">{declined.map((row) => <li key={row.id}>
            <span><strong>{row.displayName}</strong><small>{row.email}</small></span>
            <button className="text-button" type="button" onClick={() => void decide('RESTORE', [row.id])} disabled={busy || !canReview} aria-label={`Put ${row.displayName} back`}>Put back</button>
          </li>)}</ul>
        </details>}
      </>}
    </section>
  );
}
