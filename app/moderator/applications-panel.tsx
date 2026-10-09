'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseJsonResponse, requestJson } from '@/lib/http/client';
import { conditionalGet, responseEtag } from '@/lib/http/conditional-get';
import { RELAXED_POLL_MS } from '@/lib/http/poll-interval';
import { IDLE_AFTER_MS, pollWhileVisible } from '@/lib/http/poll-while-visible';
import { useGameEnded } from './use-game-ended';
import CopyButton from './copy-button';
import { useOperations } from './operations-context';

interface ApplicationRow {
  id: string;
  displayName: string;
  email: string;
  note: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  createdAt: string;
  /** They have their account and are a co-moderator of this game. */
  joined: boolean;
  /** Approved, but the setup link ran out before they used it. */
  linkExpired: boolean;
}

interface ApplicationsData {
  open: boolean;
  link: string | null;
  emailConfigured: boolean;
  applications: ApplicationRow[];
}

interface DecisionResult {
  outcome: 'ADDED' | 'ALREADY_MEMBER' | 'LINK' | 'DECLINED' | 'RECONSIDERED';
  setupUrl?: string;
  email?: 'SENT' | 'SKIPPED' | 'UNAVAILABLE' | 'FAILED';
  emailReason?: string;
}

/** What to tell the owner about the email to the applicant. */
function emailNote(result: DecisionResult, email: string): string {
  switch (result.email) {
    case 'SENT': return `We emailed ${email} too.`;
    case 'SKIPPED': return `${email} is a test address, so nothing was sent.`;
    case 'FAILED': return `The email to ${email} didn’t go out${result.emailReason ? ` (${result.emailReason})` : ''}.`;
    default: return 'Email isn’t set up for this site, so nothing was sent.';
  }
}

/**
 * The Moderator applications card on the People tab, for the game's owner: take applications through
 * the public link, then approve or decline each one. Approving a new person issues a one-time setup
 * link, shown here once and emailed when the site can send email.
 */
export default function ApplicationsPanel({ gameId, isOwner, canOpen, active, refreshKey, onChanged }: {
  gameId: string;
  isOwner: boolean;
  /** False once the game has ended, when applications can no longer be taken. */
  canOpen: boolean;
  /** The People tab is showing, so the list is kept fresh. */
  active: boolean;
  /** Changes when the console's own refresh sees the application count move. */
  refreshKey: string;
  /** Called after any change here, so the console's counts, tab numbers, and moderator list refresh at once. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<ApplicationsData | null>(null);
  // Results go to the banner under the tab bar; the one-time setup link stays in this card, where it can be copied.
  const { showMessage, showError, clearNotices, operations } = useOperations();
  const ended = useGameEnded(operations?.game?.status);
  const [issued, setIssued] = useState<{ displayName: string; url: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const etag = useRef<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    const response = await conditionalGet(`/api/games/${gameId}/applications`, etag.current);
    if (!response) return;
    const body = await parseJsonResponse<ApplicationsData>(response, 'Unable to load the applications.');
    if (id !== request.current) return;
    etag.current = responseEtag(response);
    setData(body);
  }, [gameId]);

  useEffect(() => {
    if (!active || !isOwner) return;
    const reload = () => void load().catch((caught) => showError(caught instanceof Error ? caught.message : 'Unable to load the applications.'));
    const timer = window.setTimeout(reload, 0);
    const stop = pollWhileVisible(reload, RELAXED_POLL_MS, { idleAfterMs: IDLE_AFTER_MS, stopWhen: () => ended.current });
    return () => { window.clearTimeout(timer); stop(); };
  }, [active, isOwner, load, refreshKey, showError, ended]);

  async function run(action: () => Promise<void>, fallback: string) {
    if (busy) return;
    clearNotices();
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const control = (action: 'OPEN' | 'CLOSE') => run(async () => {
    const next = await requestJson<ApplicationsData>(`/api/games/${gameId}/applications`, { body: { action } });
    etag.current = null;
    // A refresh that started before this change must not overwrite it when it lands.
    request.current += 1;
    setData(next);
    onChanged();
    setIssued(null);
    showMessage(action === 'OPEN' ? 'Applications are open. Share the link below.' : 'Applications are closed.');
  }, 'Unable to update applications.');

  const replaceLink = () => run(async () => {
    await requestJson(`/api/games/${gameId}/signups`, { body: { action: 'ROTATE_LINK' } });
    etag.current = null;
    request.current += 1;
    onChanged();
    await load();
    setIssued(null);
    showMessage('The link was replaced. The old one no longer works for applications or for sign-ups.');
  }, 'Unable to replace the link.');

  const decide = (row: ApplicationRow, decision: 'APPROVE' | 'DECLINE' | 'RECONSIDER') => run(async () => {
    const result = await requestJson<DecisionResult>(`/api/games/${gameId}/applications/${row.id}`, { body: { decision } });
    etag.current = null;
    request.current += 1;
    setIssued(null);
    onChanged();
    if (result.outcome === 'LINK' && result.setupUrl) {
      setIssued({ displayName: row.displayName, url: result.setupUrl, note: emailNote(result, row.email) });
    } else if (result.outcome === 'ADDED') {
      showMessage(`${row.displayName} is now a co-moderator of this game. ${emailNote(result, row.email)}`);
    } else if (result.outcome === 'ALREADY_MEMBER') {
      showMessage(`${row.displayName} was already a moderator of this game.`);
    } else if (result.outcome === 'DECLINED') {
      showMessage(`${row.displayName}’s application was declined.${row.status === 'APPROVED' ? ' Their setup link no longer works.' : ''}`);
    }
    await load().catch(() => {});
  }, 'Unable to update the application.');

  const rows = data?.applications ?? [];
  const waiting = rows.filter((row) => row.status === 'PENDING');
  const approved = rows.filter((row) => row.status === 'APPROVED');
  const declined = rows.filter((row) => row.status === 'DECLINED');

  return (
    <section className="setup-card" id="moderator-applications">
      <div className="setup-card-heading"><span aria-hidden="true">◇</span><div><h2>Moderator applications</h2><p>Let people ask to help run this game. They apply from the game’s public link and you approve each one. Someone new gets an emailed link to choose their own password and becomes a co-moderator; someone who already has a moderator account is added straight away.</p></div></div>
      {!isOwner ? <p className="field-help">Only the game owner can take and review moderator applications.</p> : <>
        {issued && <div className="notice success" role="status">
          <p><strong>{issued.displayName}</strong> is approved. Their private setup link is shown only now, works once, and lasts 7 days. {issued.note} If it didn’t reach them, copy it and send it to them yourself.</p>
          <code className="recovery-list">{issued.url}</code>
          <div className="button-row"><CopyButton text={issued.url} label="Copy setup link" accessibleLabel={`Copy the setup link for ${issued.displayName}`} /></div>
        </div>}
        <div className="button-row">
          <span className="status-pill" aria-label={`Applications: ${data?.open ? 'Open' : 'Closed'}`}>{data?.open ? 'Open' : 'Closed'}</span>
          {data?.open
            ? <button className="secondary-button" type="button" onClick={() => void control('CLOSE')} disabled={busy}>Close applications</button>
            : <button className="primary-button" type="button" onClick={() => void control('OPEN')} disabled={busy || !canOpen}>Open applications</button>}
        </div>
        {!canOpen && !data?.open && <p className="field-help">This game has ended, so it can’t take moderator applications.</p>}
        {data?.link && <div className="ops-block">
          <p className="eyebrow accent">Application link</p>
          <div className="button-row">
            <input readOnly value={data.link} aria-label="Public link for applications" onFocus={(event) => event.currentTarget.select()} />
            <CopyButton text={data.link} label="Copy link" accessibleLabel="Copy the public link for applications" />
            <button className="text-button" type="button" onClick={() => { if (window.confirm('Replace the link? The old link stops working for applications and for sign-ups, so anyone you already sent it to needs the new one.')) void replaceLink(); }} disabled={busy}>Replace link</button>
          </div>
          <p className="field-help">This is the same link players sign up with; it shows the application form while applications are open. Replacing it replaces the sign-up link too.</p>
        </div>}
        <p className="field-help" aria-live="polite">{waiting.length} waiting · {approved.length} approved · {declined.length} declined</p>
        {waiting.length > 0 && <ul className="invite-list" aria-label="Waiting applications">
          {waiting.map((row) => <li key={row.id}>
            <span><strong>{row.displayName}</strong><small>{row.email} · applied {new Date(row.createdAt).toLocaleString()}</small>{row.note && <small>“{row.note}”</small>}</span>
            <span className="button-row">
              <button className="text-button" type="button" onClick={() => void decide(row, 'APPROVE')} disabled={busy} aria-label={`Approve ${row.displayName}`}>Approve</button>
              <button className="text-button" type="button" onClick={() => void decide(row, 'DECLINE')} disabled={busy} aria-label={`Decline ${row.displayName}`}>Decline</button>
            </span>
          </li>)}
        </ul>}
        {waiting.length === 0 && rows.length === 0 && data?.open && <p className="empty-note">No applications yet. Share the link above.</p>}
        {waiting.length === 0 && rows.length > 0 && <p className="empty-note">Nobody is waiting for a decision.</p>}
        {approved.length > 0 && <details>
          <summary>{approved.length} approved</summary>
          <ul className="invite-list" aria-label="Approved applications">
            {approved.map((row) => <li key={row.id}>
              <span><strong>{row.displayName}</strong><small>{row.email} · {row.joined ? 'co-moderator' : row.linkExpired ? 'setup link expired' : 'waiting for them to use the setup link'}</small></span>
              {!row.joined && <span className="button-row">
                <button className="text-button" type="button" onClick={() => void decide(row, 'APPROVE')} disabled={busy} aria-label={`Send ${row.displayName} a new setup link`}>Send a new link</button>
                <button className="text-button" type="button" onClick={() => void decide(row, 'DECLINE')} disabled={busy} aria-label={`Withdraw ${row.displayName}’s approval`}>Withdraw</button>
              </span>}
            </li>)}
          </ul>
        </details>}
        {declined.length > 0 && <details>
          <summary>{declined.length} declined</summary>
          <ul className="invite-list" aria-label="Declined applications">
            {declined.map((row) => <li key={row.id}>
              <span><strong>{row.displayName}</strong><small>{row.email}</small></span>
              <button className="text-button" type="button" onClick={() => void decide(row, 'RECONSIDER')} disabled={busy} aria-label={`Reconsider ${row.displayName}`}>Reconsider</button>
            </li>)}
          </ul>
        </details>}
      </>}
    </section>
  );
}
