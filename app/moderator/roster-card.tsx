'use client';

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { rosterCountsNote } from '@/lib/game/console-guidance';
import { MIN_PLAYERS } from '@/lib/game/player-count';
import type { RosterSeatView } from '@/lib/game/setup-view';
import { requestJson } from '@/lib/http/client';
import { createInviteExport } from '@/lib/roster/csv';
import { SETUP_STATUSES, type AddedInvite, type Composition, type InviteEmailResult, type InviteRow, type RosterChange } from './console-types';

const SAMPLE_ROSTER = [
  'display_name,email',
  ...Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return `Player ${number},player${number}@example.test`;
  }),
].join('\n');

interface RosterCardProps {
  gameId: string;
  gameStatus: string | undefined;
  roster: RosterSeatView[];
  /** People accepted from sign-ups so far. They are on the roster too. */
  acceptedFromSignups: number;
  emailConfigured: boolean;
  /** Private links from this visit's import, adds and accepted sign-ups, kept only in memory for the invite file. */
  inviteRows: InviteRow[];
  setInviteRows: Dispatch<SetStateAction<InviteRow[]>>;
  addedInvite: AddedInvite | null;
  setAddedInvite: Dispatch<SetStateAction<AddedInvite | null>>;
  /** False once the moderator has moved to another game, so a slow request doesn't report into the wrong one. */
  isCurrentGame: (gameId: string) => boolean;
  reloadGame: (gameId: string) => Promise<void>;
  /** The roster change reset or adjusted the role counts: show them and drop any unsaved edits. */
  onCompositionChanged: (gameId: string, composition: Composition) => void;
  showMessage: (text: string) => void;
  showError: (text: string) => void;
}

function rosterChangeMessage(summary: string, data: RosterChange) {
  const counts = data.resetToPreset
    ? `Role counts were reset to the standard preset for ${data.playerCount} players.`
    : `Role counts now have ${data.composition.VILLAGER} ${data.composition.VILLAGER === 1 ? 'Villager' : 'Villagers'}; other roles are unchanged.`;
  return `${summary} The roster now has ${data.playerCount} players. ${counts}`;
}

/**
 * The Setup tab's roster card: import or paste a list, add or remove one player, email the invitations,
 * and see who has not claimed a seat yet.
 */
export default function RosterCard({
  gameId, gameStatus, roster, acceptedFromSignups, emailConfigured, inviteRows, setInviteRows, addedInvite, setAddedInvite,
  isCurrentGame, reloadGame, onCompositionChanged, showMessage, showError,
}: RosterCardProps) {
  const [editingRoster, setEditingRoster] = useState(false);
  const [emailingInvites, setEmailingInvites] = useState(false);

  const setupEditable = SETUP_STATUSES.has(gameStatus ?? '');
  // Single-seat edits close once roles are randomized (see lib/game/roster-edit.ts).
  const rosterEditable = ['DRAFT', 'REGISTRATION'].includes(gameStatus ?? '') && roster.length > 0;
  const claimed = roster.filter((seat) => seat.status === 'CLAIMED').length;
  const unclaimed = roster.filter((seat) => seat.status === 'INVITED');
  const shownInvite = addedInvite?.gameId === gameId && unclaimed.some((seat) => seat.id === addedInvite.seatId) ? addedInvite : null;

  /**
   * Imports the pasted list. With people already on the roster it is added to them (ADD): everyone
   * there keeps their seat and link. The separate Replace button starts the roster over (REPLACE).
   */
  async function importRoster(form: HTMLFormElement, mode: 'ADD' | 'REPLACE') {
    if (editingRoster) return;
    const editedGame = gameId;
    const csv = new FormData(form).get('csv');
    showError('');
    // The box starts with an example list. Adding it to a real roster would put twenty made-up players on it.
    if (mode === 'ADD' && String(csv ?? '').trim() === SAMPLE_ROSTER.trim()) {
      showError('The list in the box is only an example. Paste your own players there first, then add them.');
      return;
    }
    setEditingRoster(true);
    try {
      // A replace says how many players this page is showing, so it is refused if someone else has changed the roster since.
      const data = await requestJson<RosterChange & { invites: InviteRow[]; added?: number; skipped?: number }>(`/api/games/${editedGame}/roster`, {
        body: { csv, mode, expectedSeatCount: mode === 'REPLACE' ? roster.length : undefined },
      });
      if (!isCurrentGame(editedGame)) return;
      onCompositionChanged(editedGame, data.composition);
      if (mode === 'ADD') {
        const added = data.added ?? data.invites.length;
        const skipped = data.skipped ?? 0;
        // Links are shown once, so keep them with any from people accepted earlier in this visit.
        setInviteRows((current) => [...current, ...data.invites]);
        const counts = rosterCountsNote({ playerCount: data.playerCount, resetToPreset: data.resetToPreset, villagers: data.composition.VILLAGER });
        showMessage(`${added} ${added === 1 ? 'player was' : 'players were'} added to the roster${skipped ? `; ${skipped} already on it ${skipped === 1 ? 'was' : 'were'} left as they are` : ''}. ${counts} Email their invitations below, or download the invite file now; the links are not shown again.`);
      } else {
        setInviteRows(data.invites);
        showMessage(`${data.playerCount} private seats created. Email the invitations below, or download the invite file now; codes are not shown again.`);
      }
    } catch (caught) {
      if (isCurrentGame(editedGame)) showError(caught instanceof Error ? caught.message : 'Unable to import the roster.');
    } finally {
      setEditingRoster(false);
      if (isCurrentGame(editedGame)) await reloadGame(editedGame).catch(() => {});
    }
  }

  function replaceRoster(form: HTMLFormElement | null) {
    if (!form || editingRoster) return;
    const fromSignups = acceptedFromSignups > 0 ? ` That includes the ${acceptedFromSignups} ${acceptedFromSignups === 1 ? 'person' : 'people'} you accepted from sign-ups; they go back to waiting, and you can accept them again.` : '';
    if (!window.confirm(`Replace the whole roster with this list? Everyone on the roster now is removed and every invitation link already sent stops working.${fromSignups} Anyone who already claimed a seat must claim again.`)) return;
    void importRoster(form, 'REPLACE');
  }

  async function addSeat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingRoster) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const editedGame = gameId;
    showError('');
    showMessage('');
    setEditingRoster(true);
    try {
      const data = await requestJson<RosterChange & { seat: RosterSeatView; claimUrl: string; inviteCode: string }>(`/api/games/${editedGame}/seats`, {
        body: { displayName: form.get('displayName'), email: form.get('email') },
      });
      if (!isCurrentGame(editedGame)) return;
      formElement.reset();
      onCompositionChanged(editedGame, data.composition);
      setInviteRows((current) => [...current, { displayName: data.seat.displayName, email: data.seat.email, claimUrl: data.claimUrl, inviteCode: data.inviteCode }]);
      setAddedInvite({ gameId: editedGame, seatId: data.seat.id, displayName: data.seat.displayName, claimUrl: data.claimUrl });
      showMessage(rosterChangeMessage(`${data.seat.displayName} was added.`, data));
    } catch (caught) {
      if (isCurrentGame(editedGame)) showError(caught instanceof Error ? caught.message : 'Unable to add the player.');
    } finally {
      setEditingRoster(false);
      if (isCurrentGame(editedGame)) await reloadGame(editedGame).catch(() => {});
    }
  }

  async function removeSeat(seat: RosterSeatView) {
    if (editingRoster) return;
    if (!window.confirm(`Remove ${seat.displayName} from the roster? Their invitation link stops working. You can add them again later.`)) return;
    const editedGame = gameId;
    showError('');
    showMessage('');
    setEditingRoster(true);
    try {
      const data = await requestJson<RosterChange>(`/api/games/${editedGame}/seats/${encodeURIComponent(seat.id)}`, { method: 'DELETE' });
      if (!isCurrentGame(editedGame)) return;
      onCompositionChanged(editedGame, data.composition);
      setAddedInvite((current) => current?.seatId === seat.id ? null : current);
      setInviteRows((current) => current.filter((row) => row.email !== seat.email));
      showMessage(rosterChangeMessage(`${seat.displayName} was removed.`, data));
    } catch (caught) {
      if (isCurrentGame(editedGame)) showError(caught instanceof Error ? caught.message : 'Unable to remove the player.');
    } finally {
      setEditingRoster(false);
      if (isCurrentGame(editedGame)) await reloadGame(editedGame).catch(() => {});
    }
  }

  async function copyAddedInvite() {
    if (!addedInvite) return;
    try {
      await navigator.clipboard.writeText(addedInvite.claimUrl);
      showMessage(`Copied ${addedInvite.displayName}’s private link. Send it only to them.`);
    } catch {
      showError('Copy failed. Select the link and copy it by hand.');
    }
  }

  async function emailInvites(seats: RosterSeatView[]) {
    if (!seats.length || emailingInvites) return;
    if (seats.length > 1 && !window.confirm(`Email a new private link to ${seats.length} players who haven’t claimed a seat? Any earlier link for them, including the invite CSV, stops working.`)) return;
    showError('');
    showMessage('');
    setEmailingInvites(true);
    // A send can take a while; the result belongs only to the game it came from.
    const sentFrom = gameId;
    const stillOnGame = () => isCurrentGame(sentFrom);
    try {
      const data = await requestJson<{ sent: number; results: InviteEmailResult[] }>(`/api/games/${sentFrom}/invites`, {
        body: { seatIds: seats.map((seat) => seat.id) },
      });
      if (!stillOnGame()) return;
      // Emailed links replace the ones in the downloaded file. Skipped test
      // addresses keep their links, so the file stays valid if nothing else changed.
      if (data.results.some((result) => result.status !== 'SKIPPED')) setInviteRows([]);
      setAddedInvite((current) => data.results.some((result) => result.seatId === current?.seatId && result.status !== 'SKIPPED') ? null : current);
      // Reserved test addresses are skipped by design, so they are a note, not an error.
      const failed = data.results.filter((result) => result.status === 'FAILED');
      const skipped = data.results.filter((result) => result.status === 'SKIPPED').length;
      showMessage(`Emailed ${data.sent} of ${data.results.length} ${data.results.length === 1 ? 'player' : 'players'}.${skipped ? ` Skipped ${skipped} test ${skipped === 1 ? 'address' : 'addresses'}, which can’t receive mail.` : ''}`);
      if (failed.length) showError(`Not sent: ${failed.map((result) => `${result.displayName} (${result.reason ?? 'not sent'})`).join('; ')}`);
    } catch (caught) {
      if (stillOnGame()) showError(caught instanceof Error ? caught.message : 'Unable to email invitations.');
    } finally {
      setEmailingInvites(false);
      if (stillOnGame()) await reloadGame(sentFrom).catch(() => {});
    }
  }

  function downloadInvites() {
    const url = URL.createObjectURL(new Blob([createInviteExport(inviteRows)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'watercooler-werewolf-invites.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!setupEditable) {
    return <section className="setup-card" id="setup-roster"><p className="notice warning">This game is {gameStatus?.replaceAll('_', ' ').toLowerCase()}. Setup changes are locked. Select another game or start a new setup.</p></section>;
  }

  return (
    <section className="setup-card" id="setup-roster">
      <div className="setup-card-heading"><span>2b</span><div><h2>Import the roster</h2><p>Use the exact CSV headers below. Use this, the <strong>Sign-ups</strong> card above, or both, in either order. Once anyone is on the roster, an imported list is added to it: they keep their seats and links, and anyone on the list who is already there is skipped. To start over from the list instead, use <strong>Replace the whole roster</strong>. To add or remove one player, use <strong>Change the roster</strong> below. Presets start at {MIN_PLAYERS} players and add special roles in stages; they are starting points, not a balance guarantee.</p></div></div>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void importRoster(event.currentTarget, roster.length > 0 ? 'ADD' : 'REPLACE'); }}>
        <label>Roster CSV<textarea name="csv" defaultValue={SAMPLE_ROSTER} rows={8} spellCheck={false} required /></label>
        {roster.length > 0 && <p className="field-help" role="note">This list will be added to the {roster.length} {roster.length === 1 ? 'player' : 'players'} already on the roster{acceptedFromSignups > 0 ? `, including the ${acceptedFromSignups} you accepted from sign-ups` : ''}. They keep their seats and links.</p>}
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={editingRoster}>{roster.length > 0 ? 'Add these players to the roster' : 'Create private seats'}</button>
          {roster.length > 0 && <button className="secondary-button" type="button" onClick={(event) => replaceRoster(event.currentTarget.form)} disabled={editingRoster}>Replace the whole roster</button>}
          {inviteRows.length > 0 && <button className="secondary-button" type="button" onClick={downloadInvites}>Download invite CSV</button>}
        </div>
      </form>
      {roster.length > 0 && <div className="claim-meter"><span style={{ width: `${(claimed / roster.length) * 100}%` }} /><strong>{claimed} of {roster.length} claimed</strong></div>}
      {rosterEditable ? <div className="invite-email roster-edit">
        <p><strong>Change the roster</strong></p>
        <p className="field-help">Add a late joiner, or remove someone who hasn’t claimed their seat. Everyone else keeps their seat. Each change adds or removes one Villager. This locks once you randomize roles.</p>
        <form className="setup-grid" onSubmit={addSeat} aria-label="Add a player">
          <label>Display name<input name="displayName" maxLength={80} autoComplete="off" required /></label>
          <label>Email<input name="email" type="email" autoComplete="off" required /></label>
          <div className="button-row wide"><button className="secondary-button" type="submit" disabled={editingRoster}>{editingRoster ? 'Saving…' : 'Add player'}</button></div>
        </form>
        {shownInvite && <div className="added-invite">
          <p className="field-help">{shownInvite.displayName}’s private link is shown only now. Copy it and send it only to them{emailConfigured ? ', or use Email in the waiting list below' : ''}.</p>
          <div className="button-row"><input readOnly value={shownInvite.claimUrl} aria-label={`${shownInvite.displayName}’s private link`} onFocus={(event) => event.currentTarget.select()} /><button className="text-button" type="button" onClick={() => void copyAddedInvite()}>Copy link</button></div>
        </div>}
      </div> : roster.length > 0 && gameStatus === 'ASSIGNMENT_PREVIEW' && <p className="field-help roster-lock-note">Roles have been randomized, so players can’t be added or removed. To change the roster, select <strong>Save composition</strong> to discard the preview.</p>}
      {unclaimed.length > 0 && <div className="invite-email">
        <div className="button-row">
          <button className="primary-button" type="button" onClick={() => void emailInvites(unclaimed)} disabled={!emailConfigured || emailingInvites}>{emailingInvites ? 'Sending…' : `Email invites to ${unclaimed.length} unclaimed ${unclaimed.length === 1 ? 'player' : 'players'}`}</button>
        </div>
        <p className="field-help">{emailConfigured ? 'Each email holds a new private link. Any earlier link for that player, including the one in the invite CSV, stops working.' : 'Invite email is not set up for this site, so use Download invite CSV. The site operator can turn email on in Vercel.'}</p>
        <details>
          <summary>Waiting on {unclaimed.length} {unclaimed.length === 1 ? 'player' : 'players'}</summary>
          <ul className="invite-list">
            {unclaimed.map((seat) => <li key={seat.id}>
              <span><strong>{seat.displayName}</strong><small>{seat.email} · {seat.invitationEmailedAt ? `emailed ${new Date(seat.invitationEmailedAt).toLocaleString()}` : 'not emailed'}</small></span>
              <span className="button-row">
                {emailConfigured && <button className="text-button" type="button" onClick={() => void emailInvites([seat])} disabled={emailingInvites}>{seat.invitationEmailedAt ? 'Resend' : 'Email'}</button>}
                {rosterEditable && <button className="text-button" type="button" onClick={() => void removeSeat(seat)} disabled={editingRoster || roster.length === MIN_PLAYERS} aria-label={`Remove ${seat.displayName}`}>Remove</button>}
              </span>
            </li>)}
          </ul>
        </details>
      </div>}
    </section>
  );
}
