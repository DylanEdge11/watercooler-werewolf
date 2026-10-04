'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { attentionEventCount, CONSOLE_TABS, latestAttentionEventAt, type ConsoleTabId } from '../../lib/game/console-guidance';
import { useOperations } from './operations-context';

export interface TabBadge {
  /** Shown in the badge; omit for a plain dot. */
  count?: number;
  /** Read out with the tab, e.g. "A result is waiting for your review". */
  description: string;
}

export const consoleTabButtonId = (id: ConsoleTabId) => `console-tab-${id}`;
export const consolePanelId = (id: ConsoleTabId) => `console-panel-${id}`;

/**
 * The console's sections as tabs. Arrow keys, Home, and End move between them.
 * A badge marks a tab that needs the moderator even while another is open.
 */
export function ConsoleTabBar({ active, onSelect, badges }: { active: ConsoleTabId; onSelect: (id: ConsoleTabId) => void; badges: Partial<Record<ConsoleTabId, TabBadge>> }) {
  const buttons = useRef(new Map<ConsoleTabId, HTMLButtonElement>());

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = CONSOLE_TABS.length - 1;
    const target = event.key === 'ArrowRight' ? (index + 1) % CONSOLE_TABS.length
      : event.key === 'ArrowLeft' ? (index + last) % CONSOLE_TABS.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (target === null) return;
    event.preventDefault();
    const next = CONSOLE_TABS[target].id;
    onSelect(next);
    buttons.current.get(next)?.focus();
  }

  return (
    <div className="console-tabs" role="tablist" aria-label="Console sections">
      {CONSOLE_TABS.map((tab, index) => {
        const badge = badges[tab.id];
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(element) => { if (element) buttons.current.set(tab.id, element); else buttons.current.delete(tab.id); }}
            className={`console-tab${selected ? ' selected' : ''}`}
            id={consoleTabButtonId(tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={consolePanelId(tab.id)}
            aria-describedby={badge ? `${consoleTabButtonId(tab.id)}-badge` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span>{tab.label}</span>
            {badge && <span className={`tab-badge${badge.count === undefined ? ' dot' : ''}`} aria-hidden="true">{badge.count}</span>}
            {badge && <span id={`${consoleTabButtonId(tab.id)}-badge`} hidden>{badge.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One tab's content. Every panel stays mounted so a tab keeps its drafts and
 * its polling; only the open one is shown.
 */
export function ConsolePanel({ id, active, children }: { id: ConsoleTabId; active: boolean; children: ReactNode }) {
  return (
    <div className="console-panel" id={consolePanelId(id)} role="tabpanel" aria-labelledby={consoleTabButtonId(id)} hidden={!active}>
      {children}
    </div>
  );
}

/**
 * The tab bar and a line saying what the open tab is for. It flags the Run game
 * tab while a result is waiting on the moderator, and the Safety & records tab
 * while the event log holds a problem the moderator has not looked at yet, so
 * nothing urgent hides behind a tab. Opening Safety & records clears the number;
 * a problem logged after that brings it back.
 */
export function ConsoleNavigation({ active, onSelect, runAttention }: { active: ConsoleTabId; onSelect: (id: ConsoleTabId) => void; runAttention: boolean }) {
  const { operations, clearNotices } = useOperations();
  const events = operations?.events ?? [];
  const [seenThrough, setSeenThrough] = useState<string | null>(null);
  const unseenProblems = attentionEventCount(events, seenThrough);
  const badges: Partial<Record<ConsoleTabId, TabBadge>> = {};
  if (runAttention && active !== 'run') badges.run = { description: 'A result or follow-up is waiting for you' };
  if (unseenProblems > 0 && active !== 'safety') badges.safety = { count: unseenProblems, description: `${unseenProblems} new ${unseenProblems === 1 ? 'problem needs' : 'problems need'} your attention in the event log` };

  function select(id: ConsoleTabId) {
    clearNotices();
    // Arriving on the log, or leaving it, counts as having seen what it holds.
    if (active === 'safety' || id === 'safety') setSeenThrough(latestAttentionEventAt(events));
    onSelect(id);
  }

  return <>
    <ConsoleTabBar active={active} onSelect={select} badges={badges} />
    <p className="console-tab-blurb">{CONSOLE_TABS.find((tab) => tab.id === active)?.blurb}</p>
  </>;
}
