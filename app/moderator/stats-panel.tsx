'use client';

import { useState } from 'react';
import VillageStats from '../village-stats';

/**
 * The same Village stats players see, for a running game. They load only while the panel is open, so a
 * moderator who never looks costs the database nothing, and they refresh after the moderator's own changes.
 */
export default function StatsPanel({ gameId, refreshToken }: { gameId: string; refreshToken: number }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="setup-card" id="village-stats" aria-labelledby="console-village-stats-title">
      <div className="setup-card-heading">
        <span aria-hidden="true">▥</span>
        <div>
          <h2 id="console-village-stats-title">Village stats</h2>
          <p>Votes per day, turnout, who has left, and chat activity: the same numbers players see. Only public information is included. The message total counts every room, including private ones, but never what was said.</p>
        </div>
      </div>
      <details className="stats-panel-toggle" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{open ? 'Hide the stats' : 'Show the stats'}</summary>
        {open && <VillageStats endpoint={`/api/games/${gameId}/stats`} refreshKey={String(refreshToken)} showHeader={false} />}
      </details>
    </section>
  );
}
