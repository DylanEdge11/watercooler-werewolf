'use client';

import { useState } from 'react';

const candidates = [
  { id: 'maya', name: 'Maya Chen', initials: 'MC', note: 'Design' },
  { id: 'jordan', name: 'Jordan Ellis', initials: 'JE', note: 'Operations' },
  { id: 'priya', name: 'Priya Shah', initials: 'PS', note: 'Product' },
  { id: 'theo', name: 'Theo Martin', initials: 'TM', note: 'Finance' },
];

export default function Home() {
  const [selected, setSelected] = useState<string[]>(['jordan']);

  function toggleCandidate(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length === 2) return current;
      return [...current, id];
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Watercooler Werewolf home">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-moon" />
            <span className="brand-cup" />
          </span>
          <span>
            <strong>Watercooler</strong>
            <small>Werewolf</small>
          </span>
        </a>
        <div className="game-switcher">
          <span className="status-dot" aria-hidden="true" />
          October Office Game
          <span className="chevron" aria-hidden="true">⌄</span>
        </div>
        <div className="profile">
          <button className="icon-button" aria-label="Notifications">
            <span aria-hidden="true">✦</span>
            <span className="notification-dot" />
          </button>
          <div className="avatar">DR</div>
          <span className="profile-name">Dylan</span>
        </div>
      </header>

      <div className="workspace" id="top">
        <aside className="sidebar" aria-label="Game navigation">
          <p className="eyebrow">Game room</p>
          <nav>
            <a className="nav-item active" href="#today"><span>◐</span>Today</a>
            <a className="nav-item" href="#roster"><span>◎</span>Players</a>
            <a className="nav-item" href="#timeline"><span>≋</span>Timeline</a>
            <a className="nav-item" href="#pack"><span>◆</span>Pack room <b>3</b></a>
          </nav>
          <div className="sidebar-rule" />
          <p className="eyebrow">Your game</p>
          <div className="mini-stat"><span>Cycle</span><strong>06</strong></div>
          <div className="mini-stat"><span>Living</span><strong>31</strong></div>
          <div className="mini-stat"><span>Eliminated</span><strong>7</strong></div>
          <div className="sidebar-note">
            <span aria-hidden="true">☾</span>
            <p><strong>Keep it quiet.</strong>Your role is always visible after sign-in.</p>
          </div>
        </aside>

        <section className="main-column" id="today">
          <div className="welcome-row">
            <div>
              <p className="eyebrow accent">Wednesday · Cycle 6</p>
              <h1>The village is voting.</h1>
              <p>Choose up to two players before the ballot closes.</p>
            </div>
            <div className="deadline-card">
              <span>Ballot closes</span>
              <strong>2h 14m</strong>
              <small>Today at 3:00 PM CST</small>
            </div>
          </div>

          <section className="role-card" aria-label="Your secret role">
            <div className="role-orbit" aria-hidden="true"><span>☾</span></div>
            <div className="role-copy">
              <p className="eyebrow">Your secret role</p>
              <h2>Werewolf</h2>
              <p>You hunt with the pack. Blend in during the day and choose tonight&apos;s targets together.</p>
            </div>
            <div className="role-faction">
              <span>Faction</span>
              <strong>Werewolves</strong>
              <small>Win at parity</small>
            </div>
          </section>

          <section className="ballot-card" aria-labelledby="ballot-title">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Official action</p>
                <h2 id="ballot-title">Day elimination ballot</h2>
              </div>
              <span className="submission-count">24 of 31 submitted</span>
            </div>

            <div className="selection-summary" aria-live="polite">
              <span>{selected.length} of 2 selected</span>
              <div className="progress-track"><span style={{ width: `${selected.length * 50}%` }} /></div>
              <small>You can revise this ballot until the deadline.</small>
            </div>

            <div className="candidate-grid">
              {candidates.map((candidate) => {
                const isSelected = selected.includes(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    className={`candidate ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleCandidate(candidate.id)}
                    aria-pressed={isSelected}
                  >
                    <span className="candidate-avatar">{candidate.initials}</span>
                    <span><strong>{candidate.name}</strong><small>{candidate.note}</small></span>
                    <span className="check" aria-hidden="true">{isSelected ? '✓' : '+'}</span>
                  </button>
                );
              })}
            </div>

            <div className="ballot-footer">
              <p><span aria-hidden="true">●</span> Ballot choices stay secret until results are published.</p>
              <button className="primary-button">Save ballot</button>
            </div>
          </section>
        </section>

        <aside className="right-rail">
          <section className="rail-card announcement">
            <p className="eyebrow">Moderator note</p>
            <h2>Keep the debate moving</h2>
            <p>Today&apos;s ballot closes before the afternoon all-hands. Missed votes count as abstentions.</p>
            <small>Posted 36 minutes ago</small>
          </section>

          <section className="rail-card" id="roster">
            <div className="rail-heading"><h2>Living players</h2><span>31</span></div>
            <div className="player-stack">
              {candidates.slice(0, 3).map((player, index) => (
                <div className="player-row" key={player.id}>
                  <span className="candidate-avatar small">{player.initials}</span>
                  <span><strong>{player.name}</strong><small>{index === 1 ? 'Action submitted' : 'Still deciding'}</small></span>
                  <span className={index === 1 ? 'ready-dot ready' : 'ready-dot'} />
                </div>
              ))}
            </div>
            <button className="text-button">View all players <span>→</span></button>
          </section>

          <section className="rail-card moon-card">
            <div className="moon-art" aria-hidden="true"><span>☾</span></div>
            <p className="eyebrow">Next phase</p>
            <h2>Night falls after approval</h2>
            <p>The moderator will publish the ballot, then your pack room will reopen.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
