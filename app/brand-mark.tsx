/**
 * The Watercooler Werewolf emblem: a cut-paper werewolf stick puppet held up
 * against a paper moon. Each layer sits on a darker offset copy of itself so
 * it reads as card stock at a distance. public/favicon.svg carries the same art.
 */
export default function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <circle cx="32" cy="32" r="30" fill="#2a1d33" stroke="#e3b04b" strokeWidth="2.5" />
        <circle cx="44" cy="19" r="9" fill="#ffd57c" />
        <path d="M32 50V63" stroke="#7a4f2c" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M15 13L25 25H39L49 13L47 29L51 38L42 40L36 50L32 52L28 50L22 40L13 38L17 29Z" fill="#120b16" opacity=".5" transform="translate(1.4 1.8)" />
        <path d="M15 13L25 25H39L49 13L47 29L51 38L42 40L36 50L32 52L28 50L22 40L13 38L17 29Z" fill="#766f86" stroke="#fff6de" strokeOpacity=".45" strokeWidth=".7" strokeLinejoin="round" />
        <path d="M18.5 18L24.5 25.5L20.5 28Z M45.5 18L39.5 25.5L43.5 28Z" fill="#8e3b5c" />
        <path d="M28 25H36L32 33Z" fill="#9a93a8" />
        <path d="M26 36L32 34L38 36L36.5 45.5L32 49.5L27.5 45.5Z" fill="#f3e6c6" stroke="#fff6de" strokeOpacity=".6" strokeWidth=".5" />
        <path d="M29.3 41.5H34.7L32 44.6Z" fill="#2b2118" />
        <path d="M22.5 30.5L29 32.6L25.6 34.6Z M41.5 30.5L35 32.6L38.4 34.6Z" fill="#ffd84a" />
        <path d="M21.5 28.8L29.5 31.4 M42.5 28.8L34.5 31.4" stroke="#1d1424" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
