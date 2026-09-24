import { box, circ, makeCutter, pineTiers, ridge, type Pt } from './cut';

/*
 * Scenery for the stage box. Everything is drawn in the box's own
 * coordinates (700 x 460, floor line at y ~ 336). Layers use the viewBox
 * below with a 5% bleed so parallax never shows an edge.
 */

export const BLEED_VIEWBOX = '-35 -23 770 506';

const C = makeCutter(2207);
const S = makeCutter(3301);

function wave(base: number, parts: Array<[number, number, number]>) {
  return (x: number) => parts.reduce((y, [amp, len, ph]) => y + amp * Math.sin((x / len) * Math.PI * 2 + ph), base);
}

/* ---------------- day backcloth ---------------- */

const dayHillFar = C.cut(ridge(wave(272, [[3, 380, 0.4], [1.5, 140, 1.2]]), -40, 740, 360, 10), 0.6, 8);
const dayHillNear = C.cut(ridge(wave(292, [[4, 300, 2.1], [2, 110, 0.3]]), -40, 740, 360, 10), 0.6, 8);
const canola = C.cut(ridge(wave(283, [[1.5, 200, 1]]), -40, 740, 292, 10), 0.4, 8);
// A prairie grain elevator (generic, unlabelled town) with its annex.
const elevator = C.cut([[434, 300], [434, 176], [448, 160], [462, 176], [462, 300]], 0.6, 6);
const elevatorCap = C.cut([[440, 176], [440, 146], [448, 136], [456, 146], [456, 176]], 0.5, 5);
const annex = C.cut([[462, 300], [462, 226], [486, 214], [510, 226], [510, 300]], 0.6, 6);
const fields = [
  C.cut([[60, 300], [180, 294], [260, 300]], 0.4, 8),
  C.cut([[520, 300], [610, 295], [700, 300]], 0.4, 8),
];

export function DayBackcloth() {
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x="-40" y="-30" width="780" height="520" fill="url(#theatre-sky-day)" />
      <g opacity="0.55">
        <path d="M-40 60 Q120 40 300 70 T740 50" className="ts-skyline" fill="none" strokeWidth="1.2" />
        <path d="M-40 118 Q200 98 380 124 T740 104" className="ts-skyline" fill="none" strokeWidth="1" />
      </g>
      <path className="tf-hill1" d={dayHillFar} />
      <path className="tf-elev" d={annex} />
      <path className="tf-elev" d={elevator} />
      <path className="tf-roof2" d={elevatorCap} />
      <path d="M436 200 H460 M436 240 H460 M464 250 H508" className="ts-elevline" strokeWidth="1.2" />
      <path className="tf-canola" d={canola} />
      <path className="tf-hill2" d={dayHillNear} />
      {fields.map((d, i) => <path key={i} className="tf-canola" d={d} opacity="0.7" />)}
      <path d="M233 -30 V360 M466 -30 V360" className="ts-seam" strokeWidth="1" strokeDasharray="4 5" />
    </svg>
  );
}

/* ---------------- night backcloth (rolls down from the fly loft) ---------------- */

const NIGHT_STARS = Array.from({ length: 46 }, () => [S.rr(-30, 730), S.rr(-20, 230), S.rr(0.6, 1.7)] as const);
const nightMtn = S.cut(ridge(wave(270, [[4, 260, 1.1], [2, 90, 2.4]]), -40, 740, 346, 9), 0.7, 7);
const nightElevator = S.cut([[434, 300], [434, 176], [448, 160], [462, 176], [462, 300]], 0.6, 6) + S.cut([[440, 176], [440, 146], [448, 136], [456, 146], [456, 176]], 0.5, 5) + S.cut([[462, 300], [462, 226], [486, 214], [510, 226], [510, 300]], 0.6, 6);
const nightRidge = S.cut(ridge(wave(292, [[3, 170, 0.2], [2, 60, 1.7]]), -40, 740, 346, 7), 0.8, 6);
const NIGHT_BACK_PINES = Array.from({ length: 22 }, (_, i) => {
  const x = -20 + i * 35 + S.rr(-8, 8);
  const h = S.rr(40, 74);
  return pineTiers(x, 300, h * 0.7, h * 0.36, 3).map((p) => S.cut(p, 0.5, 5)).join('');
});

export function NightBackcloth() {
  return (
    <svg className="th-fill" viewBox="-35 -23 770 380" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x="-40" y="-30" width="780" height="390" fill="url(#theatre-sky-night)" />
      <g fill="#fff4d6">
        {NIGHT_STARS.map(([x, y, r], i) => <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(2)} opacity={i % 3 ? 0.55 : 0.9} />)}
      </g>
      <path d={nightMtn} fill="#3a3f86" />
      <path d={nightElevator} fill="#2e336f" />
      <rect x="445" y="150" width="5" height="6" fill="#ffd57c" opacity="0.85" />
      <path d={nightRidge} fill="#2b3071" />
      <g fill="#20245e">{NIGHT_BACK_PINES.map((d, i) => <path key={i} d={d} />)}</g>
      <rect x="-40" y="342" width="780" height="12" fill="url(#theatre-wood)" />
      <rect x="-40" y="342" width="780" height="3" fill="#fff" opacity="0.18" />
    </svg>
  );
}

/* ---------------- night forest flats (slide in from the wings) ---------------- */

function forestFlat(x0: number, x1: number, seed: number) {
  const K = makeCutter(seed);
  const trees: string[] = [];
  const back: string[] = [];
  for (let x = x0; x < x1; x += K.rr(32, 44)) {
    const h = K.rr(110, 176);
    back.push(pineTiers(x + 16, 344, h * 0.8, h * 0.42, 4).map((p) => K.cut(p, 0.6, 6)).join(''));
  }
  for (let x = x0 + 10; x < x1; x += K.rr(46, 62)) {
    const h = K.rr(130, 200);
    trees.push(pineTiers(x, 346, h, h * 0.46, 5).map((p) => K.cut(p, 0.7, 6)).join(''));
  }
  const ground = K.cut(ridge(wave(334, [[3, 80, seed]]), x0 - 20, x1 + 20, 350, 8), 0.6, 6);
  return { trees, back, ground };
}
const FOREST_L = forestFlat(-30, 330, 41);
const FOREST_R = forestFlat(380, 740, 97);

export function ForestFlat({ side }: { side: 'l' | 'r' }) {
  const f = side === 'l' ? FOREST_L : FOREST_R;
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g fill="#262b6c">{f.back.map((d, i) => <path key={i} d={d} />)}</g>
      <g fill="#1b1f55" filter="url(#theatre-sh)">{f.trees.map((d, i) => <path key={i} d={d} />)}</g>
      <path d={f.ground} fill="#1b1f55" />
    </svg>
  );
}

/* ---------------- cottage row (stays; windows light at night) ---------------- */

interface Cottage { x: number; w: number; h: number; roof: number; wallC: string; roofC: string; chimney?: boolean; sign?: string }
const COTTAGES: Cottage[] = [
  { x: 6, w: 76, h: 70, roof: 44, wallC: 'tf-wall1', roofC: 'tf-roof', chimney: true },
  { x: 86, w: 64, h: 86, roof: 36, wallC: 'tf-wall2', roofC: 'tf-roof3' },
  { x: 154, w: 88, h: 64, roof: 48, wallC: 'tf-wall3', roofC: 'tf-roof2', chimney: true },
  { x: 458, w: 92, h: 78, roof: 40, wallC: 'tf-wall2', roofC: 'tf-roof', sign: 'DT&S' },
  { x: 556, w: 70, h: 62, roof: 46, wallC: 'tf-wall1', roofC: 'tf-roof3', chimney: true },
  { x: 630, w: 74, h: 84, roof: 38, wallC: 'tf-wall3', roofC: 'tf-roof2' },
];
const BASE = 338;
const COTTAGE_ART = COTTAGES.map((c) => {
  const top = BASE - c.h;
  const wall = C.cut(box(c.x, top, c.w, c.h + 4), 0.6, 6);
  const roof = C.cut([[c.x - 6, top + 2], [c.x + c.w / 2, top - c.roof], [c.x + c.w + 6, top + 2]], 0.8, 6);
  const chim = c.chimney ? C.cut(box(c.x + c.w * 0.68, top - c.roof * 0.9, 11, c.roof * 0.6), 0.4, 5) : '';
  const cols = c.w > 80 ? 3 : 2;
  const wins: Pt[][] = [];
  for (let k = 0; k < cols; k += 1) {
    const wx = c.x + (c.w / (cols + 1)) * (k + 1) - 7;
    wins.push(box(wx, top + 14, 14, 16));
    if (c.h > 74) wins.push(box(wx, top + 40, 14, 14));
  }
  const winPaths = wins.map((w) => C.cut(w, 0.3, 4));
  const door = C.cut(box(c.x + c.w / 2 - 8, BASE - 26, 16, 28), 0.4, 5);
  return { ...c, top, wall, roof, chim, winPaths, wins, door };
});
const BUNTING = (() => {
  const flags: Array<{ d: string; c: string }> = [];
  const lines: string[] = [];
  const spans: Array<[number, number, number, number]> = [[150, 214, 300, 250], [400, 250, 520, 214]];
  spans.forEach(([ax, ay, bx, by]) => {
    const sag = 22;
    lines.push(`M${ax} ${ay} Q${(ax + bx) / 2} ${(ay + by) / 2 + sag * 2} ${bx} ${by}`);
    for (let k = 1; k < 8; k += 1) {
      const t = k / 8;
      const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * ((ax + bx) / 2) + t * t * bx;
      const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * ((ay + by) / 2 + sag * 2) + t * t * by;
      flags.push({ d: C.cut([[x - 6, y], [x + 6, y], [x, y + 13]], 0.3, 3), c: ['tf-flag1', 'tf-flag2', 'tf-flag3'][k % 3] });
    }
  });
  return { flags, lines };
})();

export function CottageRow() {
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {COTTAGE_ART.map((c, i) => (
        <g key={i}>
          <g className="th-piece">
            {c.chim && <path className="tf-chim" d={c.chim} />}
            <path className={c.wallC} d={c.wall} />
          </g>
        </g>
      ))}
      {COTTAGE_ART.map((c, i) => (
        <g key={`r${i}`}>
          <g className="th-piece"><path className={c.roofC} d={c.roof} /></g>
          <g className="th-winglow" filter="url(#pc-glow)">
            {c.wins.map(([[x, y]], k) => <rect key={k} x={x - 4} y={y - 4} width="22" height="24" rx="6" fill="#ffd57c" opacity="0.5" />)}
          </g>
          {c.winPaths.map((d, k) => <path key={k} className="tf-win" d={d} />)}
          {c.wins.map(([[x, y], [x2], , [, y4]], k) => (
            <path key={`m${k}`} d={`M${(x + x2) / 2} ${y} V${y4} M${x} ${(y + y4) / 2} H${x2}`} className="ts-mullion" strokeWidth="1.4" />
          ))}
          <path className="tf-door" d={c.door} />
          {c.sign && (
            <g>
              <rect x={c.x + c.w / 2 - 22} y={c.top - 12} width="44" height="13" className="tf-sign" />
              <text x={c.x + c.w / 2} y={c.top - 2.5} textAnchor="middle" className="th-set-text">{c.sign}</text>
            </g>
          )}
        </g>
      ))}
      <g fill="none" className="ts-string" strokeWidth="1">{BUNTING.lines.map((d, i) => <path key={i} d={d} />)}</g>
      <g className="th-piece">{BUNTING.flags.map((f, i) => <path key={i} className={f.c} d={f.d} />)}</g>
    </svg>
  );
}

/* ---------------- stage floor ---------------- */

const BOARDS = Array.from({ length: 17 }, (_, i) => {
  const xb = -40 + i * 49;
  const xt = 350 + (xb - 350) * 0.72;
  return `M${xt.toFixed(1)} 336 L${xb.toFixed(1)} 470`;
});
const floorEdge = C.cut([[-40, 334], [740, 334], [740, 470], [-40, 470]], 0.5, 9);

export function StageFloor() {
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="tf-floor" d={floorEdge} />
      <g className="ts-floord" strokeWidth="1.3">{BOARDS.map((d, i) => <path key={i} d={d} />)}</g>
      <path d="M-40 372 H740 M-40 416 H740" className="ts-floord" strokeWidth="0.8" opacity="0.6" />
      <rect x="-40" y="334" width="780" height="10" fill="url(#theatre-floor-shade)" />
      <path d="M-40 448 H740" className="ts-slot" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------- the watercooler-well ---------------- */

const W = makeCutter(5150);
const WELL = {
  base: W.cut([[296, 290], [404, 290], [408, 352], [292, 352]], 0.6, 6),
  rim: W.cut([[288, 280], [412, 280], [412, 294], [288, 294]], 0.6, 6),
  stones: [
    box(300, 300, 30, 14), box(334, 300, 32, 14), box(370, 300, 32, 14),
    box(296, 318, 22, 14), box(322, 318, 34, 14), box(360, 318, 26, 14), box(390, 318, 16, 14),
    box(300, 336, 36, 13), box(340, 336, 30, 13), box(374, 336, 30, 13),
  ].map((p) => W.cut(p, 0.8, 4)),
  postL: W.cut(box(304, 196, 10, 88), 0.4, 6),
  postR: W.cut(box(386, 196, 10, 88), 0.4, 6),
  beam: W.cut(box(300, 214, 100, 7), 0.3, 6),
  roof: W.cut([[282, 204], [350, 160], [418, 204], [408, 210], [350, 172], [292, 210]], 0.7, 5),
  roofFill: W.cut([[296, 202], [350, 168], [404, 202]], 0.6, 6),
  jug: W.cut([
    [330, 222], [370, 222], [378, 230], [380, 258], [374, 266], [360, 270], [356, 282], [344, 282], [340, 270],
    [326, 266], [320, 258], [322, 230],
  ], 0.5, 4),
  jugShine: W.cut([[330, 230], [336, 228], [336, 258], [330, 256]], 0.2, 4),
  sign: W.cut([[318, 330], [382, 326], [384, 346], [316, 348]], 0.5, 5),
  crank: 'M396 238 H414 V250',
};

export function Well() {
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g className="th-piece"><path className="tf-post" d={WELL.postL + WELL.postR} /></g>
      <path d={WELL.crank} className="ts-post" strokeWidth="3" fill="none" strokeLinecap="round" />
      <g className="th-jugglow" filter="url(#pc-glow)"><path d={WELL.jug} fill="#8fd8ff" opacity="0.6" /></g>
      <g className="th-piece">
        <path className="tf-jug" d={WELL.jug} />
      </g>
      <path className="tf-jugl" d={WELL.jugShine} />
      <path d="M322 240 H378 M322 250 H378" className="ts-jugline" strokeWidth="1.2" />
      <path d="M348 226 q-2 -10 3 -18 q4 -6 -1 -12" className="ts-bubble" strokeWidth="1.2" fill="none" />
      <circle cx="352" cy="244" r="3" className="tf-jugl" />
      <circle cx="344" cy="256" r="2" className="tf-jugl" />
      <g className="th-piece"><path className="tf-post" d={WELL.beam} /></g>
      <g className="th-piece">
        <path className="tf-roof" d={WELL.roof} />
      </g>
      <path className="tf-roof3" d={WELL.roofFill} />
      <path d="M306 196 L394 196 M318 186 L382 186 M332 176 L368 176" className="ts-shingle" strokeWidth="1.2" />
      <g className="th-piece">
        <path className="tf-stone" d={WELL.rim} />
        <path className="tf-stoned" d={WELL.base} />
        {WELL.stones.map((d, i) => <path key={i} className="tf-stone" d={d} />)}
      </g>
      <g className="th-piece"><path className="tf-sign" d={WELL.sign} /></g>
      <text x="350" y="341" textAnchor="middle" className="th-set-hand">the watercooler</text>
    </svg>
  );
}

/* ---------------- wings ---------------- */

const bakery = {
  wall: C.cut([[-40, 40], [120, 64], [120, 440], [-40, 440]], 0.8, 7),
  trim: C.cut([[-40, 34], [128, 58], [128, 68], [-40, 46]], 0.6, 6),
  window: C.cut(box(18, 262, 78, 70), 0.5, 6),
  door: C.cut(box(-20, 340, 36, 100), 0.5, 6),
  upWin: C.cut(box(34, 120, 44, 52), 0.5, 6),
  bracket: 'M120 150 H176 M120 170 L144 150',
  board: C.cut([[122, 158], [212, 155], [214, 190], [120, 192]], 0.6, 5),
  awning: Array.from({ length: 7 }, (_, i) => C.cut([[-20 + i * 20, 226], [i * 20, 226], [i * 20 + 2, 256], [-10 + i * 20, 262], [-22 + i * 20, 256]], 0.4, 4)),
};
const oak = {
  trunk: C.cut([[606, 440], [618, 330], [612, 250], [596, 200], [612, 204], [628, 238], [648, 196], [660, 204], [640, 262], [642, 330], [652, 440]], 0.8, 6),
  canopy: [
    C.cut(circ(560, 150, 58, 26), 1.4, 6), C.cut(circ(640, 110, 72, 30), 1.4, 6), C.cut(circ(700, 170, 60, 26), 1.4, 6),
    C.cut(circ(610, 190, 48, 22), 1.2, 6), C.cut(circ(690, 60, 60, 26), 1.3, 6),
  ],
  canopyHi: [C.cut(circ(630, 90, 34, 16), 1, 5), C.cut(circ(560, 136, 26, 14), 1, 5)],
  apples: [[572, 170], [626, 150], [662, 124], [598, 104], [690, 184]] as Array<[number, number]>,
  fence: Array.from({ length: 6 }, (_, i) => C.cut([[520 + i * 24, 440], [520 + i * 24, 382], [526 + i * 24, 374], [532 + i * 24, 382], [532 + i * 24, 440]], 0.4, 5)),
  rail: C.cut(box(514, 396, 150, 8), 0.4, 6),
};

const nightTree = {
  trunk: C.cut([
    [-40, 440], [-40, 0], [10, 0], [22, 60], [30, 120], [60, 90], [104, 80], [140, 50], [150, 58], [110, 96],
    [70, 116], [44, 150], [52, 220], [86, 214], [126, 236], [112, 244], [80, 234], [56, 248], [60, 440],
  ], 1.2, 6),
  owl: C.cut([[88, 64], [96, 50], [104, 58], [112, 50], [120, 64], [122, 82], [104, 94], [86, 82]], 0.5, 4),
};
const NIGHT_PINES = [
  pineTiers(610, 440, 380, 170, 6), pineTiers(690, 440, 440, 190, 7), pineTiers(560, 440, 260, 120, 5),
].map((tiers) => tiers.map((p) => C.cut(p, 0.9, 7)).join(''));

export function DayWing({ side }: { side: 'l' | 'r' }) {
  if (side === 'l') {
    return (
      <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="xMinYMax slice" aria-hidden="true" focusable="false">
        <g className="th-piece"><path className="tf-wall3" d={bakery.wall} /></g>
        <g className="th-piece"><path className="tf-roof" d={bakery.trim} /></g>
        <path d="M-40 110 H120 M-40 200 H120 M4 64 V200 M100 62 V200 M4 110 L34 200 M100 110 L70 200" className="ts-timber" strokeWidth="5" fill="none" />
        <path className="tf-win" d={bakery.upWin} />
        <path d="M56 120 V172 M34 146 H78" className="ts-mullion" strokeWidth="2.4" />
        <g className="th-winglow" filter="url(#pc-glow)"><rect x="30" y="116" width="52" height="60" rx="6" fill="#ffd57c" opacity="0.45" /></g>
        <path className="tf-winframe" d={bakery.window} />
        {[24, 48, 72].map((x) => (
          <g key={x}>
            <rect x={x} y="290" width="20" height="15" rx="1.5" className="tf-monitor" />
            <rect x={x + 2} y="292" width="16" height="11" className="tf-screen" />
            <rect x={x + 8} y="305" width="4" height="6" className="tf-monitor" />
          </g>
        ))}
        <g className="th-piece">
          {bakery.awning.map((d, i) => <path key={i} className={i % 2 ? 'tf-awn2' : 'tf-awn1'} d={d} />)}
        </g>
        <path className="tf-door" d={bakery.door} />
        <path d={bakery.bracket} className="ts-iron" strokeWidth="3" fill="none" />
        <g className="th-piece"><path className="tf-sign" d={bakery.board} /></g>
        <text x="167" y="177" textAnchor="middle" className="th-set-text th-set-big">SERVICE DESK</text>
      </svg>
    );
  }
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
      <g className="th-piece"><path className="tf-trunk" d={oak.trunk} /></g>
      <g className="th-piece">{oak.canopy.map((d, i) => <path key={i} className={i % 2 ? 'tf-leaf2' : 'tf-leaf1'} d={d} />)}</g>
      {oak.canopyHi.map((d, i) => <path key={i} className="tf-leafhi" d={d} />)}
      {oak.apples.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" className="tf-apple" />)}
      <g className="th-piece">
        <path className="tf-fence" d={oak.rail} />
        {oak.fence.map((d, i) => <path key={i} className="tf-fence" d={d} />)}
      </g>
    </svg>
  );
}

export function NightWing({ side }: { side: 'l' | 'r' }) {
  if (side === 'l') {
    return (
      <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="xMinYMax slice" aria-hidden="true" focusable="false">
        <g filter="url(#theatre-sh)"><path d={nightTree.trunk} fill="#1a1c48" /></g>
        <path d={nightTree.owl} fill="#2a2b63" />
        <g filter="url(#pc-glow)" className="th-blink">
          <circle cx="98" cy="68" r="3.4" fill="#ffd84a" />
          <circle cx="111" cy="68" r="3.4" fill="#ffd84a" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="th-fill" viewBox={BLEED_VIEWBOX} preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
      <g filter="url(#theatre-sh)">
        {NIGHT_PINES.map((d, i) => <path key={i} d={d} fill={['#1d2157', '#161947', '#232863'][i]} />)}
      </g>
    </svg>
  );
}

/* ---------------- valance & curtain cloth ---------------- */

const VALANCE = (() => {
  const swags: string[] = [];
  const knots: string[] = [];
  const n = 6;
  const w = 780 / n;
  for (let i = 0; i < n; i += 1) {
    const x = -40 + i * w;
    const pts: Pt[] = [];
    for (let k = 0; k <= 14; k += 1) pts.push([x + (w * k) / 14, 20 + Math.sin((k / 14) * Math.PI) * 34]);
    for (let k = 14; k >= 0; k -= 1) pts.push([x + (w * k) / 14, 20]);
    swags.push(C.cut(pts, 0.6, 5));
    knots.push(C.cut([[x + w - 7, 16], [x + w + 7, 16], [x + w + 5, 46], [x + w, 56], [x + w - 5, 46]], 0.4, 4));
  }
  return { swags, knots, band: C.cut(box(-40, -30, 780, 52), 0.7, 8) };
})();

export function Valance() {
  return (
    <svg className="th-fill" viewBox="-35 -23 770 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g filter="url(#theatre-sh)">
        {VALANCE.swags.map((d, i) => <path key={i} d={d} fill="url(#theatre-fold-swag)" />)}
      </g>
      {VALANCE.swags.map((d, i) => <path key={`e${i}`} d={d} fill="none" className="ts-gold" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" />)}
      <g filter="url(#theatre-sh)"><path d={VALANCE.band} className="tf-red" /></g>
      <path d="M-40 16 H740" className="ts-gold" strokeWidth="4" />
      <path d="M-40 10 H740" className="ts-gold" strokeWidth="1.5" strokeDasharray="1 5" strokeLinecap="round" />
      <g filter="url(#theatre-sh)">{VALANCE.knots.map((d, i) => <path key={i} d={d} className="tf-gold" />)}</g>
    </svg>
  );
}

export function CurtainCloth({ side }: { side: 'l' | 'r' }) {
  return (
    <svg className="th-fill" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect width="100" height="100" fill="url(#theatre-fold)" />
      <rect width="100" height="100" fill={`url(#theatre-curtain-edge-${side})`} />
      <rect y="96.4" width="100" height="3.6" className="tf-gold" />
      <rect y="95.6" width="100" height="0.8" className="tf-goldd" />
    </svg>
  );
}
