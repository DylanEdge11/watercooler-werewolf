'use client';

import { useState, type AnimationEvent, type CSSProperties } from 'react';
import { mulberry32 } from '../cut';
import { HOUSE_NAME, PRESENTER } from '../branding';
import styles from './marquee.module.css';

/*
 * "Marquee" playbill: a cut-paper lightbox sign hung from two chains in the
 * fly loft. A ring of bulbs chases round the frame; the title is spelt in
 * crooked letter-board tiles (aria-hidden) with the real <h1> text alongside
 * for assistive tech. One bulb is burnt out and can be screwed back in.
 *
 * Everything random is seeded and computed at module level, so server and
 * client render the same cuts and tilts.
 */

type Style = CSSProperties & Record<`--${string}`, string | number>;

/** Hand-cut rectangle as a CSS polygon: points walk the edges and wobble inward by a few px. */
function cutRect(seed: number, perSide: number, maxIn: number): string {
  const R = mulberry32(seed);
  const d = () => (R() * maxIn).toFixed(1);
  const pts: string[] = [];
  for (let i = 0; i < perSide; i += 1) pts.push(`${((i / perSide) * 100).toFixed(1)}% ${d()}px`);
  for (let i = 0; i < perSide; i += 1) pts.push(`calc(100% - ${d()}px) ${((i / perSide) * 100).toFixed(1)}%`);
  for (let i = 0; i < perSide; i += 1) pts.push(`${(100 - (i / perSide) * 100).toFixed(1)}% calc(100% - ${d()}px)`);
  for (let i = 0; i < perSide; i += 1) pts.push(`${d()}px ${(100 - (i / perSide) * 100).toFixed(1)}%`);
  return `polygon(${pts.join(', ')})`;
}

const FRAME_CUT = cutRect(7, 14, 2.2);
const BOARD_CUT = cutRect(19, 11, 1.6);

/* Bulbs sit on the centre line of the frame band (BAND px in from the edge). */
const BAND = 7.5;
const TOP = 12;
const SIDE = 9;
const BURNT = 8; // the dud, on the top row
const FLICKER = 27; // stutters at night, on the bottom row

interface Bulb {
  i: number;
  left: string;
  top: string;
}

const BULBS: Bulb[] = (() => {
  const out: Bulb[] = [];
  const along = (t: number) => `calc(${BAND}px + ${(t * 100).toFixed(2)}% - ${(t * BAND * 2).toFixed(2)}px)`;
  const far = `calc(100% - ${BAND}px)`;
  const near = `${BAND}px`;
  let i = 0;
  for (let k = 0; k < TOP; k += 1) out.push({ i: i++, left: along(k / (TOP - 1)), top: near });
  for (let k = 1; k <= SIDE; k += 1) out.push({ i: i++, left: far, top: along(k / (SIDE + 1)) });
  for (let k = TOP - 1; k >= 0; k -= 1) out.push({ i: i++, left: along(k / (TOP - 1)), top: far });
  for (let k = SIDE; k >= 1; k -= 1) out.push({ i: i++, left: near, top: along(k / (SIDE + 1)) });
  return out;
})();

interface Tile {
  ch: string;
  style: Style;
}

function tiles(word: string, seed: number): Tile[] {
  const R = mulberry32(seed);
  return [...word].map((ch) => ({
    ch,
    style: {
      '--rot': `${((R() - 0.5) * 7).toFixed(1)}deg`,
      '--dy': `${((R() - 0.5) * 2.4).toFixed(1)}px`,
      '--tone': `${(R() * 5).toFixed(1)}%`,
    },
  }));
}

const ROW_A = tiles('WATERCOOLER', 31);
const ROW_B = tiles('WEREWOLF', 57);
const LOOSE = 5; // the O in WOLF: click it and it falls off the board
ROW_B[LOOSE].style = { '--rot': '0deg', '--dy': '0px', '--tone': '1%' };

/* on -> falling -> gone -> hanging -> on */
type OState = 'on' | 'falling' | 'gone' | 'hanging';

/** One chain: alternating face-on and edge-on links, drawn bottom-up so the bottom link meets the sign. */
const LINKS = 9;
const LINK = 15;
function Chain({ className }: { className: string }) {
  const h = LINKS * LINK + 6;
  return (
    <svg className={className} viewBox={`0 0 14 ${h}`} width="14" height={h} aria-hidden="true" focusable="false">
      {Array.from({ length: LINKS }, (_, k) => {
        const y = h - 3 - k * LINK - LINK / 2 - 1;
        return k % 2 === 0 ? (
          <rect key={k} x="2.2" y={y - 7.8} width="9.6" height="15.6" rx="4.8" className="ring" />
        ) : (
          <rect key={k} x="5.3" y={y - 8.6} width="3.4" height="17.2" rx="1.7" className="bar" />
        );
      })}
    </svg>
  );
}

export default function MarqueePlaybill({ night }: { night: boolean }) {
  const [fixed, setFixed] = useState(false);
  const [o, setO] = useState<OState>('on');

  const knock = () => {
    if (o === 'on') setO('falling');
    else if (o === 'gone') setO('hanging');
  };
  const settle = (e: AnimationEvent) => {
    if (o === 'falling' && e.animationName.includes('fall')) setO('gone');
    else if (o === 'hanging' && e.animationName.includes('hang')) setO('on');
  };

  return (
    <div className={styles.wrap} data-night={night}>
      <div className={styles.swing}>
        <Chain className={`${styles.chain} ${styles.chainL}`} />
        <Chain className={`${styles.chain} ${styles.chainR}`} />
        <p className={styles.crest}>
          <span>Now playing</span>
        </p>

        <div className={styles.sign}>
          <span className={styles.frame} style={{ clipPath: FRAME_CUT }} aria-hidden="true" />

          {BULBS.map((b) => {
            const style: Style = { left: b.left, top: b.top, '--i': b.i };
            if (b.i === BURNT) {
              return (
                <button
                  key={b.i}
                  type="button"
                  className={`${styles.bulb} ${styles.dud}`}
                  data-fixed={fixed}
                  style={style}
                  aria-label={fixed ? 'Bulb replaced' : 'Replace the burnt-out bulb'}
                  aria-disabled={fixed}
                  onClick={() => setFixed(true)}
                />
              );
            }
            if (b.i === FLICKER) {
              return <span key={b.i} className={`${styles.bulb} ${styles.flicker}`} style={style} aria-hidden="true" />;
            }
            // perf: the chase flips two pre-painted looks by opacity (compositor-only)
            return (
              <span key={b.i} className={styles.lamp} style={style} aria-hidden="true">
                <span className={styles.lampOff} />
              </span>
            );
          })}

          <div className={styles.boardShade}>
            <div className={styles.board}>
              <span className={styles.boardBg} style={{ clipPath: BOARD_CUT }} aria-hidden="true" />
              <p className={styles.house}>{HOUSE_NAME}</p>

              <h1 className={styles.sr}>Watercooler Werewolf</h1>
              <div className={styles.letters}>
                <span className={styles.row} aria-hidden="true">
                  {ROW_A.map((t, k) => (
                    <span key={k} className={styles.tile} style={t.style}>{t.ch}</span>
                  ))}
                </span>
                <span className={`${styles.row} ${styles.rowB}`}>
                  {ROW_B.map((t, k) =>
                    k === LOOSE ? (
                      <button
                        key={k}
                        type="button"
                        className={styles.slot}
                        data-o={o}
                        onClick={knock}
                        onAnimationEnd={settle}
                        aria-label={o === 'gone' || o === 'hanging' ? 'Hang a fresh O back on' : 'Knock the O loose'}
                      >
                        <span className={`${styles.tile} ${styles.loose}`} style={t.style} aria-hidden="true">
                          {t.ch}
                        </span>
                      </button>
                    ) : (
                      <span key={k} className={styles.tile} style={t.style} aria-hidden="true">{t.ch}</span>
                    ),
                  )}
                </span>
              </div>

              <p className={styles.pitch}>A month of suspicion.</p>
            </div>
          </div>
        </div>

        <p className={styles.presenter}>{PRESENTER}</p>
      </div>
    </div>
  );
}
