import BrandMark from '../brand-mark';

/** The dashboard's frame, shown while the server loads the game, so the content fills in without moving. */
export default function Loading() {
  return (
    <main className="app-shell" data-stage-light="day" aria-busy="true">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Watercooler Werewolf home">
          <BrandMark />
          <span><strong>Watercooler</strong><small>Werewolf</small></span>
        </a>
      </header>
      <div className="workspace" id="top">
        <aside className="sidebar" aria-label="Game navigation"><p className="eyebrow">Game room</p></aside>
        <section className="main-column">
          <div className="welcome-row"><div><p className="eyebrow accent">Opening the village…</p></div></div>
        </section>
        <aside className="right-rail">
          <section className="rail-card"><div className="rail-heading"><h2>Official timeline</h2></div></section>
        </aside>
      </div>
    </main>
  );
}
