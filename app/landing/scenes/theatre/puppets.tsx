import type { ReactNode } from 'react';

/*
 * Two-sided stick-puppet cards, drawn in a 100 x 170 box (feet at y ~166).
 * Each character is one function: pass `wolf` to get the reverse of the card,
 * which keeps the costume (lanyard, apron, sash…) but swaps in fur, paws,
 * a tail and glowing eyes.
 */

const INK = '#2b2118';

interface Look { skin: string; fur: string; furL: string }

function HumanHead({ skin, children }: { skin: string; children?: ReactNode }) {
  return (
    <g>
      <ellipse cx="33.5" cy="48" rx="4" ry="5" fill={skin} />
      <ellipse cx="66.5" cy="48" rx="4" ry="5" fill={skin} />
      <circle cx="50" cy="46" r="17" fill={skin} />
      <circle cx="43.5" cy="46" r="2" fill={INK} />
      <circle cx="56.5" cy="46" r="2" fill={INK} />
      <circle cx="44.2" cy="45.3" r="0.6" fill="#fff" />
      <circle cx="57.2" cy="45.3" r="0.6" fill="#fff" />
      <circle cx="39.5" cy="53" r="3.6" fill="#e0776a" opacity="0.45" />
      <circle cx="60.5" cy="53" r="3.6" fill="#e0776a" opacity="0.45" />
      {children}
    </g>
  );
}

function Smile() {
  return <path d="M45 55.5 q5 4.5 10 0" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />;
}

function WolfHead({ fur, furL, children }: { fur: string; furL: string; children?: ReactNode }) {
  return (
    <g>
      <path d="M34 36 L29 6 L47 26 Z" fill={fur} />
      <path d="M66 36 L71 6 L53 26 Z" fill={fur} />
      <path d="M35.5 31 L32.5 14 L43 27 Z" fill="#8c4f63" />
      <path d="M64.5 31 L67.5 14 L57 27 Z" fill="#8c4f63" />
      <path d="M31 44 Q30 23 50 23 Q70 23 69 44 L76 50 L68 53 L73 59 L62 62 L38 62 L27 59 L32 53 L24 50 Z" fill={fur} />
      <path d="M40 49 Q50 43 60 49 L61 61 Q50 70 39 61 Z" fill={furL} />
      <path d="M44 28 L50 36 L56 28" stroke={furL} strokeWidth="1.4" fill="none" opacity="0.7" />
      <ellipse cx="50" cy="50.5" rx="5" ry="3.4" fill="#1c1726" />
      <path d="M42.5 59 Q50 64.5 57.5 59" stroke="#1c1726" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M45 60.6 l1.8 5 l2 -4.2 Z M55 60.6 l-1.8 5 l-2 -4.2 Z" fill="#fffaf0" />
      <g className="th-eyes" filter="url(#pc-glow)">
        <ellipse cx="42.5" cy="41" rx="4" ry="2.9" fill="#ffd84a" />
        <ellipse cx="57.5" cy="41" rx="4" ry="2.9" fill="#ffd84a" />
      </g>
      <rect x="41.8" y="38.8" width="1.4" height="4.4" rx="0.7" fill="#3a2410" />
      <rect x="56.8" y="38.8" width="1.4" height="4.4" rx="0.7" fill="#3a2410" />
      <path d="M36 35.5 L46.5 38.5 M64 35.5 L53.5 38.5" stroke="#1c1726" strokeWidth="2.2" strokeLinecap="round" />
      {children}
    </g>
  );
}

function Hand({ x, y, wolf, look }: { x: number; y: number; wolf: boolean; look: Look }) {
  if (!wolf) return <circle cx={x} cy={y} r="4.6" fill={look.skin} />;
  return (
    <g>
      <circle cx={x} cy={y} r="5.6" fill={look.fur} />
      <path d={`M${x - 4} ${y + 3} l-1 4 l2.4 -2.6 Z M${x} ${y + 4.6} l0 4 l1.6 -3.4 Z M${x + 4} ${y + 3} l1 4 l-2.4 -2.6 Z`} fill="#fffaf0" />
    </g>
  );
}

function Tail({ look }: { look: Look }) {
  return (
    <g>
      <path d="M58 120 Q84 120 92 98 Q97 86 90 76 Q89 96 74 106 Q64 112 56 112 Z" fill={look.fur} />
      <path d="M92 98 Q97 86 90 76 Q92 88 88 96 Z" fill={look.furL} />
    </g>
  );
}

function Arm({ d, color, w = 8.5 }: { d: string; color: string; w?: number }) {
  return <path d={d} stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
}

/* ---------------- the cast (DT&S and friends) ---------------- */

const TYPE = 'var(--ll-font-type), monospace';

function FieldTech({ wolf }: { wolf: boolean }) {
  const look: Look = { skin: '#d9a27a', fur: '#7a6656', furL: '#c8b39c' };
  return (
    <>
      {wolf && <Tail look={look} />}
      <rect x="41" y="126" width="8" height="36" fill="#4a4f5a" />
      <rect x="51" y="126" width="8" height="36" fill="#4a4f5a" />
      <ellipse cx="43" cy="163" rx="8" ry="4" fill={wolf ? look.fur : '#5a3a24'} />
      <ellipse cx="57" cy="163" rx="8" ry="4" fill={wolf ? look.fur : '#5a3a24'} />
      <path d="M31 73 Q50 65 69 73 L71 130 L29 130 Z" fill="#3d4a5c" />
      <path d="M31 74 L45 72 L46 130 L29 130 Z M69 74 L55 72 L54 130 L71 130 Z" fill="#ff7a1a" />
      <path d="M30 100 H46 M54 100 H70 M30 114 H46 M54 114 H70" stroke="#e8eef2" strokeWidth="3.4" />
      <rect x="57" y="80" width="9" height="6" rx="1" fill="#fffaf0" />
      <Arm d="M34 76 L26 100" color="#ff7a1a" />
      <Arm d="M66 76 L80 94" color="#ff7a1a" />
      <rect x="17" y="96" width="14" height="20" rx="2.5" fill="#f2c230" />
      <rect x="19.5" y="99" width="9" height="6" fill="#2b3a2a" />
      <text x="24" y="104" textAnchor="middle" fontSize="4" fontFamily={TYPE} fill="#7fe07f">0.0</text>
      <Hand x={26} y={103} wolf={wolf} look={look} />
      <path d="M83 96 L90 58" stroke="#9aa3ad" strokeWidth="5" strokeLinecap="round" />
      <path d="M86 58 a7 7 0 1 1 9 2 l-3 -5 l-5 1 Z" fill="#9aa3ad" />
      <Hand x={82} y={96} wolf={wolf} look={look} />
      {wolf ? (
        <WolfHead fur={look.fur} furL={look.furL} />
      ) : (
        <HumanHead skin={look.skin}>
          <Smile />
          <circle cx="41" cy="51" r="0.8" fill="#8a4a2a" /><circle cx="59" cy="51" r="0.8" fill="#8a4a2a" />
        </HumanHead>
      )}
      <g transform={wolf ? 'translate(0 -5)' : undefined}>
        <path d="M34 33 Q34 12 50 12 Q66 12 66 33 Z" fill="#f7f4ea" />
        <path d="M48 12.5 H52 V33 H48 Z" fill="#e2ddcc" />
        <rect x="28" y="31" width="44" height="5" rx="2.5" fill="#f7f4ea" />
        <rect x="44" y="20" width="12" height="6" rx="1" fill="#3f8fd8" />
      </g>
      {wolf && (
        <g>
          <path d="M36 26 L30 2 L45 20 Z" fill={look.fur} />
          <path d="M64 26 L70 2 L55 20 Z" fill={look.fur} />
        </g>
      )}
    </>
  );
}

function ProjectManager({ wolf }: { wolf: boolean }) {
  const look: Look = { skin: '#e9bf98', fur: '#5d6275', furL: '#aeb3c6' };
  const gy = wolf ? 41 : 46;
  return (
    <>
      {wolf && <Tail look={look} />}
      <rect x="41" y="128" width="8" height="34" fill="#5b4a3a" />
      <rect x="51" y="128" width="8" height="34" fill="#5b4a3a" />
      <ellipse cx="44" cy="164" rx="7" ry="3.6" fill={wolf ? look.fur : '#2a241e'} />
      <ellipse cx="56" cy="164" rx="7" ry="3.6" fill={wolf ? look.fur : '#2a241e'} />
      <path d="M32 73 Q50 65 68 73 L70 134 L30 134 Z" fill="#e8e0d0" />
      <path d="M32 73 L44 70 L46 134 L30 134 Z M68 73 L56 70 L54 134 L70 134 Z" fill="#7a5c8e" />
      <path d="M31 118 H70" stroke="#6a4c7e" strokeWidth="2" strokeDasharray="2 2" />
      <circle cx="45" cy="92" r="1.4" fill="#e3b04b" /><circle cx="45" cy="104" r="1.4" fill="#e3b04b" />
      <path d="M42 71 L50 94 L58 71" stroke="#e3b04b" strokeWidth="2" fill="none" />
      <rect x="45" y="93" width="10" height="12" rx="1.2" fill="#fffaf0" />
      <rect x="45" y="93" width="10" height="3" fill="#e3b04b" />
      <Arm d="M34 76 L27 104" color="#7a5c8e" />
      <Arm d="M66 76 L75 96 L64 110" color="#7a5c8e" />
      <g transform="rotate(-8 70 104)">
        <rect x="58" y="90" width="24" height="30" rx="1.5" fill="#b58a5a" />
        <rect x="60.5" y="94" width="19" height="23" fill="#fffaf0" />
        <rect x="65" y="88" width="10" height="4" rx="1" fill="#b9bcc4" />
        <rect x="62" y="97" width="8" height="2.4" fill="#3f8fd8" />
        <rect x="66" y="101" width="9" height="2.4" fill="#e3b04b" />
        <rect x="69" y="105" width="8" height="2.4" fill="#c7353a" />
        <rect x="63" y="109" width="12" height="2.4" fill="#3fb37a" />
        <path d="M62 113.5 h16" stroke="#9a8f80" strokeWidth="0.8" />
      </g>
      <Hand x={63} y={111} wolf={wolf} look={look} />
      <rect x="7" y="96" width="21" height="22" rx="2" fill="#cfe3f5" />
      <path d="M7 101 q-5 1 -5 5 q0 4 5 4" stroke="#cfe3f5" strokeWidth="2.4" fill="none" />
      <text x="17.5" y="103.5" textAnchor="middle" fontSize="3.9" fontFamily={TYPE} fill="#1d3f75">PER MY</text>
      <text x="17.5" y="108.5" textAnchor="middle" fontSize="3.9" fontFamily={TYPE} fill="#1d3f75">LAST</text>
      <text x="17.5" y="113.5" textAnchor="middle" fontSize="3.9" fontFamily={TYPE} fill="#1d3f75">EMAIL</text>
      <path className="th-steam" d="M13 93 q-3 -5 1 -9 q3 -4 0 -8 M21 93 q-3 -5 1 -9" stroke="#fff" strokeWidth="1.4" fill="none" opacity="0.8" strokeLinecap="round" />
      <Hand x={28} y={106} wolf={wolf} look={look} />
      {wolf ? (
        <WolfHead fur={look.fur} furL={look.furL} />
      ) : (
        <HumanHead skin={look.skin}>
          <path d="M33 43 Q33 25 50 26 Q67 26 67 41 Q60 31 45 33 Q38 35 33 43 Z" fill="#8a5a36" />
          <path d="M35 50 Q36 64 50 65 Q64 64 65 50 Q60 58 50 58 Q40 58 35 50 Z" fill="#8a5a36" />
          <path d="M45 55.5 q5 3 10 0" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </HumanHead>
      )}
      <g stroke="#1e1e24" strokeWidth="1.6" fill="rgba(255,255,255,0.22)">
        <rect x={wolf ? 37 : 38} y={gy - 4.5} width="11" height="9" rx="2" />
        <rect x={wolf ? 52 : 51} y={gy - 4.5} width="11" height="9" rx="2" />
        <path d={`M${wolf ? 48 : 49} ${gy} h${wolf ? 4 : 2}`} fill="none" />
      </g>
    </>
  );
}

function ErpAnalyst({ wolf }: { wolf: boolean }) {
  const look: Look = { skin: '#b87a55', fur: '#8a7f96', furL: '#d0c7da' };
  return (
    <>
      {wolf && <Tail look={look} />}
      <rect x="42" y="148" width="6" height="14" fill={wolf ? look.fur : look.skin} />
      <rect x="52" y="148" width="6" height="14" fill={wolf ? look.fur : look.skin} />
      <ellipse cx="44" cy="164" rx="6" ry="3.4" fill="#2b2118" />
      <ellipse cx="56" cy="164" rx="6" ry="3.4" fill="#2b2118" />
      <path d="M33 128 L67 128 L71 152 L29 152 Z" fill="#2e3a4c" />
      <path d="M31 73 Q50 65 69 73 L71 132 L29 132 Z" fill="#3f7f86" />
      <path d="M43 70 L57 70 L50 94 Z" fill="#f5efe2" />
      <path d="M43 70 L50 94 L57 70" stroke="#2f6068" strokeWidth="1.6" fill="none" />
      <path d="M41 71 L50 100 L59 71" stroke="#3f8fd8" strokeWidth="2" fill="none" />
      <rect x="44" y="99" width="12" height="14" rx="1.5" fill="#fffaf0" />
      <rect x="44" y="99" width="12" height="3.5" fill="#3f8fd8" />
      <Arm d="M34 76 L28 106" color="#3f7f86" />
      <Arm d="M66 76 L72 100 L62 104" color="#3f7f86" />
      <g transform="rotate(8 68 102)">
        <rect x="56" y="86" width="25" height="31" rx="2" fill="#c7353a" />
        <rect x="56" y="86" width="4" height="31" fill="#8e2027" />
        <rect x="61" y="93" width="17" height="9" fill="#fffaf0" />
        <text x="69.5" y="99.4" textAnchor="middle" fontSize="3.7" fontFamily={TYPE} fill="#2b2118">GO-LIVE</text>
        <path d="M62 107 h14 M62 111 h10" stroke="#f7c0c0" strokeWidth="1" />
      </g>
      <Hand x={62} y={104} wolf={wolf} look={look} />
      <Hand x={27} y={109} wolf={wolf} look={look} />
      {wolf ? (
        <WolfHead fur={look.fur} furL={look.furL}>
          <circle cx="30" cy="54" r="2" fill="#e3b04b" />
          <circle cx="70" cy="54" r="2" fill="#e3b04b" />
        </WolfHead>
      ) : (
        <HumanHead skin={look.skin}>
          <path d="M32 46 Q31 27 50 27 Q69 27 68 46 Q64 34 50 34 Q36 34 32 46 Z" fill="#3b2a20" />
          <circle cx="33" cy="54" r="2" fill="#e3b04b" />
          <circle cx="67" cy="54" r="2" fill="#e3b04b" />
          <path d="M44.5 56 q5.5 4 11 0" stroke="#7a2e3a" strokeWidth="2" fill="none" strokeLinecap="round" />
        </HumanHead>
      )}
      {!wolf && (
        <g>
          <circle cx="50" cy="22" r="9.5" fill="#3b2a20" />
          <path d="M40 14 L61 27" stroke="#f2c14e" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}
      {wolf && <path d="M42 18 L60 25" stroke="#f2c14e" strokeWidth="2.2" strokeLinecap="round" />}
    </>
  );
}

function Cio({ wolf }: { wolf: boolean }) {
  const look: Look = { skin: '#f3d2b0', fur: '#4f4a5e', furL: '#a59fb4' };
  return (
    <>
      {wolf && <Tail look={look} />}
      <rect x="41" y="130" width="8" height="30" fill="#2e3048" />
      <rect x="51" y="130" width="8" height="30" fill="#2e3048" />
      <ellipse cx="44" cy="164" rx="7.5" ry="4" fill={wolf ? look.fur : '#141420'} />
      <ellipse cx="56" cy="164" rx="7.5" ry="4" fill={wolf ? look.fur : '#141420'} />
      <path d="M29 72 Q50 63 71 72 L75 138 L25 138 Z" fill="#2e3048" />
      <path d="M41 71 L59 71 L56 124 L44 124 Z" fill="#fbf8f0" />
      <path d="M48 72 L52 72 L55 110 L50 116 L45 110 Z" fill="#c7353a" />
      <path d="M41 71 L47 90 L44 124 M59 71 L53 90 L56 124" stroke="#1e2034" strokeWidth="2.2" fill="none" />
      <rect x="61" y="84" width="8" height="3" fill="#fbf8f0" />
      <circle cx="35" cy="96" r="4.4" fill="#e3b04b" />
      <text x="35" y="97.8" textAnchor="middle" fontSize="3.8" fontFamily={TYPE} fill="#2b2118">CIO</text>
      <Arm d="M33 76 L25 106" color="#2e3048" />
      <Arm d="M67 76 L80 54" color="#2e3048" />
      <g transform="rotate(-18 22 112)">
        <rect x="10" y="104" width="24" height="12" rx="3" fill="#fbf3de" />
        <circle cx="10" cy="110" r="4" fill="#efe2c0" /><circle cx="34" cy="110" r="4" fill="#efe2c0" />
        <text x="22" y="112" textAnchor="middle" fontSize="4.4" fontFamily={TYPE} fill="#2b2118">ROADMAP</text>
      </g>
      <Hand x={25} y={109} wolf={wolf} look={look} />
      <Hand x={81} y={51} wolf={wolf} look={look} />
      {wolf ? (
        <WolfHead fur={look.fur} furL={look.furL} />
      ) : (
        <HumanHead skin={look.skin}>
          <path d="M33 42 Q32 26 50 26 Q70 26 67 42 Q66 32 58 31 Q54 36 44 33 Q37 34 33 42 Z" fill="#c9c6c0" />
          <path d="M43 55 q7 6 14 0 Z" fill="#fff" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
        </HumanHead>
      )}
    </>
  );
}

function Security({ wolf }: { wolf: boolean }) {
  const look: Look = { skin: '#8a5a3c', fur: '#3f3d4f', furL: '#8f8ba3' };
  const sy = wolf ? 41 : 46;
  return (
    <>
      {wolf && <Tail look={look} />}
      <path d="M31 52 Q28 30 50 28 Q72 30 69 52 L70 68 L30 68 Z" fill="#23252f" />
      <rect x="41" y="128" width="8" height="34" fill="#23252f" />
      <rect x="51" y="128" width="8" height="34" fill="#23252f" />
      <ellipse cx="44" cy="164" rx="7" ry="3.6" fill={wolf ? look.fur : '#101014'} />
      <ellipse cx="56" cy="164" rx="7" ry="3.6" fill={wolf ? look.fur : '#101014'} />
      <path d="M31 73 Q50 65 69 73 L71 134 L29 134 Z" fill="#2a2d38" />
      <path d="M38 114 H62 V126 H38 Z" fill="#23252f" />
      <path d="M44 72 V88 M56 72 V88" stroke="#d7e0e6" strokeWidth="1.2" />
      <path d="M40 71 L50 94 L60 71" stroke="#3fb37a" strokeWidth="2" fill="none" />
      <path d="M45 96 a5 5 0 0 1 10 0 V100 h-2.6 v-4 a2.4 2.4 0 0 0 -4.8 0 v4 H45 Z" fill="#e3b04b" />
      <rect x="42.5" y="99" width="15" height="12" rx="2" fill="#e3b04b" />
      <circle cx="50" cy="104" r="1.6" fill="#5a3a10" />
      <rect x="49.3" y="104.5" width="1.4" height="3.6" fill="#5a3a10" />
      <Arm d="M34 76 L27 106" color="#2a2d38" />
      <Arm d="M66 76 L76 92 L70 100" color="#2a2d38" />
      <rect x="66" y="84" width="11" height="18" rx="2" fill="#1e1e24" transform="rotate(12 71 93)" />
      <rect x="67.5" y="86" width="8" height="12" fill="#6fd3a0" transform="rotate(12 71 93)" />
      <text x="71.5" y="94" textAnchor="middle" fontSize="3.6" fontFamily={TYPE} fill="#1e1e24" transform="rotate(12 71 93)">2FA</text>
      <Hand x={70} y={101} wolf={wolf} look={look} />
      <Hand x={27} y={109} wolf={wolf} look={look} />
      {wolf ? (
        <WolfHead fur={look.fur} furL={look.furL} />
      ) : (
        <HumanHead skin={look.skin}>
          <path d="M45 56 h10" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </HumanHead>
      )}
      <g>
        <rect x={wolf ? 36 : 37} y={sy - 4} width="12" height="7" rx="2.4" fill="#111" />
        <rect x={wolf ? 52 : 51} y={sy - 4} width="12" height="7" rx="2.4" fill="#111" />
        <path d={`M${wolf ? 48 : 49} ${sy - 1.5} h${wolf ? 4 : 2}`} stroke="#111" strokeWidth="1.6" />
        <path d={`M${wolf ? 39 : 40} ${sy - 2.5} l3 0`} stroke="#fff" strokeWidth="0.9" opacity="0.7" />
      </g>
    </>
  );
}

function ServiceDesk({ wolf }: { wolf: boolean }) {
  const look: Look = { skin: '#f0c8a0', fur: '#595a6e', furL: '#a9aabd' };
  return (
    <>
      {wolf && <Tail look={look} />}
      <rect x="41" y="128" width="8" height="34" fill="#3d5a80" />
      <rect x="51" y="128" width="8" height="34" fill="#3d5a80" />
      <ellipse cx="44" cy="164" rx="7.4" ry="3.8" fill={wolf ? look.fur : '#f4f1ea'} />
      <ellipse cx="56" cy="164" rx="7.4" ry="3.8" fill={wolf ? look.fur : '#f4f1ea'} />
      <path d="M38 165.5 h12 M50 165.5 h12" stroke="#c43a3a" strokeWidth="1" />
      <path d="M30 73 Q50 64 70 73 L72 134 L28 134 Z" fill="#3d7fbf" />
      <path d="M44 70 L50 80 L56 70" fill="#fbf8f0" />
      <rect x="54" y="84" width="13" height="8" rx="1.5" fill="#fffaf0" />
      <text x="60.5" y="89.8" textAnchor="middle" fontSize="3.6" fontFamily={TYPE} fill="#c7353a">ASK ME</text>
      <Arm d="M33 76 L28 100 L36 108" color="#3d7fbf" />
      <Arm d="M67 76 L72 100 L64 108" color="#3d7fbf" />
      <rect x="22" y="104" width="34" height="3" rx="1" fill="#9aa1ab" transform="rotate(-6 39 106)" />
      <rect x="26" y="84" width="28" height="20" rx="1.5" fill="#b9bfc8" transform="rotate(-6 39 106)" />
      <circle cx="40" cy="94" r="3" fill="#f2c14e" transform="rotate(-6 39 106)" />
      <Hand x={36} y={108} wolf={wolf} look={look} />
      <Hand x={64} y={108} wolf={wolf} look={look} />
      {wolf ? (
        <WolfHead fur={look.fur} furL={look.furL} />
      ) : (
        <HumanHead skin={look.skin}>
          <path d="M34 40 L36 30 L41 34 L44 26 L49 32 L53 25 L57 32 L62 27 L63 34 L67 32 L66 42 Q58 33 50 34 Q40 34 34 40 Z" fill="#b5562c" />
          <path d="M44 55 q6 5 12 0" stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </HumanHead>
      )}
      <path d={wolf ? 'M28 46 Q28 18 50 18 Q72 18 72 46' : 'M31 46 Q31 24 50 24 Q69 24 69 46'} stroke="#1e1e24" strokeWidth="3" fill="none" />
      <rect x={wolf ? 24 : 27} y="42" width="7" height="11" rx="2.5" fill="#1e1e24" />
      <rect x={wolf ? 69 : 66} y="42" width="7" height="11" rx="2.5" fill="#1e1e24" />
      <path d={wolf ? 'M28 52 Q30 62 40 64' : 'M30 52 Q32 60 42 60'} stroke="#1e1e24" strokeWidth="1.6" fill="none" />
      <circle cx={wolf ? 40 : 42} cy={wolf ? 64 : 60} r="2" fill="#c43a3a" />
    </>
  );
}

/* ---------------- the leaper: a wolf in a tie, mid-pounce ---------------- */

export function LeaperArt() {
  const fur = '#4a4660';
  const furL = '#9c97b2';
  return (
    <svg viewBox="0 0 150 96" aria-hidden="true" focusable="false">
      <g filter="url(#theatre-card)">
        <path d="M112 44 Q138 38 146 16 Q140 34 118 36 Z" fill={fur} />
        <path d="M96 52 L124 76 L130 74 L104 46 Z" fill={fur} />
        <path d="M86 56 L108 86 L114 84 L94 52 Z" fill={fur} />
        <ellipse cx="80" cy="46" rx="36" ry="17" fill={fur} />
        <path d="M58 52 L30 72 L28 66 L50 46 Z" fill={fur} />
        <path d="M64 56 L42 82 L38 78 L56 50 Z" fill={fur} />
        <path d="M62 36 L60 50 L70 56 L78 40 Z" fill="#fffaf0" />
        <path d="M66 40 L71 54 L75 40 Z" fill="#c43a3a" transform="rotate(-14 70 44)" />
        <path d="M58 30 Q40 20 30 30 L10 34 L8 40 L28 44 Q36 52 54 48 Z" fill={fur} />
        <path d="M38 22 L40 6 L50 20 Z M48 22 L54 8 L58 24 Z" fill={fur} />
        <path d="M10 34 L28 36 L28 44 L8 40 Z" fill={furL} />
        <ellipse cx="9" cy="36" rx="3.4" ry="2.6" fill="#1c1726" />
        <path d="M12 41 l2 4 l2 -3.4 Z M20 42 l2 4 l2 -3.4 Z" fill="#fffaf0" />
        <g className="th-eyes" filter="url(#pc-glow)"><ellipse cx="34" cy="29" rx="4" ry="2.7" fill="#ffd84a" /></g>
        <path d="M28 25 L40 27" stroke="#1c1726" strokeWidth="2" strokeLinecap="round" />
        <rect x="84" y="44" width="16" height="10" rx="1.5" fill="#fffaf0" transform="rotate(-8 92 49)" />
        <text x="92" y="51.5" textAnchor="middle" fontSize="4.6" fontFamily="var(--ll-font-type), monospace" fill="#c43a3a" transform="rotate(-8 92 49)">HELLO</text>
      </g>
    </svg>
  );
}

/* ---------------- data ---------------- */

export interface PuppetDef {
  id: string;
  name: string;
  x: number;
  Art: (props: { wolf: boolean }) => ReactNode;
  day: string[];
  scared: string[];
  wolf: string[];
}

export const PUPPETS: PuppetDef[] = [
  {
    id: 'fieldtech', name: 'the field tech', x: 13, Art: FieldTech,
    day: ['Call before you dig… up the truth.', 'Safety first. Also, werewolves.', 'I’ve seen scarier things on a Monday site visit.'],
    scared: ['Nobody mentioned THIS in the tailgate meeting!', 'Where’s my hard hat? Oh. On my head. Phew.'],
    wolf: ['Hard hat stays on. Safety is non-negotiable.', 'Just doing a quick walk-around. Of your lunch.'],
  },
  {
    id: 'pm', name: 'the project manager', x: 27, Art: ProjectManager,
    day: ['Let’s take this offline.', 'Can we circle back after the full moon?', 'Quick sync? It’ll only take an hour.', 'I’ll add “werewolf” to the risk register.'],
    scared: ['Who owns this action item? …Who ATE this action item?', 'This was NOT on the Gantt chart!'],
    wolf: ['Per my last howl…', 'Let’s put a pin in Gary.'],
  },
  {
    id: 'erp', name: 'the ERP analyst', x: 41, Art: ErpAnalyst,
    day: ['Go-live is on track. Probably.', 'Let’s put the wolf question in the parking lot.', 'It’s not a bug, it’s a feature.'],
    scared: ['The moon was NOT in scope!', 'Nobody told me about a phase two!'],
    wolf: ['The ERP go-live is on schedule.', 'Don’t worry, it’s all in the new system. Including you.'],
  },
  {
    id: 'cio', name: 'the CIO', x: 59, Art: Cio,
    day: ['My door is always open. Please close it at night.', 'Great question. Let’s form a committee.', 'Sorry, you were on mute. Were you saying “wolf”?'],
    scared: ['Who approved this in the budget?!', 'Can someone forward me the werewolf? I mean the memo!'],
    wolf: ['Let’s circle back. As a pack.', 'This meeting could have been a howl.'],
  },
  {
    id: 'security', name: 'the security analyst', x: 73, Art: Security,
    day: ['Is MFA enabled? Multi-Fang Authentication.', 'That email looks fishy. So do you.', 'Never share your PIN. Especially with wolves.'],
    scared: ['That is NOT an approved visitor!', 'Reporting this immediately. In triplicate.'],
    wolf: ['Please badge in. With your teeth.', 'Strong password tip: “Awoo123!”'],
  },
  {
    id: 'servicedesk', name: 'the service desk analyst', x: 87, Art: ServiceDesk,
    day: ['Please submit a ticket to report a werewolf.', 'Have you tried turning the moon off and on again?', 'Your call is important to us. Please hold.'],
    scared: ['404: alibi not found.', 'Closing this ticket as “works as intended”!'],
    wolf: ['Ticket escalated. To dinner.', 'Priority one: snacks.'],
  },
];

export const LEAPER_LINES = ['AWOOO— sorry, wrong Teams channel.', 'Reply-all to the MOON!', 'Hi, I’m new. Where do I put my lunch?'];

/** Which puppets secretly are wolves, cycling each night (deterministic). */
export const WOLF_ROTA: string[][] = [
  ['pm', 'erp'],
  ['servicedesk', 'cio'],
  ['security', 'fieldtech'],
  ['erp', 'cio'],
];
