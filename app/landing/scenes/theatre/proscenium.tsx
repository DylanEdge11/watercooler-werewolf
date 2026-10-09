import { HOUSE_NAME } from './branding';
import { box, circ, makeCutter, type Pt } from './cut';

/*
 * The cut-card proscenium arch, drawn in a 1000 x 800 box. The stage opening
 * is x 150..850, y 180..640 (the `.box` rule in theatre.module.css). Every piece is its own
 * card cut with a jittered edge and a shadow (`theatre-sh`) so the gold sits
 * on the cream which sits on the red, like a real Pollock's sheet.
 */

const C = makeCutter(1811);

const OPENING: Pt[] = [
  [150, 640], [150, 262], [156, 238], [174, 224], [200, 218], [400, 207], [440, 197], [470, 191], [500, 189],
  [530, 191], [560, 197], [600, 207], [800, 218], [826, 224], [844, 238], [850, 262], [850, 640],
];

const FRAME_OUTER: Pt[] = [
  [36, 796], [36, 700], [58, 700], [58, 240], [40, 240], [40, 126], [296, 126], [318, 110], [352, 100],
  [382, 80], [408, 56], [438, 38], [470, 27], [500, 23], [530, 27], [562, 38], [592, 56], [618, 80],
  [648, 100], [682, 110], [704, 126], [960, 126], [960, 240], [942, 240], [942, 700], [964, 700], [964, 796],
];

const frame = C.cut(FRAME_OUTER, 1.1, 9) + C.hole(OPENING, 0.8, 9);
const rimPath = `M${OPENING.map((p) => p.join(' ')).join(' L')}`;

function pillar(x: number) {
  return {
    gold: C.cut(box(x + 10, 254, 80, 350), 0.8, 8),
    red: C.cut(box(x + 17, 262, 66, 334), 0.8, 8),
    flutes: [0, 1, 2].map((k) => C.cut(box(x + 30 + k * 16, 300, 7, 258), 0.4, 7)),
    cap: C.cut([[x - 4, 250], [x + 104, 250], [x + 96, 226], [x + 86, 218], [x + 14, 218], [x + 4, 226]], 0.7, 6),
    capBand: C.cut(box(x + 8, 206, 84, 14), 0.5, 6),
    voluteL: C.cut(circ(x + 6, 236, 12, 14), 0.6, 4),
    voluteR: C.cut(circ(x + 94, 236, 12, 14), 0.6, 4),
    voluteLi: C.cut(circ(x + 6, 236, 5, 9), 0.4, 3),
    voluteRi: C.cut(circ(x + 94, 236, 5, 9), 0.4, 3),
    base: C.cut([[x - 6, 640], [x + 106, 640], [x + 100, 618], [x + 92, 604], [x + 8, 604], [x, 618]], 0.7, 6),
    rosette: C.cut(circ(x + 50, 280, 11, 12), 0.5, 4),
    rosetteI: C.cut(circ(x + 50, 280, 4.5, 8), 0.3, 3),
    lyre: C.cut([[x + 50, 560], [x + 62, 540], [x + 58, 520], [x + 50, 530], [x + 42, 520], [x + 38, 540]], 0.5, 4),
  };
}
const PILLARS = [pillar(50), pillar(850)];

const frieze = {
  gold: C.cut(box(96, 138, 808, 54), 0.9, 9),
  red: C.cut(box(104, 145, 792, 40), 0.9, 9),
};

// Ribbon banner under the crest.
const ribbon = {
  tailL: C.cut([[318, 150], [362, 146], [362, 186], [318, 190], [332, 170]], 0.6, 5),
  tailR: C.cut([[682, 150], [638, 146], [638, 186], [682, 190], [668, 170]], 0.6, 5),
  body: C.cut([[346, 142], [500, 136], [654, 142], [654, 182], [500, 176], [346, 182]], 0.7, 7),
};

// Crest: a gold cartouche with a red shield and a cream wolf head.
const crest = {
  back: C.cut([
    [500, 30], [528, 38], [548, 56], [556, 82], [572, 92], [566, 108], [552, 110], [548, 132], [528, 146],
    [500, 152], [472, 146], [452, 132], [448, 110], [434, 108], [428, 92], [444, 82], [452, 56], [472, 38],
  ], 0.8, 6),
  shield: C.cut([[472, 60], [528, 60], [530, 104], [516, 126], [500, 134], [484, 126], [470, 104]], 0.6, 5),
  wolf: C.cut([
    [480, 70], [488, 84], [500, 80], [512, 84], [520, 70], [522, 94], [514, 108], [506, 118], [500, 121],
    [494, 118], [486, 108], [478, 94],
  ], 0.4, 3),
  crown: C.cut([[478, 34], [484, 18], [492, 28], [500, 12], [508, 28], [516, 18], [522, 34]], 0.5, 4),
};

function scroll(cx: number, cy: number, r: number, turns: number, dir: 1 | -1): string {
  let d = '';
  const n = 44;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const a = dir * t * turns * Math.PI * 2;
    const rad = r * (1 - t * 0.8);
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}
const SCROLLS = [
  scroll(398, 104, 22, 1.2, -1), scroll(602, 104, 22, 1.2, 1),
  scroll(342, 118, 12, 1, -1), scroll(658, 118, 12, 1, 1),
  scroll(214, 222, 13, 1, 1), scroll(786, 222, 13, 1, -1),
];

const leaves = [
  C.cut([[420, 120], [404, 96], [412, 76], [428, 70], [424, 92], [436, 110]], 0.5, 4),
  C.cut([[580, 120], [596, 96], [588, 76], [572, 70], [576, 92], [564, 110]], 0.5, 4),
];

// Comedy (left) and tragedy (right) masks.
function mask(cx: number, sad: boolean) {
  const f = sad ? -1 : 1;
  return {
    ribbon: C.cut([[cx - 30, 170], [cx - 52, 196], [cx - 44, 204], [cx - 22, 180]], 0.5, 4) +
      C.cut([[cx + 30, 170], [cx + 52, 196], [cx + 44, 204], [cx + 22, 180]], 0.5, 4),
    face: C.cut([
      [cx - 34, 128], [cx - 18, 118], [cx, 115], [cx + 18, 118], [cx + 34, 128], [cx + 36, 150],
      [cx + 30, 172], [cx + 16, 190], [cx, 196], [cx - 16, 190], [cx - 30, 172], [cx - 36, 150],
    ], 0.6, 5),
    eyeL: C.cut(sad
      ? [[cx - 24, 146], [cx - 8, 138], [cx - 8, 150], [cx - 20, 154]]
      : [[cx - 24, 150], [cx - 16, 138], [cx - 6, 146], [cx - 16, 152]], 0.3, 3),
    eyeR: C.cut(sad
      ? [[cx + 24, 146], [cx + 8, 138], [cx + 8, 150], [cx + 20, 154]]
      : [[cx + 24, 150], [cx + 16, 138], [cx + 6, 146], [cx + 16, 152]], 0.3, 3),
    mouth: C.cut(f > 0
      ? [[cx - 20, 166], [cx, 172], [cx + 20, 166], [cx + 12, 182], [cx, 186], [cx - 12, 182]]
      : [[cx - 18, 182], [cx - 10, 170], [cx, 167], [cx + 10, 170], [cx + 18, 182], [cx, 176]], 0.3, 3),
    cheek: sad ? '' : C.cut(circ(cx - 22, 162, 5, 8), 0.2, 3) + C.cut(circ(cx + 22, 162, 5, 8), 0.2, 3),
  };
}
const MASKS = [mask(248, false), mask(752, true)];

// Stage lip and skirt.
const lip = C.cut(box(58, 634, 884, 18), 0.6, 9);
const apron = C.cut(box(58, 650, 884, 50), 0.8, 9);
const apronGold = C.cut(box(74, 658, 852, 34), 0.7, 9);
const apronRed = C.cut(box(80, 663, 840, 24), 0.7, 9);
const skirtRed = C.cut(box(52, 712, 896, 76), 0.9, 9);
const SWAGS = Array.from({ length: 8 }, (_, i) => {
  const x = 60 + i * 110;
  const pts: Pt[] = [];
  for (let k = 0; k <= 12; k += 1) {
    const t = k / 12;
    pts.push([x + t * 110, 716 + Math.sin(t * Math.PI) * 30]);
  }
  for (let k = 12; k >= 0; k -= 1) {
    const t = k / 12;
    pts.push([x + t * 110, 716 + Math.sin(t * Math.PI) * 20]);
  }
  return C.cut(pts, 0.5, 6);
});
const SWAG_KNOTS = Array.from({ length: 9 }, (_, i) => C.cut(circ(60 + i * 110, 718, 7, 9), 0.4, 3));

// Long house names squeeze to fit the ribbon instead of overflowing it.
const RIBBON = HOUSE_NAME.toUpperCase();
const RIBBON_FIT = RIBBON.length * 11.5 > 280 ? { textLength: 280, lengthAdjust: 'spacingAndGlyphs' as const } : {};

export default function Proscenium() {
  return (
    <svg className="th-svg" viewBox="0 0 1000 800" aria-hidden="true" focusable="false">
      <g filter="url(#theatre-sh)">
        <path className="tf-cream" d={frame} fillRule="evenodd" />
      </g>
      {/* gold rim around the opening with a beaded edge */}
      <path d={rimPath} fill="none" className="ts-gold" strokeWidth="18" strokeLinejoin="round" />
      <path d={rimPath} fill="none" className="ts-goldd" strokeWidth="3" strokeLinejoin="round" transform="translate(0 -9)" opacity="0.5" />
      <path d={rimPath} fill="none" className="ts-cream" strokeWidth="4.5" strokeLinecap="round" strokeDasharray="0 11" />

      <g filter="url(#theatre-sh)">
        <path className="tf-gold" d={frieze.gold} />
      </g>
      <g filter="url(#theatre-sh)">
        <path className="tf-red" d={frieze.red} />
      </g>
      <path d="M112 165 H888" className="ts-gold" strokeWidth="1.6" strokeDasharray="2 7" strokeLinecap="round" fill="none" />

      {PILLARS.map((p, i) => (
        <g key={i}>
          <g filter="url(#theatre-sh)"><path className="tf-gold" d={p.gold} /></g>
          <g filter="url(#theatre-sh)"><path className="tf-red" d={p.red} /></g>
          <g filter="url(#theatre-sh)">
            {p.flutes.map((d, k) => <path key={k} className="tf-redd" d={d} />)}
          </g>
          <g filter="url(#theatre-sh)">
            <path className="tf-gold" d={p.capBand} />
            <path className="tf-gold" d={p.cap} />
            <path className="tf-goldd" d={p.voluteL} />
            <path className="tf-goldd" d={p.voluteR} />
            <path className="tf-cream" d={p.voluteLi} />
            <path className="tf-cream" d={p.voluteRi} />
            <path className="tf-gold" d={p.base} />
            <path className="tf-gold" d={p.rosette} />
            <path className="tf-red" d={p.rosetteI} />
            <path className="tf-gold" d={p.lyre} />
          </g>
        </g>
      ))}

      <g className="ts-gold" fill="none" strokeWidth="5" strokeLinecap="round" filter="url(#theatre-sh)">
        {SCROLLS.map((d, i) => <path key={i} d={d} />)}
      </g>
      <g filter="url(#theatre-sh)">
        {leaves.map((d, i) => <path key={i} className="tf-gold" d={d} />)}
      </g>

      {/* crest */}
      <g filter="url(#theatre-sh)"><path className="tf-gold" d={crest.back} /></g>
      <g filter="url(#theatre-sh)">
        <path className="tf-gold" d={crest.crown} />
        <path className="tf-red" d={crest.shield} />
      </g>
      <g filter="url(#theatre-sh)">
        <path className="tf-cream" d={crest.wolf} />
        <circle cx="494" cy="97" r="2.2" className="tf-red" />
        <circle cx="506" cy="97" r="2.2" className="tf-red" />
      </g>

      {/* ribbon */}
      <g filter="url(#theatre-sh)">
        <path className="tf-redd" d={ribbon.tailL} />
        <path className="tf-redd" d={ribbon.tailR} />
      </g>
      <g filter="url(#theatre-sh)"><path className="tf-cream" d={ribbon.body} /></g>
      <text x="500" y="166" textAnchor="middle" className="th-ribbon-text" {...RIBBON_FIT}>{RIBBON}</text>

      {/* masks */}
      {MASKS.map((m, i) => (
        <g key={i}>
          <g filter="url(#theatre-sh)"><path className="tf-red" d={m.ribbon} /></g>
          <g filter="url(#theatre-sh)"><path className="tf-cream2" d={m.face} /></g>
          <path className="tf-ink" d={m.eyeL + m.eyeR + m.mouth} />
          {m.cheek && <path className="tf-rose" d={m.cheek} />}
        </g>
      ))}

      {/* stage lip, apron and skirt */}
      <g filter="url(#theatre-sh)"><path className="tf-wood" d={lip} /></g>
      <g filter="url(#theatre-sh)"><path className="tf-cream" d={apron} /></g>
      <g filter="url(#theatre-sh)"><path className="tf-gold" d={apronGold} /></g>
      <g filter="url(#theatre-sh)"><path className="tf-redd" d={apronRed} /></g>
      <g filter="url(#theatre-sh)"><path className="tf-red" d={skirtRed} /></g>
      <g filter="url(#theatre-sh)">
        {SWAGS.map((d, i) => <path key={i} className="tf-gold" d={d} />)}
        {SWAG_KNOTS.map((d, i) => <path key={i} className="tf-goldd" d={d} />)}
      </g>
    </svg>
  );
}

const LAMPS = Array.from({ length: 13 }, (_, i) => 190 + i * 51.6);
const HOODS = LAMPS.map((x) => C.cut([[x - 17, 652], [x + 17, 652], [x + 13, 638], [x + 6, 632], [x - 6, 632], [x - 13, 638]], 0.4, 4));

/** Footlights sit on their own sheet so the night dimming never dulls them. */
export function Footlights() {
  return (
    <svg className="th-svg" viewBox="0 0 1000 800" aria-hidden="true" focusable="false">
      <g className="th-bulbs" filter="url(#pc-glow)">
        {LAMPS.map((x) => <ellipse key={x} cx={x} cy="632" rx="7" ry="6" className="tf-bulb" />)}
      </g>
      <g filter="url(#theatre-sh)">
        {HOODS.map((d, i) => <path key={i} className="tf-goldd" d={d} />)}
      </g>
    </svg>
  );
}
