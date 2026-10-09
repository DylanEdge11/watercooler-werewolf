/* eslint-disable @next/next/no-html-link-for-pages -- the home link intentionally uses a full-page navigation. */

import BrandMark from '../brand-mark';

/** The header on the moderator console's sign-in and setup pages. */
export default function BrandHeader() {
  return (
    <header className="setup-header">
      <a className="brand" href="/" aria-label="Watercooler Werewolf home">
        <BrandMark />
        <span><strong>Watercooler</strong><small>Werewolf</small></span>
      </a>
      <span className="mode-chip">Moderator console</span>
    </header>
  );
}
