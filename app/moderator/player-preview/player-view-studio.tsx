'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ROLE_CATALOG } from '../../../lib/game/catalog';
import { ROLE_KEYS, type RoleKey } from '../../../lib/game/types';
import PlayerDashboard from '../../player-dashboard';
import BrandMark from '../../brand-mark';
import { createPreviewData, PREVIEW_SCENARIOS, type PreviewScenarioId } from './scenarios';

export default function PlayerViewStudio() {
  const [role, setRole] = useState<RoleKey>('SEER');
  const [scenario, setScenario] = useState<PreviewScenarioId>('night-action');
  const previewData = useMemo(() => createPreviewData(role, scenario), [role, scenario]);

  function scrollToControls() {
    document.getElementById('player-preview-controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="setup-shell player-preview-studio">
      <header className="setup-header">
        <Link className="brand" href="/moderator" aria-label="Back to moderator console">
          <BrandMark />
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </Link>
        <span className="mode-chip">Player View Studio</span>
      </header>

      <section className="preview-controls setup-card" id="player-preview-controls" aria-labelledby="preview-studio-title">
        <div className="preview-controls-heading">
          <div>
            <p className="eyebrow accent">Moderator tools</p>
            <h1 id="preview-studio-title">Stage a player view</h1>
            <p>Choose any role and game moment to inspect the player interface with synthetic sample data.</p>
          </div>
          <Link className="secondary-link" href="/moderator">Back to moderator console</Link>
        </div>
        <div className="preview-select-grid">
          <label htmlFor="preview-role">Player role
            <select id="preview-role" value={role} onChange={(event) => setRole(event.target.value as RoleKey)}>
              {ROLE_KEYS.map((roleKey) => <option key={roleKey} value={roleKey}>{ROLE_CATALOG[roleKey].name}</option>)}
            </select>
          </label>
          <label htmlFor="preview-scenario">Game moment
            <select id="preview-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as PreviewScenarioId)}>
              {PREVIEW_SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <p className="preview-safety-note"><strong>Preview only.</strong> The player, game, roles, ballots, messages, and feedback are synthetic. Interactions remain local and do not call game APIs.</p>
      </section>

      <PlayerDashboard
        key={`${role}-${scenario}`}
        previewData={previewData}
        previewMode
        onExitPreview={scrollToControls}
      />
    </div>
  );
}
