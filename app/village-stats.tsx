'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { conditionalGet, responseEtag } from '../lib/http/conditional-get';
import { IDLE_AFTER_MS, pollWhileVisible } from '../lib/http/poll-while-visible';
import { pollInterval } from '../lib/http/poll-interval';
import type { BallotStats, GameStats } from '../lib/game/game-stats';
import { eliminationCause, readableRole } from '../lib/game/timeline-view';
import { BarList, ColumnChart, DataTable, Section, StepChart, VoteMatrix, plural, type ColumnDatum, type StepPoint } from './village-stats-charts';

const FINISHED_GAME_STATUSES = new Set(['COMPLETED', 'STOPPED', 'CANCELLED']);

interface VillageStatsProps {
  /** Where the numbers come from: `/api/stats` for players and spectators, the game's stats route for moderators. */
  endpoint: string;
  /** Changes when a result is published or the game's state changes: the stats refresh at once instead of waiting for their next turn. */
  refreshKey?: string;
  /** The open phase, which sets how often the stats refresh (the same pace as the dashboard). */
  pacing?: { status: string; deadline?: string | null } | null;
  /** Fixed numbers to show instead of fetching, for the Player View Studio. */
  sample?: GameStats;
  /** The page's own heading and introduction. Leave off where the surrounding page has one. */
  showHeader?: boolean;
}

function formatDate(date: string, long: boolean): string {
  const instant = new Date(`${date}T12:00:00.000Z`);
  return instant.toLocaleDateString('en-US', long ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function hourLabel(hour: number, long: boolean): string {
  const clock = hour % 12 || 12;
  return long ? `${clock}:00 ${hour < 12 ? 'AM' : 'PM'}` : `${clock}${hour < 12 ? 'a' : 'p'}`;
}

function describeStep(eliminations: GameStats['story']['steps'][number]['eliminations']): string {
  return eliminations.length ? `${eliminations.map((item) => item.displayName).join(' and ')} left` : '';
}

/** A short line of facts about one ballot. Everything in it comes from the public votes and the published result. */
function ballotFacts(ballot: BallotStats): string[] {
  const facts: string[] = [];
  if (ballot.topVotes > 0) {
    if (ballot.tiedAtTop) facts.push(`Tied at the top: ${ballot.leaders.join(' and ')} with ${plural(ballot.topVotes, 'vote')} each`);
    else facts.push(`Most votes: ${ballot.leaders[0]} (${ballot.topVotes}), ahead by ${plural(ballot.margin, 'vote')}`);
  }
  if (ballot.afterlifeBrokeTie) facts.push('The Afterlife broke a tie');
  facts.push(ballot.votedOut.length ? `Voted out: ${ballot.votedOut.join(' and ')}` : 'No one was voted out');
  return facts;
}

export default function VillageStats({ endpoint, refreshKey, pacing = null, sample, showHeader = true }: VillageStatsProps) {
  const [stats, setStats] = useState<GameStats | null>(sample ?? null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  // A ballot id or 'ALL'. Until someone chooses, the newest ballot is shown.
  const [picked, setPicked] = useState<string | null>(null);
  const etag = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const pacingRef = useRef(pacing);
  const finishedRef = useRef(false);
  const filterRow = useRef<HTMLDivElement>(null);
  const lastRefreshKey = useRef(refreshKey);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const response = await conditionalGet(endpoint, etag.current);
      if (sequence !== requestSequence.current) return;
      // null: nothing changed since the numbers on screen, so nothing re-renders.
      if (!response) {
        setCheckedAt(Date.now());
        return;
      }
      if (response.status === 401) {
        etag.current = null;
        setError('Your session has ended. Sign in again to see the stats.');
        return;
      }
      const body = await response.json() as { stats?: GameStats; error?: string };
      if (sequence !== requestSequence.current) return;
      if (!response.ok || !body.stats) throw new Error(body.error ?? 'Unable to load the stats.');
      etag.current = responseEtag(response);
      setStats(body.stats);
      setError('');
      setCheckedAt(Date.now());
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : 'Unable to load the stats.');
    }
  }, [endpoint]);

  useEffect(() => {
    pacingRef.current = pacing;
    finishedRef.current = stats ? FINISHED_GAME_STATUSES.has(stats.gameStatus) : false;
  }, [pacing, stats]);

  useEffect(() => {
    if (sample) return;
    const first = window.setTimeout(() => void load(), 0);
    const stopPolling = pollWhileVisible(() => void load(), () => pollInterval(pacingRef.current), {
      idleAfterMs: IDLE_AFTER_MS,
      onIdleChange: setPaused,
      stopWhen: () => finishedRef.current,
    });
    return () => {
      window.clearTimeout(first);
      stopPolling();
    };
  }, [sample, load]);

  // A published result is the moment the numbers change most, so refresh as soon as the page learns of one.
  useEffect(() => {
    if (sample || lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [sample, refreshKey, load]);

  const ballots = stats?.ballots ?? [];
  const newest = ballots.at(-1);
  const chosen: 'ALL' | BallotStats | null = picked === 'ALL' ? 'ALL' : ballots.find((ballot) => ballot.phaseId === picked) ?? newest ?? null;
  const chosenKey = chosen === 'ALL' ? 'ALL' : chosen?.phaseId ?? '';

  // Keep the chosen day button in view when the row scrolls sideways.
  useEffect(() => {
    const row = filterRow.current;
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2);
  }, [chosenKey, ballots.length]);

  if (!stats) {
    return (
      <div className="village-stats">
        {error
          ? <p className="notice warning" role="alert">{error} <button className="text-button" type="button" onClick={() => void load()}>Try again</button></p>
          : <p className="vs-loading" role="status">Gathering the numbers…</p>}
      </div>
    );
  }

  const { summary } = stats;
  const mostVoted = stats.mostVoted;
  const busiestDay = Math.max(1, ...ballots.map((ballot) => ballot.topVotes));
  const voteRows = chosen === 'ALL'
    ? stats.votesReceived.map((entry) => ({ id: entry.playerId, label: entry.displayName, value: entry.count, emphasised: entry.count === stats.mostVoted?.votes }))
    : chosen
      ? chosen.votesReceived.map((entry) => ({ id: entry.playerId, label: entry.displayName, value: entry.count, emphasised: entry.count === chosen.topVotes }))
      : [];
  const storyPoints: StepPoint[] = [
    { key: 'start', label: 'Start', axis: 'Start', living: stats.story.start.living, werewolves: stats.story.start.werewolves, detail: '' },
    ...stats.story.steps.map((step) => ({
      key: step.phaseId,
      label: step.label,
      axis: step.kind === 'FINAL_BALLOT' ? 'F' : `${step.kind === 'DAY' ? 'D' : 'N'}${Math.ceil(step.sequence / 2)}`,
      living: step.living,
      werewolves: step.werewolves,
      detail: describeStep(step.eliminations),
    })),
  ];
  const dayColumns: ColumnDatum[] = stats.chat.perDay.map((day) => ({ key: day.date, label: formatDate(day.date, true), axis: formatDate(day.date, false), value: day.count }));
  const hourColumns: ColumnDatum[] = stats.chat.perHour.map((count, hour) => ({ key: String(hour), label: hourLabel(hour, true), axis: hourLabel(hour, false), value: count }));
  const hasTownHallChat = stats.chat.perDay.some((day) => day.count > 0);
  const eliminatedSteps = stats.story.steps.filter((step) => step.eliminations.length > 0);

  return (
    <div className="village-stats">
      {showHeader && (
        <div className="welcome-row vs-header">
          <div>
            <p className="eyebrow accent">Village stats</p>
            <h1 id="village-stats-title">How the village is playing</h1>
            <p>Built from the results the moderator has published and from chat activity. Only public information is shown here. The message total counts every room, including private ones, but never what was said.</p>
          </div>
        </div>
      )}
      <p className="vs-status" role="status">
        {paused && !FINISHED_GAME_STATUSES.has(stats.gameStatus)
          ? 'Updates are paused while you’re away. Tap anywhere to catch up.'
          : checkedAt ? <>Updated <span suppressHydrationWarning>{new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>{FINISHED_GAME_STATUSES.has(stats.gameStatus) ? ' · the game is over' : ''}</> : ''}
        {error && <span className="vs-error"> Couldn’t refresh just now ({error}) <button className="text-button" type="button" onClick={() => void load()}>Try again</button></span>}
      </p>

      <dl className="vs-tiles">
        <div className="wide"><dt>Most voted</dt><dd className="name">{mostVoted ? mostVoted.players.map((player) => player.displayName).join(' and ') : 'No votes yet'}</dd><small>{mostVoted ? `${plural(mostVoted.votes, 'vote')} across all days${mostVoted.players.length > 1 ? ' each' : ''}` : 'Fills in after the first Day result'}</small></div>
        <div><dt>Players alive</dt><dd>{summary.living}<span> of {summary.players}</span></dd><small>{plural(summary.eliminated, 'player')} eliminated</small></div>
        <div><dt>Ballots held</dt><dd>{summary.ballots}</dd><small>{plural(summary.votesCast, 'vote')} cast</small></div>
        <div><dt>Chat messages</dt><dd>{summary.chatMessages.toLocaleString()}</dd><small>in every room</small></div>
      </dl>

      <Section id="vs-votes" eyebrow="Ballots" title="Who got the votes" intro="One bar per player, counting the votes they received. Choose a day, or all days together.">
        {ballots.length === 0
          ? <p className="empty-note">No results are published yet. The first Day’s votes appear here once the moderator publishes it.</p>
          : <>
              <div className="vs-filter" role="group" aria-label="Choose a day" ref={filterRow}>
                <button type="button" aria-pressed={chosen === 'ALL'} onClick={() => setPicked('ALL')}>All days</button>
                {ballots.map((ballot) => <button key={ballot.phaseId} type="button" aria-pressed={chosen !== 'ALL' && chosen?.phaseId === ballot.phaseId} onClick={() => setPicked(ballot.phaseId)}>{ballot.label}</button>)}
              </div>
              {chosen === 'ALL'
                ? <p className="vs-summary"><strong>All days</strong> · {plural(summary.ballots, 'ballot')}, {plural(summary.votesCast, 'vote')} cast</p>
                : chosen && <>
                    <p className="vs-summary"><strong>{chosen.label}</strong> · {chosen.voters} of {chosen.living} players voted</p>
                    <ul className="vs-chips">{ballotFacts(chosen).map((fact) => <li key={fact}>{fact}</li>)}</ul>
                  </>}
              {voteRows.length
                ? <BarList rows={voteRows} max={chosen === 'ALL' ? (mostVoted?.votes ?? 1) : busiestDay} noun="vote" label={chosen === 'ALL' ? 'Votes received, all days' : `Votes received, ${chosen?.label ?? ''}`} />
                : <p className="empty-note">Nobody voted in this ballot.</p>}
              <DataTable caption="Votes received" head={['Player', 'Votes']} rows={voteRows.map((row) => [row.label, row.value])} />
            </>}
      </Section>

      <Section id="vs-turnout" eyebrow="Ballots" title="Turnout and close calls" intro="How many of the living players voted each day, and how tight the top of the vote was.">
        {ballots.length === 0
          ? <p className="empty-note">Nothing to compare yet.</p>
          : <ol className="vs-turnout">
              {[...ballots].reverse().map((ballot) => (
                <li key={ballot.phaseId}>
                  <div className="vs-turnout-head"><strong>{ballot.label}</strong><span>{ballot.voters} of {ballot.living} voted</span></div>
                  <span className="vs-bar-track" role="img" aria-label={`${ballot.voters} of ${ballot.living} players voted`}><span className="vs-bar" style={{ width: `${ballot.living ? Math.min(100, Math.max(1.5, (ballot.voters / ballot.living) * 100)) : 0}%` }} /></span>
                  <ul className="vs-chips">{ballotFacts(ballot).map((fact) => <li key={fact}>{fact}</li>)}</ul>
                </li>
              ))}
            </ol>}
      </Section>

      <Section id="vs-story" eyebrow="The campaign" title="The game so far" intro="Players alive and werewolves left after each published result. A werewolf counts as gone once their role is revealed.">
        {stats.story.steps.length === 0
          ? <p className="empty-note">The story starts when the first result is published.</p>
          : <>
              <StepChart points={storyPoints} title="Players alive and werewolves left after each phase" />
              {eliminatedSteps.length > 0 && (
                <ol className="vs-ledger" aria-label="Who has left the village">
                  {[...eliminatedSteps].reverse().map((step) => (
                    <li key={step.phaseId}>
                      <strong>{step.label}</strong>
                      <ul>{step.eliminations.map((item) => <li key={`${step.phaseId}-${item.displayName}`}><span>{item.displayName}</span><small>{readableRole(item.role)}{eliminationCause(item.cause) ? ` · ${eliminationCause(item.cause)}` : ''}</small></li>)}</ul>
                    </li>
                  ))}
                </ol>
              )}
            </>}
      </Section>

      <Section id="vs-chat" eyebrow="The conversation" title="Chat rhythm" intro={<>The total above counts every room. The charts below show the Town Hall only, in the game’s time zone ({stats.timezone.replaceAll('_', ' ')}).</>}>
        {!hasTownHallChat
          ? <p className="empty-note">No one has posted in the Town Hall yet.</p>
          : <>
              <ColumnChart data={dayColumns} title="Town Hall messages per day" noun="message" tableHead="Day" />
              <ColumnChart data={hourColumns} title="Town Hall messages by hour of the day" noun="message" tableHead="Hour" />
              <figure className="vs-chart">
                <figcaption className="vs-chart-title">Chattiest players in the Town Hall</figcaption>
                <BarList rows={stats.chat.topChatters.map((chatter, index) => ({ id: chatter.playerId, label: chatter.displayName, value: chatter.count, emphasised: index === 0 }))} max={stats.chat.topChatters[0]?.count ?? 1} noun="message" label="Town Hall messages by player" />
                <DataTable caption="Town Hall messages by player" head={['Player', 'Messages']} rows={stats.chat.topChatters.map((chatter) => [chatter.displayName, chatter.count])} />
              </figure>
            </>}
      </Section>

      <Section id="vs-matrix" eyebrow="Ballots" title="Who voted for whom" intro="Each row is a voter. Each column is a player who received votes. The number is how many times that voter chose them across every published Day.">
        {stats.voteMatrix.cells.length === 0
          ? <p className="empty-note">No published votes yet.</p>
          : <VoteMatrix matrix={stats.voteMatrix} />}
      </Section>
    </div>
  );
}
