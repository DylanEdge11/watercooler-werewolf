'use client';

import type { CSSProperties, ReactNode } from 'react';
import { mulberry32 } from './cut';
import { PRESENTER } from './branding';
import { Bat, Cloud, Moon, Star, Sun } from './fly';
import Proscenium, { Footlights } from './proscenium';
import { LEAPER_LINES, LeaperArt, PUPPETS } from './puppets';
import {
  CottageRow, CurtainCloth, DayBackcloth, DayWing, ForestFlat, NightBackcloth, NightWing, StageFloor, Valance, Well,
} from './set-pieces';
import styles from '../theatre.module.css';

/**
 * Everything inside the theatre frame: backcloths, hanging pieces, puppets,
 * curtains, and the proscenium. Phones never show it (theatre.module.css),
 * so TheatreScene loads this only on a screen large enough, after the page
 * with the marquee and the sign-in ticket has rendered.
 */

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* ---------- deterministic particles ---------- */
const P = mulberry32(90210);
const pr = (a: number, b: number) => a + (b - a) * P();
const DUST = Array.from({ length: 18 }, () => ({ x: pr(4, 96), y: pr(0, 30), s: pr(2, 4.5), d: pr(7, 13), l: -pr(0, 12), r: pr(-40, 40) }));
const FIREFLIES = Array.from({ length: 12 }, () => ({ x: pr(6, 94), y: pr(30, 70), d: pr(5, 9), l: -pr(0, 8), dx: pr(-6, 6), dy: pr(-8, 4) }));
interface Hanger { key: string; when: 'day' | 'night'; x: string; len: number; size: number; delay: [number, number]; sd: number; node: ReactNode }
const HANGERS: Hanger[] = [
  { key: 'sun', when: 'day', x: '29%', len: 7, size: 15, delay: [0.05, 0.75], sd: 5.4, node: <Sun /> },
  { key: 'c1', when: 'day', x: '52%', len: 3, size: 13, delay: [0.15, 0.95], sd: 4.6, node: <Cloud /> },
  { key: 'c2', when: 'day', x: '71%', len: 11, size: 10, delay: [0.25, 1.05], sd: 5.9, node: <Cloud variant={1} /> },
  { key: 'c3', when: 'day', x: '90%', len: 2, size: 8, delay: [0.3, 1.15], sd: 4.2, node: <Cloud /> },
  { key: 'moon', when: 'night', x: '74%', len: 8, size: 14, delay: [0.55, 0.05], sd: 6.2, node: <Moon /> },
  { key: 's1', when: 'night', x: '12%', len: 8, size: 4.5, delay: [0.7, 0.1], sd: 3.8, node: <Star /> },
  { key: 's2', when: 'night', x: '28%', len: 18, size: 3.6, delay: [0.8, 0.12], sd: 4.4, node: <Star /> },
  { key: 's3', when: 'night', x: '52%', len: 4, size: 4, delay: [0.9, 0.14], sd: 3.5, node: <Star /> },
  { key: 's4', when: 'night', x: '60%', len: 20, size: 3.2, delay: [1.0, 0.16], sd: 4.9, node: <Star /> },
  { key: 's5', when: 'night', x: '91%', len: 14, size: 4.2, delay: [1.05, 0.18], sd: 4.1, node: <Star /> },
  { key: 'bat', when: 'night', x: '38%', len: 24, size: 7, delay: [1.2, 0.2], sd: 2.6, node: <Bat /> },
];

function Tassel() {
  return (
    <svg viewBox="0 0 40 110" aria-hidden="true" focusable="false">
      <path d="M2 10 Q20 26 38 10" stroke="#8a6424" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M2 10 Q20 26 38 10" stroke="#e3b04b" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeDasharray="3 2" />
      <path d="M20 19 V44" stroke="#c99a3e" strokeWidth="2.6" />
      <circle cx="20" cy="48" r="7" fill="#e3b04b" />
      <path d="M13 52 Q20 46 27 52 L31 92 Q20 98 9 92 Z" fill="#c99a3e" />
      <path d="M12 60 L10 92 M15 60 L14 94 M18 60 L18 95 M21 60 L22 95 M24 60 L26 94 M27 60 L30 92" stroke="#8a6424" strokeWidth="1" />
      <path d="M12 58 H28" stroke="#fbe6a6" strokeWidth="2.4" />
    </svg>
  );
}

function Defs() {
  return (
    <svg className={styles.defs} aria-hidden="true" focusable="false">
      <defs>
        <filter id="theatre-sh" x="-10%" y="-10%" width="120%" height="130%" colorInterpolationFilters="sRGB">
          <feOffset in="SourceAlpha" dy="-1" result="up" />
          <feFlood floodColor="#fff6de" floodOpacity="0.45" />
          <feComposite in2="up" operator="in" result="edge" />
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="blur" />
          <feOffset in="blur" dy="3" result="off" />
          <feFlood floodColor="#1d0f05" floodOpacity="0.42" />
          <feComposite in2="off" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="theatre-card" x="-15%" y="-10%" width="130%" height="120%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius="2.6" result="fat" />
          <feFlood floodColor="#fbf4e2" />
          <feComposite in2="fat" operator="in" result="card" />
          <feMerge>
            <feMergeNode in="card" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="theatre-sky-day" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="tst-sky1" />
          <stop offset="0.7" className="tst-sky2" />
        </linearGradient>
        <linearGradient id="theatre-sky-night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1236" />
          <stop offset="0.6" stopColor="#252a69" />
          <stop offset="1" stopColor="#3a3f8a" />
        </linearGradient>
        <linearGradient id="theatre-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c08a52" />
          <stop offset="0.5" stopColor="#8a5a30" />
          <stop offset="1" stopColor="#5a3a1c" />
        </linearGradient>
        <linearGradient id="theatre-floor-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d0f05" stopOpacity="0.45" />
          <stop offset="1" stopColor="#1d0f05" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="theatre-fold" x1="0" y1="0" x2="0.125" y2="0" spreadMethod="repeat">
          <stop offset="0" className="tst-fold-d" />
          <stop offset="0.35" className="tst-fold-m" />
          <stop offset="0.55" className="tst-fold-h" />
          <stop offset="1" className="tst-fold-d" />
        </linearGradient>
        <linearGradient id="theatre-fold-swag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="tst-fold-d" />
          <stop offset="0.6" className="tst-fold-h" />
          <stop offset="1" className="tst-fold-m" />
        </linearGradient>
        <linearGradient id="theatre-curtain-edge-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.8" stopColor="#1d0508" stopOpacity="0" />
          <stop offset="1" stopColor="#1d0508" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="theatre-curtain-edge-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0.8" stopColor="#1d0508" stopOpacity="0" />
          <stop offset="1" stopColor="#1d0508" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id="theatre-moon-halo">
          <stop offset="0.5" stopColor="#fff2c4" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff2c4" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function sentence(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface TheatreStageProps {
  night: boolean;
  /** This night's secret wolves. */
  wolves: readonly string[];
  talk: { id: string; line: string; n: number } | null;
  closed: boolean;
  speak: (id: string, pool: string[]) => void;
  pullCord: () => void;
}

export default function TheatreStage({ night, wolves, talk, closed, speak, pullCord }: TheatreStageProps) {
  const jumpOf = (id: string) => (talk?.id === id ? (talk.n % 2 ? 'a' : 'b') : undefined);

  return (
    <>
      <Defs />
          <div className={styles.box}>
            <div className={`${styles.L} ${styles.clothDay}`} style={{ '--d': '0s' } as Vars}><DayBackcloth /></div>
            <div className={`${styles.L} ${styles.clothNight}`}><NightBackcloth /></div>

            <div className={`${styles.L} ${styles.fly}`}  aria-hidden="true">
              {HANGERS.map((h) => (
                <div
                  key={h.key}
                  className={styles.hang}
                  data-when={h.when}
                  style={{ '--x': h.x, '--len': `${h.len}cqh`, '--size': `${h.size}cqw`, '--hd-n': `${h.delay[0]}s`, '--hd-d': `${h.delay[1]}s`, '--sd': `${h.sd}s` } as Vars}
                >
                  <div className={styles.swing}>
                    <span className={styles.string} />
                    <div className={styles.obj}>{h.node}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className={`${styles.L} ${styles.forest} ${styles.forestL}`}><ForestFlat side="l" /></div>
            <div className={`${styles.L} ${styles.forest} ${styles.forestR}`}><ForestFlat side="r" /></div>
            <div className={`${styles.L} ${styles.cut}`} style={{ '--d': '0.1s', '--sh': 3 } as Vars}><CottageRow /></div>
            <div className={styles.L} style={{ '--d': '0.2s' } as Vars}><StageFloor /></div>
            <div className={`${styles.L} ${styles.cut}`} style={{ '--d': '0.3s', '--sh': 4 } as Vars}><Well /></div>
            <div className={styles.moonbeam} aria-hidden="true" />
            <div className={`${styles.L} ${styles.cut} ${styles.wing} ${styles.wingDayL}`} style={{ '--d': '0.4s', '--sh': 6 } as Vars}><DayWing side="l" /></div>
            <div className={`${styles.L} ${styles.cut} ${styles.wing} ${styles.wingDayR}`} style={{ '--d': '0.4s', '--sh': 6 } as Vars}><DayWing side="r" /></div>
            <div className={`${styles.L} ${styles.cut} ${styles.wing} ${styles.wingNightL}`} style={{ '--sh': 6 } as Vars}><NightWing side="l" /></div>
            <div className={`${styles.L} ${styles.cut} ${styles.wing} ${styles.wingNightR}`} style={{ '--sh': 6 } as Vars}><NightWing side="r" /></div>

            <div className={`${styles.L} ${styles.cast}`}>
              {PUPPETS.map((p, i) => {
                const wolfIndex = wolves.indexOf(p.id);
                const isWolf = night && wolfIndex !== -1;
                const scared = night && !isWolf;
                const pool = isWolf ? p.wolf : scared ? p.scared : p.day;
                const align = p.x < 25 ? 'l' : p.x > 75 ? 'r' : 'c';
                return (
                  <div
                    key={p.id}
                    className={styles.slot}
                    data-wolf={isWolf}
                    data-scared={scared}
                    style={{
                      '--x': `${p.x}%`,
                      '--bd': `${2.8 + (i % 3) * 0.45}s`,
                      '--bl': `${-i * 0.7}s`,
                      '--fd': `${1.0 + Math.max(0, wolfIndex) * 0.5}s`,
                      '--fdd': `${0.1 + Math.max(0, wolfIndex) * 0.25}s`,
                      '--gd': `${1.7 + i * 0.09}s`,
                    } as Vars}
                  >
                    <div className={styles.bob}>
                      <div className={styles.jump} data-jump={jumpOf(p.id)}>
                        <div className={styles.shake}>
                          <div className={styles.hop}>
                            <span className={styles.rod} aria-hidden="true" />
                            <button
                              type="button"
                              className={styles.card}
                              aria-label={`${sentence(p.name)} stick puppet${isWolf ? ', revealed as a werewolf' : ''}. Press to hear a line.`}
                              onClick={() => speak(p.id, pool)}
                            >
                              <span className={styles.spinner}>
                                <span className={styles.face}>
                                  <svg viewBox="0 0 100 170" aria-hidden="true" focusable="false"><g filter="url(#theatre-card)"><p.Art wolf={false} /></g></svg>
                                </span>
                                <span className={`${styles.face} ${styles.back}`}>
                                  <svg viewBox="0 0 100 170" aria-hidden="true" focusable="false"><g filter="url(#theatre-card)"><p.Art wolf /></g></svg>
                                </span>
                              </span>
                            </button>
                            <span className={styles.gasp} aria-hidden="true">!</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {talk?.id === p.id && <p className={styles.bubble} data-align={align} aria-hidden="true">{talk.line}</p>}
                  </div>
                );
              })}

              <div className={styles.leaper} data-on={night} inert={!night}>
                <div className={styles.leapX}>
                  <div className={styles.leapY}>
                    <div className={styles.jump} data-jump={jumpOf('leaper')}>
                      <span className={`${styles.rod} ${styles.rodLong}`} aria-hidden="true" />
                      <button type="button" className={styles.leapCard} aria-label="A werewolf in a tie, perched on the well. Press to hear a line." onClick={() => speak('leaper', LEAPER_LINES)}>
                        <LeaperArt />
                      </button>
                    </div>
                  </div>
                </div>
                {talk?.id === 'leaper' && <p className={styles.bubble} data-align="below" aria-hidden="true">{talk.line}</p>}
              </div>
            </div>

            <div className={styles.particles} aria-hidden="true">
              {DUST.map((m, i) => (
                <span key={`d${i}`} className={styles.dust} style={{ '--x': `${m.x}%`, '--y': `${m.y}%`, '--s': `${m.s}px`, '--du': `${m.d}s`, '--dl': `${m.l}s`, '--r': `${m.r}deg` } as Vars} />
              ))}
              {FIREFLIES.map((f, i) => (
                <span key={`f${i}`} className={styles.firefly} style={{ '--x': `${f.x}%`, '--y': `${f.y}%`, '--du': `${f.d}s`, '--dl': `${f.l}s`, '--fx': `${f.dx}cqw`, '--fy': `${f.dy}cqh` } as Vars} />
              ))}
            </div>
            <div className={styles.haze} aria-hidden="true" />

            <div className={`${styles.curtain} ${styles.curtainL}`} aria-hidden="true"><CurtainCloth side="l" /></div>
            <div className={`${styles.curtain} ${styles.curtainR}`} aria-hidden="true"><CurtainCloth side="r" /></div>
            <div className={styles.interval} aria-hidden="true">
              <span className={styles.intervalStrings} />
              <p>Scheduled maintenance</p>
              <span className={styles.intervalHand}>Currently in a change window</span>
              <small>{PRESENTER}</small>
            </div>
            <div className={styles.valance} aria-hidden="true"><Valance /></div>
            {closed && (
              <button type="button" className={styles.reopen} onClick={pullCord} aria-label="End the change window: reopen the curtain" />
            )}
            <button
              type="button"
              className={styles.tassel}
              onClick={pullCord}
              aria-pressed={closed}
              aria-label={closed ? 'End the change window: reopen the curtain' : 'Close the curtain for scheduled maintenance'}
            >
              <Tassel />
            </button>
          </div>
          <div className={`${styles.sheet} ${styles.frame}`}><Proscenium /></div>
          <div className={`${styles.sheet} ${styles.lamps}`}><Footlights /></div>
    </>
  );
}
