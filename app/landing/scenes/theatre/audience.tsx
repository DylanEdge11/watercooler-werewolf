import { circ, makeCutter, type Pt } from './cut';

/* The front row: silhouetted paper heads, seen from behind. */

const A = makeCutter(4242);

type Hat = 'none' | 'bun' | 'tophat' | 'bowler' | 'spiky' | 'party' | 'feather' | 'curly' | 'pony' | 'wolf' | 'phone' | 'hardhat';
const ROW: Array<{ x: number; r: number; y: number; hat: Hat }> = [
  { x: 40, r: 30, y: 96, hat: 'feather' },
  { x: 150, r: 28, y: 92, hat: 'bun' },
  { x: 262, r: 31, y: 98, hat: 'tophat' },
  { x: 380, r: 27, y: 90, hat: 'party' },
  { x: 492, r: 30, y: 96, hat: 'wolf' },
  { x: 606, r: 28, y: 94, hat: 'none' },
  { x: 716, r: 29, y: 100, hat: 'curly' },
  { x: 830, r: 27, y: 92, hat: 'phone' },
  { x: 942, r: 31, y: 96, hat: 'bowler' },
  { x: 1056, r: 28, y: 94, hat: 'pony' },
  { x: 1166, r: 30, y: 98, hat: 'spiky' },
  { x: 1280, r: 28, y: 92, hat: 'hardhat' },
  { x: 1392, r: 30, y: 96, hat: 'curly' },
];

const people = ROW.map(({ x, r, y: y0, hat }) => {
  const y = y0 + 14;
  const shoulders: Pt[] = [
    [x - r * 2.3, 190], [x - r * 2.1, y + r * 1.5], [x - r * 1.4, y + r * 0.95], [x - r * 0.55, y + r * 0.8],
    [x + r * 0.55, y + r * 0.8], [x + r * 1.4, y + r * 0.95], [x + r * 2.1, y + r * 1.5], [x + r * 2.3, 190],
  ];
  let d = A.cut(shoulders, 1, 7) + A.cut(circ(x, y, r, 22, r * 1.12), 0.8, 6);
  if (hat === 'bun') d += A.cut(circ(x + 4, y - r * 1.15, r * 0.42, 12), 0.6, 5);
  if (hat === 'tophat') d += A.cut([[x - r * 1.2, y - r * 0.7], [x + r * 1.2, y - r * 0.7], [x + r * 1.2, y - r * 0.9], [x + r * 0.75, y - r * 0.9], [x + r * 0.75, y - r * 2.4], [x - r * 0.75, y - r * 2.4], [x - r * 0.75, y - r * 0.9], [x - r * 1.2, y - r * 0.9]], 0.6, 6);
  if (hat === 'bowler') d += A.cut([...circ(x, y - r * 0.75, r * 0.85, 16, r * 0.7).filter(([, py]) => py <= y - r * 0.7), [x + r * 1.15, y - r * 0.7], [x - r * 1.15, y - r * 0.7]], 0.5, 5);
  if (hat === 'party') d += A.cut([[x - r * 0.6, y - r * 0.8], [x + 6, y - r * 2.5], [x + r * 0.7, y - r * 0.8]], 0.5, 5) + A.cut(circ(x + 6, y - r * 2.55, 5, 8), 0.3, 3);
  if (hat === 'spiky') d += A.cut([[x - r, y - r * 0.4], [x - r * 0.8, y - r * 1.5], [x - r * 0.4, y - r * 0.9], [x - r * 0.1, y - r * 1.7], [x + r * 0.2, y - r * 0.9], [x + r * 0.6, y - r * 1.6], [x + r * 0.7, y - r * 0.8], [x + r * 1.1, y - r * 1.2], [x + r, y - r * 0.3]], 0.5, 5);
  if (hat === 'feather') d += A.cut([[x - r * 1.1, y - r * 0.6], [x + r * 1.1, y - r * 0.6], [x + r * 0.8, y - r * 1.3], [x - r * 0.8, y - r * 1.3]], 0.5, 5) + A.cut([[x + r * 0.3, y - r * 1.2], [x + r * 1.1, y - r * 3], [x + r * 1.4, y - r * 2.8], [x + r * 0.6, y - r * 1.1]], 0.6, 4);
  if (hat === 'curly') d += [[-0.8, -0.6], [-0.3, -1], [0.3, -1.05], [0.8, -0.6], [1, 0], [-1, 0]].map(([dx, dy]) => A.cut(circ(x + dx * r, y + dy * r, r * 0.42, 10), 0.4, 4)).join('');
  if (hat === 'pony') d += A.cut([[x + r * 0.5, y - r * 0.6], [x + r * 1.6, y - r * 0.2], [x + r * 1.9, y + r * 0.8], [x + r * 1.3, y + r * 0.2], [x + r * 0.6, y]], 0.6, 4);
  if (hat === 'hardhat') d += A.cut([...circ(x, y - r * 0.55, r * 0.95, 18, r * 0.8).filter(([, py]) => py <= y - r * 0.5), [x + r * 1.35, y - r * 0.5], [x + r * 1.35, y - r * 0.36], [x - r * 1.35, y - r * 0.36], [x - r * 1.35, y - r * 0.5]], 0.5, 5);
  return { d, x, y, r, hat };
});

const wolfPerson = people.find((p) => p.hat === 'wolf')!;
const wolfEars = A.cut([[wolfPerson.x - 26, wolfPerson.y - 6], [wolfPerson.x - 22, wolfPerson.y - 60], [wolfPerson.x - 4, wolfPerson.y - 24]], 0.5, 4) +
  A.cut([[wolfPerson.x + 26, wolfPerson.y - 6], [wolfPerson.x + 22, wolfPerson.y - 60], [wolfPerson.x + 4, wolfPerson.y - 24]], 0.5, 4);
const phonePerson = people.find((p) => p.hat === 'phone')!;

const SEATS = Array.from({ length: 14 }, (_, i) => {
  const x = -60 + i * 112;
  const pts: Pt[] = [[x, 200], [x, 168]];
  for (let k = 0; k <= 10; k += 1) pts.push([x + 6 + k * 9.6, 158 - Math.sin((k / 10) * Math.PI) * 10]);
  pts.push([x + 108, 168], [x + 108, 200]);
  return A.cut(pts, 0.6, 6);
});

export default function Audience() {
  return (
    <svg viewBox="0 0 1440 190" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <g className="th-wolf-ears"><path d={wolfEars} className="tf-aud" /></g>
      <path d={people.map((p) => p.d).join('')} className="tf-aud" />
      <g className="th-phone">
        <rect x={phonePerson.x + 26} y={phonePerson.y + 4} width="16" height="26" rx="3" fill="#bfe3ff" filter="url(#pc-glow)" transform={`rotate(12 ${phonePerson.x + 34} ${phonePerson.y + 16})`} />
        <path d={`M${phonePerson.x + 20} ${phonePerson.y + 40} L${phonePerson.x + 34} ${phonePerson.y + 28}`} className="ts-aud" strokeWidth="10" strokeLinecap="round" />
      </g>
      <g className="th-seats">{SEATS.map((d, i) => <path key={i} d={d} className="tf-seat" />)}</g>
    </svg>
  );
}
