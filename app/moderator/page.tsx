'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConsoleNavigation, ConsolePanel } from './console-tabs';
import LaunchChecklistAside from './launch-checklist';
import LiveGamePanel from './live-game-panel';
import ModeratorSignIn, { type SignedIn } from './moderator-sign-in';
import { OperationsProvider } from './operations-context';
import ApplicationsPanel from './applications-panel';
import { Announcements, BackupControls, ChatRooms, CoModeratorAccess, EventLog, FailSafeControls, FeedbackSection, HealthStrip, PlayerAccessRecovery, RestoredInvites } from './ops-sections';
import PlayerChoicesPanel from './player-choices-panel';
import { AssignmentReviewCard, RoleBalanceCard } from './role-cards';
import RosterCard from './roster-card';
import { GameScheduleCard, NewGameCard, WelcomeCard } from './schedule-cards';
import { scheduleRequestBody } from './schedule-fields';
import SignupsPanel, { type AcceptedSignups } from './signups-panel';
import SpectatorsPanel from './spectators-panel';
import StatsPanel from './stats-panel';
import BrandHeader from './brand-header';
import { SETUP_STATUSES, type AddedInvite, type InviteRow } from './console-types';
import { useConsoleData } from './use-console-data';
import { shouldRefreshOperations } from '@/lib/game/operations-refresh';
import { defaultConsoleTab, isConsoleTabId, launchChecklist, resolveConsoleTab, setupHint, waitingBadges, type ConsoleTabId, type SetupStepKey, type TabChoice } from '@/lib/game/console-guidance';
import { MIN_PLAYERS } from '@/lib/game/player-count';
import { requestJson } from '@/lib/http/client';
import { COULD_NOT_REACH, plainError } from '@/lib/http/plain-error';

/** Where each setup step lives on the Setup tab, and what the "next step" note calls the button that jumps there. */
const SETUP_STEP_SECTIONS: Record<SetupStepKey, { id: string; label: string }> = {
  signups: { id: 'setup-signups', label: 'Go to sign-ups' },
  roster: { id: 'setup-roster', label: 'Go to the roster' },
  roles: { id: 'setup-roles', label: 'Go to the roles' },
  release: { id: 'setup-release', label: 'Go to release' },
};

export default function ModeratorPage() {
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  // Private links from this session's import and single-player adds, kept only in memory.
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([]);
  const [addedInvite, setAddedInvite] = useState<AddedInvite | null>(null);
  const [message, setMessage] = useState('');
  const clearMessage = useCallback(() => setMessage(''), []);
  const [error, setError] = useState('');
  const clearPageNotices = useCallback(() => { setMessage(''); setError(''); }, []);
  const [liveRefreshToken, setLiveRefreshToken] = useState(0);
  const [showNewGameForm, setShowNewGameForm] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  // The tab the moderator picked; until they pick one, the console opens on Setup or Run game by the game's status.
  const [selectedTab, setSelectedTab] = useState<TabChoice | null>(null);
  // A result or follow-up is waiting on the moderator, reported by the live game panel, so the Run game tab can say so.
  const [runAttention, setRunAttention] = useState(false);

  // A link such as /moderator#messages opens that tab.
  const openLinkedTab = useCallback(() => {
    const linked = window.location.hash.slice(1);
    if (isConsoleTabId(linked)) setSelectedTab({ id: linked, forDefault: null });
  }, []);
  const {
    loading, authenticated, needsBootstrap, setNeedsBootstrap, games, gameId, selectedGame, roster, composition, setComposition,
    batches, emailConfigured, signupSummary, compositionDraftIds, markCompositionDraft, selectedGameRef, loadGame, loadGames, clearSetup,
  } = useConsoleData(setError, openLinkedTab);

  // The same link also works while the console is already open.
  useEffect(() => {
    window.addEventListener('hashchange', openLinkedTab);
    return () => window.removeEventListener('hashchange', openLinkedTab);
  }, [openLinkedTab]);

  const handleLiveChange = useCallback((action?: string) => {
    if (shouldRefreshOperations(action)) setLiveRefreshToken((token) => token + 1);
    void loadGames(gameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
  }, [gameId, loadGames]);

  async function handleSignedIn({ recoveryCodes: codes, recovered }: SignedIn) {
    setRecoveryCodes(codes);
    setNeedsBootstrap(false);
    setMessage(recovered ? 'Moderator password recovered. All previous moderator sessions were invalidated.' : '');
    await loadGames();
  }

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await requestJson<{ gameId: string }>('/api/games', { body: scheduleRequestBody(form) });
      setMessage('Game created. Import the player roster next.');
      setInviteRows([]);
      setShowNewGameForm(false);
      setShowSchedulePanel(false);
      setSelectedTab(null);
      await loadGames(data.gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the game.');
    }
  }

  function selectGame(nextGameId: string) {
    if (!nextGameId) return;
    setShowNewGameForm(false);
    setShowSchedulePanel(false);
    setSelectedTab(null);
    setInviteRows([]);
    setMessage('');
    setError('');
    selectedGameRef.current = nextGameId;
    void loadGames(nextGameId).catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load the selected game.'));
  }

  function startNewSetup() {
    setShowNewGameForm(true);
    setShowSchedulePanel(false);
    setError('');
    setMessage('');
    setInviteRows([]);
  }

  function openGameSchedule() {
    setError('');
    setMessage('');
    if (!selectedGame) {
      setShowNewGameForm(true);
      setShowSchedulePanel(false);
    } else {
      setShowNewGameForm(false);
      setShowSchedulePanel(true);
      chooseTab('setup');
    }
    window.setTimeout(() => document.getElementById('game-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  /** Picks a tab. It holds until the game flips between setup and running, when the console goes to the tab that suits it. */
  function chooseTab(id: ConsoleTabId) {
    setSelectedTab({ id, forDefault: defaultConsoleTab(selectedGame?.status, Boolean(batches[0]?.releasedAt)) });
  }

  /** Jumps to a step of the launch checklist on the Setup tab. */
  function goToSetupStep(sectionId: string) {
    setShowNewGameForm(false);
    chooseTab('setup');
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function updateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGame || !setupEditable) return;
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/games/${gameId}/schedule`, { method: 'PATCH', body: scheduleRequestBody(form) });
      setMessage('Game schedule updated. The launch checklist is ready to continue.');
      await loadGames(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the game schedule.');
    }
  }

  async function cancelSetup() {
    if (!selectedGame) return;
    if (!window.confirm(`Cancel “${selectedGame.name}” and start a new setup? This permanently cancels the unfinished setup, invalidates all invite links and player sessions for it, and retains its audit history.`)) return;
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/operations`, { body: { action: 'CANCEL_SETUP', confirmed: true, confirmationName: selectedGame.name } });
      markCompositionDraft(gameId, null);
      setInviteRows([]);
      clearSetup();
      setShowNewGameForm(true);
      setMessage('The unfinished setup was cancelled. Its invite links and player sessions are invalid, and its audit history remains available.');
      await loadGames(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel the setup.');
    }
  }

  /** People accepted from the sign-up list are now seats; keep their private links for the invite file and show the new role counts. */
  function signupsAccepted(result: AcceptedSignups) {
    const acceptedFor = gameId;
    // The moderator moved to another game while the accept was in flight: its seats and counts are not this game's.
    if (selectedGameRef.current !== acceptedFor) return;
    markCompositionDraft(acceptedFor, null);
    setComposition(result.composition);
    setInviteRows((current) => [...current, ...result.invites]);
    void loadGame(acceptedFor).catch(() => {});
  }

  async function saveComposition() {
    if (!composition) return;
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, { body: { action: 'SAVE_COMPOSITION', composition } });
      markCompositionDraft(gameId, null);
      setMessage('Role composition saved and logged.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save role counts.');
    }
  }

  async function previewAssignments() {
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, { body: { action: 'PREVIEW' } });
      setMessage('A new cryptographically randomized assignment batch is ready for review.');
      await loadGame(gameId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to randomize roles.');
    }
  }

  async function releaseAssignments(batchId: string) {
    if (!window.confirm('Release roles? Every player will see their role, and this can’t be undone.')) return;
    setError('');
    try {
      await requestJson(`/api/games/${gameId}/assignments`, { body: { action: 'RELEASE', batchId } });
      setMessage('Roles released. Each player can now see only their own role.');
      chooseTab('run');
      await loadGames();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to release roles.');
    }
  }

  async function signOut() {
    try {
      const response = await fetch('/api/moderators/logout', { method: 'POST' });
      if (!response.ok) throw new Error(COULD_NOT_REACH);
    } catch (caught) {
      setError(plainError(caught, COULD_NOT_REACH));
      return;
    }
    // A full page load, so nothing from the signed-in console (games, roster, roles) stays in memory.
    window.location.reload();
  }

  const setupEditable = Boolean(selectedGame && SETUP_STATUSES.has(selectedGame.status));
  const canCancelSetup = setupEditable && selectedGame?.moderatorRole === 'OWNER';
  const claimed = roster.filter((seat) => seat.status === 'CLAIMED').length;
  const latestBatch = batches[0];
  const released = Boolean(latestBatch?.releasedAt);
  const activeTab = resolveConsoleTab(selectedTab, defaultConsoleTab(selectedGame?.status, released));
  const checklist = launchChecklist({ gameCount: games.length, seatCount: roster.length, claimedCount: claimed, hasBatch: Boolean(latestBatch), released });
  const hint = setupHint({ status: selectedGame?.status, seatCount: roster.length, claimedCount: claimed, hasBatch: Boolean(latestBatch), released, pendingSignups: signupSummary?.pending ?? 0, signupsOpen: signupSummary?.live ?? false });
  const waiting = waitingBadges({ pendingSignups: signupSummary?.pending ?? 0, pendingApplications: signupSummary?.pendingApplications ?? 0, setupEditable, isOwner: selectedGame?.moderatorRole === 'OWNER' });

  if (loading) return <main className="setup-shell backstage"><BrandHeader /><p className="setup-loading">Opening the moderator console…</p></main>;

  if (!authenticated) return <ModeratorSignIn needsBootstrap={needsBootstrap} onSignedIn={handleSignedIn} />;

  return (
    <main className="setup-shell backstage">
      <BrandHeader />
      <div className="console-layout">
        <LaunchChecklistAside
          checklist={checklist}
          reviewingSchedule={showSchedulePanel || showNewGameForm}
          hasGame={Boolean(selectedGame)}
          rolesTarget={setupEditable && composition ? 'setup-roles' : 'setup-release'}
          rolesEnabled={Boolean(latestBatch) || Boolean(setupEditable && composition)}
          hasBatch={Boolean(latestBatch)}
          onOpenSchedule={openGameSchedule}
          onGoToStep={goToSetupStep}
        />

        <section className="console-main">
          <div className="console-title">
            <div><p className="eyebrow accent">Office campaign</p><h1>{selectedGame?.name ?? 'Set up a new game'}</h1></div>
            <div className="console-title-actions">{selectedGame && <span className="status-pill">{selectedGame.status.replaceAll('_', ' ')}</span>}</div>
          </div>
          <div className={`game-bar${games.length ? '' : ' bare'}`}>
            {games.length > 0 && (
              <label className="game-selector-label">Selected game
                <select aria-label="Selected game" value={gameId} onChange={(event) => selectGame(event.target.value)}>
                  {games.map((game) => <option key={game.id} value={game.id}>{game.name} · {game.status.replaceAll('_', ' ')}</option>)}
                </select>
              </label>
            )}
            <div className="game-bar-actions">
              {showNewGameForm && games.length > 0 && <button className="secondary-button" type="button" onClick={() => setShowNewGameForm(false)}>Back to selected game</button>}
              <button className="secondary-button" type="button" onClick={startNewSetup}>Start new setup</button>
              <button className="text-button" type="button" onClick={signOut}>Sign out</button>
            </div>
          </div>
          {/* With a game open the result is pinned under the tab bar; without one (the new-game form, the welcome page) there is no tab bar, so it is shown here. */}
          {(!games.length || showNewGameForm) && <>
            {error && <p className="notice error" role="alert">{error}</p>}
            {message && <p className="notice success" role="status">{message}</p>}
          </>}
          {recoveryCodes.length > 0 && (
            <div className="notice warning"><strong>Save these one-time recovery codes now:</strong><code>{recoveryCodes.join(' · ')}</code></div>
          )}
          {hint && games.length > 0 && !showNewGameForm && <section className="next-step page-next-step" aria-label="Next step"><div><strong>{hint.title}</strong> {hint.detail}</div>{hint.step && <button className="secondary-button" type="button" onClick={() => goToSetupStep(SETUP_STEP_SECTIONS[hint.step!].id)}>{SETUP_STEP_SECTIONS[hint.step].label}</button>}</section>}

          {!games.length && <WelcomeCard />}

          {!games.length || showNewGameForm ? (
            <NewGameCard onSubmit={createGame} />
          ) : (
            <OperationsProvider key={`operations-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} onGameChanged={handleLiveChange}>
              <ConsoleNavigation active={activeTab} onSelect={chooseTab} runAttention={runAttention} waiting={waiting} notices={{ error, message, clearMessage, clearAll: clearPageNotices }} />

              <ConsolePanel id="setup" active={activeTab === 'setup'}>
                {activeTab === 'setup' && <RestoredInvites />}
                {showSchedulePanel && selectedGame && <GameScheduleCard game={selectedGame} editable={setupEditable} onSubmit={updateSchedule} onClose={() => setShowSchedulePanel(false)} />}
                {setupEditable && selectedGame && <SignupsPanel key={`signups-${gameId}`} gameId={gameId} gameStatus={selectedGame.status} active={activeTab === 'setup'} refreshKey={`${signupSummary?.state}-${signupSummary?.pending}-${signupSummary?.accepted}`} onAccepted={signupsAccepted} onRosterChanged={() => void loadGame(gameId).catch(() => {})} />}
                <RosterCard
                  gameId={gameId}
                  gameStatus={selectedGame?.status}
                  roster={roster}
                  acceptedFromSignups={signupSummary?.accepted ?? 0}
                  emailConfigured={emailConfigured}
                  inviteRows={inviteRows}
                  setInviteRows={setInviteRows}
                  addedInvite={addedInvite}
                  setAddedInvite={setAddedInvite}
                  isCurrentGame={(id) => selectedGameRef.current === id}
                  reloadGame={loadGame}
                  onCompositionChanged={(id, next) => { markCompositionDraft(id, null); setComposition(next); }}
                  showMessage={setMessage}
                  showError={setError}
                />
                {setupEditable && composition && roster.length >= MIN_PLAYERS && (
                  <RoleBalanceCard
                    composition={composition}
                    rosterCount={roster.length}
                    allClaimed={claimed === roster.length}
                    hasUnsavedCounts={compositionDraftIds.has(gameId)}
                    onChange={(next) => { markCompositionDraft(gameId, next); setComposition(next); }}
                    onSave={saveComposition}
                    onRandomize={previewAssignments}
                  />
                )}
                {latestBatch && <AssignmentReviewCard batch={latestBatch} roster={roster} setupEditable={setupEditable} onRelease={releaseAssignments} />}
                {canCancelSetup && <section className="setup-card start-over" id="setup-start-over">
                  <div className="setup-card-heading"><span aria-hidden="true">▲</span><div><h2>Start over</h2><p>Cancel this unfinished setup and begin a new game. Its invite links and player sessions stop working; its audit history is kept.</p></div></div>
                  <button className="danger-button" type="button" onClick={() => void cancelSetup()}>Cancel setup and start new game</button>
                </section>}
              </ConsolePanel>

              <ConsolePanel id="run" active={activeTab === 'run'}>
                <HealthStrip />
                {released ? <>
                  <LiveGamePanel key={`live-${gameId}`} gameId={gameId} gameStatus={selectedGame?.status ?? ''} onChanged={handleLiveChange} onAttention={setRunAttention} />
                  <PlayerChoicesPanel key={`choices-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} />
                  <StatsPanel key={`stats-${gameId}`} gameId={gameId} refreshToken={liveRefreshToken} />
                </> : <section className="setup-card run-placeholder">
                  <div className="setup-card-heading"><span aria-hidden="true">▶</span><div><h2>{selectedGame?.status === 'CANCELLED' || selectedGame?.status === 'STOPPED' ? 'There is no game to run' : 'The game hasn’t started yet'}</h2><p>{selectedGame?.status === 'CANCELLED' ? 'This setup was cancelled.' : selectedGame?.status === 'STOPPED' ? 'This game was stopped before its roles were released.' : 'Phases, results, and every player’s choices appear here once you release the roles.'}</p></div></div>
                  {setupEditable && <button className="secondary-button" type="button" onClick={() => chooseTab('setup')}>Back to setup</button>}
                </section>}
              </ConsolePanel>

              <ConsolePanel id="people" active={activeTab === 'people'}>
                <section className="setup-card" id="player-access">
                  <div className="setup-card-heading"><span aria-hidden="true">◈</span><div><h2>Player access</h2><p>Get a player back in when they forget their PIN or their seat locks.</p></div></div>
                    <div className="card-stack"><PlayerAccessRecovery /></div>
                </section>
                {released
                  ? <SpectatorsPanel key={`spectators-${gameId}`} gameId={gameId} gameStatus={selectedGame?.status ?? ''} />
                  : <section className="setup-card spectators-card" id="spectators">
                    <div className="setup-card-heading"><span>◉</span><div><h2>Spectators</h2><p>Let people watch once the game is running. They have no role and no vote.</p></div></div>
                    <p className="field-help">Spectators can be added after you release the roles.</p>
                  </section>}
                <section className="setup-card" id="moderators">
                  <div className="setup-card-heading"><span aria-hidden="true">◆</span><div><h2>Moderators</h2><p>Share this game with co-moderators. Only the owner can add or remove them, or hand the game over.</p></div></div>
                  <div className="card-stack"><CoModeratorAccess /></div>
                </section>
                <ApplicationsPanel key={`applications-${gameId}`} gameId={gameId} isOwner={selectedGame?.moderatorRole === 'OWNER'} canOpen={!['CANCELLED', 'STOPPED', 'COMPLETED'].includes(selectedGame?.status ?? '')} active={activeTab === 'people'} refreshKey={`${signupSummary?.applicationsOpen}-${signupSummary?.pendingApplications}`} onChanged={handleLiveChange} />
              </ConsolePanel>

              <ConsolePanel id="messages" active={activeTab === 'messages'}>
                <section className="setup-card" id="announcements">
                  <div className="setup-card-heading"><span aria-hidden="true">▤</span><div><h2>Announcements</h2><p>Tell every player something official, then copy it into an email or group chat so nobody misses it.</p></div></div>
                    <div className="card-stack"><Announcements /></div>
                </section>
                <section className="setup-card" id="chat-moderation">
                  <div className="setup-card-heading"><span aria-hidden="true">◐</span><div><h2>Chat moderation</h2><p>Read any room, post as Moderator, make a room read-only, or remove a message.</p></div></div>
                  <div className="card-stack"><ChatRooms /></div>
                </section>
                <section className="setup-card" id="feedback">
                  <div className="setup-card-heading"><span aria-hidden="true">◒</span><div><h2>Feedback and ratings</h2><p>What players and moderators have said about the game so far.</p></div></div>
                  <div className="card-stack"><FeedbackSection /></div>
                </section>
              </ConsolePanel>

              <ConsolePanel id="safety" active={activeTab === 'safety'}>
                <section className="setup-card" id="records">
                  <div className="setup-card-heading"><span aria-hidden="true">▦</span><div><h2>Records and backups</h2><p>What the game has been doing, and private copies you can keep or restore from.</p></div></div>
                    <div className="card-stack"><EventLog /><BackupControls /></div>
                </section>
                <section className="setup-card danger-zone" id="danger-zone">
                  <div className="setup-card-heading"><span aria-hidden="true">▲</span><div><h2>Danger zone</h2><p>These end a game or rewind it. Read the confirmation before you agree.</p></div></div>
                  <div className="card-stack"><FailSafeControls /></div>
                </section>
              </ConsolePanel>
            </OperationsProvider>
          )}
        </section>
      </div>
    </main>
  );
}
