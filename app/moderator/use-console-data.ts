'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssignmentBatchView, GameSummary, RosterSeatView, SelectedGameSetup } from '@/lib/game/setup-view';
import type { SignupSummary } from '@/lib/roster/signup-store';
import { parseJsonResponse, RequestError, requestJson } from '@/lib/http/client';
import { conditionalGet, responseEtag } from '@/lib/http/conditional-get';
import { RELAXED_POLL_MS } from '@/lib/http/poll-interval';
import { IDLE_AFTER_MS, pollWhileVisible } from '@/lib/http/poll-while-visible';
import type { Composition } from './console-types';
import { useGameEnded } from './use-game-ended';

/**
 * The console's copy of the signed-in moderator's games and the selected game's setup (roster, role
 * counts, assignment batches), and how it stays current. `GET /api/games` carries all of it in one
 * request, so it is also the sign-in check: a 401 means signed out, and says whether the first
 * moderator account still has to be created.
 *
 * `onError` receives the message when a refresh fails. `onFirstLoad` runs once, after the first
 * successful load, for things that need a signed-in console, such as opening a tab linked by `#`.
 * Both must be stable functions (a state setter or a `useCallback`), or the console reloads on every render.
 */
export function useConsoleData(onError: (message: string) => void, onFirstLoad: () => void) {
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState('');
  const ended = useGameEnded(games.find((game) => game.id === gameId)?.status);
  const [roster, setRoster] = useState<RosterSeatView[]>([]);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [batches, setBatches] = useState<AssignmentBatchView[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [signupSummary, setSignupSummary] = useState<SignupSummary | null>(null);
  const [compositionDraftIds, setCompositionDraftIds] = useState<Set<string>>(() => new Set());
  const selectedGameRef = useRef('');
  const gamesRequest = useRef(0);
  const gameDetailRequest = useRef(0);
  // The ETag of the games list and setup on screen (lib/http/conditional-get.ts).
  // It names the data, not the URL: the first load (no ?gameId=) and the polls
  // that follow (with it) return the same body, so they share one tag.
  const gamesEtag = useRef<string | null>(null);
  const compositionDrafts = useRef(new Map<string, Composition>());

  /** Keeps (or drops) the moderator's unsaved role counts for a game, so a refresh doesn't overwrite them. */
  function markCompositionDraft(selectedGameId: string, draft: Composition | null) {
    if (draft) compositionDrafts.current.set(selectedGameId, draft);
    else compositionDrafts.current.delete(selectedGameId);
    setCompositionDraftIds((current) => {
      const next = new Set(current);
      if (draft) next.add(selectedGameId);
      else next.delete(selectedGameId);
      return next;
    });
  }

  const applyGameSetup = useCallback((selectedGameId: string, setup: Pick<SelectedGameSetup, 'roster' | 'assignments'>) => {
    setRoster(setup.roster.roster);
    setEmailConfigured(Boolean(setup.roster.emailConfigured));
    setSignupSummary(setup.roster.signups ?? null);
    setComposition(compositionDrafts.current.get(selectedGameId) ?? setup.assignments.composition);
    setBatches(setup.assignments.batches);
    if (setup.assignments.game?.status) {
      setGames((current) => current.map((game) => game.id === selectedGameId ? { ...game, status: setup.assignments.game?.status ?? game.status } : game));
    }
  }, []);

  const loadGame = useCallback(async (selectedGameId: string) => {
    const requestId = ++gameDetailRequest.current;
    const [rosterData, assignmentData] = await Promise.all([
      requestJson<SelectedGameSetup['roster']>(`/api/games/${selectedGameId}/roster`),
      requestJson<SelectedGameSetup['assignments']>(`/api/games/${selectedGameId}/assignments`),
    ]);
    if (requestId !== gameDetailRequest.current || selectedGameRef.current !== selectedGameId) return;
    applyGameSetup(selectedGameId, { roster: rosterData, assignments: assignmentData });
  }, [applyGameSetup]);

  // One request: the games list carries the selected game's roster and assignments.
  const loadGames = useCallback(async (preferredGameId = selectedGameRef.current) => {
    const requestId = ++gamesRequest.current;
    const detailRequestId = ++gameDetailRequest.current;
    const query = preferredGameId ? `?gameId=${encodeURIComponent(preferredGameId)}` : '';
    const response = await conditionalGet(`/api/games${query}`, gamesEtag.current);
    // null: nothing changed since what is on screen.
    if (!response) return;
    const data = await parseJsonResponse<{ games: GameSummary[]; selected: SelectedGameSetup | null }>(response);
    if (requestId !== gamesRequest.current) return;
    setAuthenticated(true);
    setGames(data.games);
    const selected = data.selected;
    if (selected) {
      selectedGameRef.current = selected.gameId;
      setGameId(selected.gameId);
      // A game switch that started after this request wins.
      const applied = detailRequestId === gameDetailRequest.current;
      if (applied) applyGameSetup(selected.gameId, selected);
      gamesEtag.current = applied ? responseEtag(response) : null;
    } else {
      gamesEtag.current = responseEtag(response);
      selectedGameRef.current = '';
      setGameId('');
      setRoster([]);
      setSignupSummary(null);
      setComposition(null);
      setBatches([]);
    }
  }, [applyGameSetup]);

  useEffect(() => {
    void (async () => {
      try {
        await loadGames();
        onFirstLoad();
      } catch (caught) {
        // Signed out: the 401 also says whether the first moderator account still has to be created.
        setNeedsBootstrap(caught instanceof RequestError && caught.body.needsBootstrap === true);
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadGames, onFirstLoad]);

  useEffect(() => {
    if (!authenticated) return;
    // The live game panel keeps its own, faster pace near deadlines.
    return pollWhileVisible(() => {
      void loadGames(gameId).catch((caught) => onError(caught instanceof Error ? caught.message : 'Unable to refresh the game.'));
    }, RELAXED_POLL_MS, { idleAfterMs: IDLE_AFTER_MS, stopWhen: () => ended.current });
  }, [authenticated, gameId, loadGames, ended, onError]);

  /** Forgets the selected game's roster, counts, and batches, for after its setup is cancelled. */
  function clearSetup() {
    setRoster([]);
    setComposition(null);
    setBatches([]);
  }

  return {
    loading, authenticated, needsBootstrap, setNeedsBootstrap,
    games, gameId, selectedGame: games.find((game) => game.id === gameId),
    roster, composition, setComposition, batches, emailConfigured, signupSummary,
    compositionDraftIds, markCompositionDraft, selectedGameRef, loadGame, loadGames, clearSetup,
  };
}
