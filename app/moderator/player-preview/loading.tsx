import Link from 'next/link';
import BrandMark from '../../brand-mark';

/** Sent at once while the server checks the moderator session. */
export default function Loading() {
  return (
    <main className="setup-shell backstage" aria-busy="true">
      <header className="setup-header">
        <Link className="brand" href="/" aria-label="Watercooler Werewolf home">
          <BrandMark />
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </Link>
        <span className="mode-chip">Moderator console</span>
      </header>
      <p className="setup-loading">Opening the Player View Studio…</p>
    </main>
  );
}
