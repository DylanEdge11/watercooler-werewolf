import { circ, makeCutter, type Pt } from './cut';

/* Cut-card objects that hang from the fly loft on strings. */

const F = makeCutter(777);

function starPts(r1: number, r2: number, n: number, rot = -Math.PI / 2): Pt[] {
  const p: Pt[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    p.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return p;
}

const SUN = {
  rays: F.cut(starPts(48, 33, 14), 0.6, 4),
  rays2: F.cut(starPts(40, 28, 14, -Math.PI / 2 + Math.PI / 14), 0.5, 4),
  disc: F.cut(circ(0, 0, 28, 26), 0.6, 4),
};

export function Sun() {
  return (
    <svg viewBox="-52 -52 104 104" aria-hidden="true" focusable="false">
      <g className="th-spin">
        <path d={SUN.rays} fill="#e9a84a" />
        <path d={SUN.rays2} fill="#f3c566" />
      </g>
      <path d={SUN.disc} fill="#f7d77e" />
      <path d="M-13 -3 q4 -4 8 0 M5 -3 q4 -4 8 0" stroke="#8a5a22" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M-9 9 q9 8 18 0" stroke="#8a5a22" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="-15" cy="6" r="4" fill="#f0a36a" opacity="0.7" />
      <circle cx="15" cy="6" r="4" fill="#f0a36a" opacity="0.7" />
    </svg>
  );
}

const MOON = {
  disc: F.cut(circ(0, 0, 34, 30), 0.6, 4),
  craters: [circ(-12, -10, 7, 10), circ(10, 8, 9, 12), circ(-6, 16, 5, 9), circ(16, -14, 4, 8), circ(-20, 6, 3.4, 7)].map((p) => F.cut(p, 0.4, 3)),
};

export function Moon() {
  return (
    <svg viewBox="-52 -52 104 104" aria-hidden="true" focusable="false">
      <circle r="46" fill="url(#theatre-moon-halo)" />
      <path d={MOON.disc} fill="#f4ecd2" />
      {MOON.craters.map((d, i) => <path key={i} d={d} fill="#d9cfae" />)}
      <path d="M-26 -6 a28 28 0 0 0 30 32" stroke="#c9bd98" strokeWidth="1.2" fill="none" opacity="0.5" />
    </svg>
  );
}

const CLOUDS = [
  [circ(-24, 6, 16, 16), circ(0, -6, 22, 20), circ(24, 4, 17, 16), circ(4, 10, 20, 18)],
  [circ(-18, 4, 13, 14), circ(4, -4, 18, 18), circ(22, 6, 12, 12)],
].map((set) => ({
  back: set.map((p) => F.cut(p.map(([x, y]) => [x + 2, y + 4] as Pt), 0.7, 4)).join(''),
  front: set.map((p) => F.cut(p, 0.7, 4)).join(''),
}));

export function Cloud({ variant = 0 }: { variant?: 0 | 1 }) {
  const c = CLOUDS[variant];
  return (
    <svg viewBox="-46 -32 92 60" aria-hidden="true" focusable="false">
      <path d={c.back} className="tf-cloudb" />
      <path d={c.front} className="tf-cloud" />
    </svg>
  );
}

const STAR = F.cut(starPts(14, 6, 5), 0.3, 3);
export function Star() {
  return (
    <svg viewBox="-16 -16 32 32" aria-hidden="true" focusable="false">
      <g filter="url(#pc-glow)"><path d={STAR} fill="#ffe7a0" /></g>
    </svg>
  );
}

const BAT = F.cut([
  [0, -4], [4, -9], [6, -3], [14, -8], [26, -12], [22, -4], [30, 2], [20, 2], [14, 8], [8, 3], [0, 7],
  [-8, 3], [-14, 8], [-20, 2], [-30, 2], [-22, -4], [-26, -12], [-14, -8], [-6, -3], [-4, -9],
], 0.3, 3);
export function Bat() {
  return (
    <svg viewBox="-32 -16 64 30" aria-hidden="true" focusable="false">
      <g className="th-flap"><path d={BAT} fill="#141537" /></g>
      <circle cx="-2" cy="-1" r="1.1" fill="#ffd84a" />
      <circle cx="2" cy="-1" r="1.1" fill="#ffd84a" />
    </svg>
  );
}
