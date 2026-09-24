'use client';

import { useEffect, useState } from 'react';
import { landingFontVariables } from './fonts';
import PaperFilters from './paper-filters';
import TheatreScene from './scenes/theatre';
import './landing.css';

/**
 * Paper-craft landing page: the toy theatre plus the day/night switch (also
 * on the N key). The theatre draws the scene and places the sign-in ticket.
 */
export default function LandingShell() {
  const [night, setNight] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'n' || event.key === 'N') setNight((value) => !value);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className={`ll-root ${landingFontVariables}`} data-night={night}>
      <PaperFilters />
      <TheatreScene night={night} />

      <nav className="ll-controls" aria-label="Day and night">
        <button
          type="button"
          className="ll-chip ll-night-toggle"
          role="switch"
          aria-checked={night}
          onClick={() => setNight((value) => !value)}
        >
          <span className="ll-toggle-track" aria-hidden="true"><span className="ll-toggle-knob" /></span>
          <span>{night ? 'Night' : 'Day'}</span>
        </button>
      </nav>
    </main>
  );
}
