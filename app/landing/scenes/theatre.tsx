'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import SignInCard from '../sign-in-card';
import MarqueePlaybill from './theatre/playbills/marquee';
import { WOLF_ROTA } from './theatre/puppets';
import styles from './theatre.module.css';

// The stage and audience are hidden on phones (theatre.module.css), so they
// load only where they show: phones get the marquee and the sign-in ticket
// without the stage's HTML or its JavaScript.
const TheatreStage = dynamic(() => import('./theatre/stage'), { ssr: false });
const Audience = dynamic(() => import('./theatre/audience'), { ssr: false });
const STAGE_QUERY = '(min-width: 721px) and (min-height: 501px)';

function subscribeToStageQuery(onChange: () => void): () => void {
  const query = window.matchMedia(STAGE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Whether the screen is large enough for the stage; false while server rendering. */
function useStageVisible(): boolean {
  return useSyncExternalStore(subscribeToStageQuery, () => window.matchMedia(STAGE_QUERY).matches, () => false);
}

export interface TheatreSceneProps {
  /** false = day (villagers), true = night (some of them are wolves). */
  night: boolean;
}

export default function TheatreScene({ night }: TheatreSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const talkTimer = useRef<number | undefined>(undefined);

  // Each new night deals a fresh pair of secret wolves (adjusting state during render, not in an effect).
  const [prevNight, setPrevNight] = useState(night);
  const [round, setRound] = useState(night ? 1 : 0);
  // Which set of pieces has finished leaving the stage ('' while the scene changes).
  // CSS pauses the swings, flaps and fireflies that are hidden in the flies.
  const [offstage, setOffstage] = useState<'day' | 'night' | ''>(night ? 'day' : 'night');
  if (night !== prevNight) {
    setPrevNight(night);
    setOffstage('');
    if (night) setRound((r) => r + 1);
  }
  const wolves = WOLF_ROTA[(Math.max(round, 1) - 1) % WOLF_ROTA.length];

  const [talk, setTalk] = useState<{ id: string; line: string; n: number } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [closed, setClosed] = useState(false);
  const showStage = useStageVisible();

  // Everything has left the stage by ~3 s (the slowest hang drop is 1.6 s after a 1.2 s delay).
  useEffect(() => {
    const settle = window.setTimeout(() => setOffstage(night ? 'day' : 'night'), 3500);
    return () => window.clearTimeout(settle);
  }, [night]);

  // Pause the stage's animations while it is scrolled out of view (portrait tablets).
  const [stageInView, setStageInView] = useState(true);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setStageInView(entry.isIntersecting));
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(talkTimer.current);
    };
  }, []);

  // Paper grain (procedural noise), generated once on mount.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(200, 200);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = 120 + Math.random() * 110;
          img.data[i] = v;
          img.data[i + 1] = v * 0.95;
          img.data[i + 2] = v * 0.86;
          img.data[i + 3] = Math.random() * 46;
        }
        ctx.putImageData(img, 0, 0);
        ctx.strokeStyle = 'rgba(90, 64, 36, 0.16)';
        ctx.lineWidth = 0.6;
        for (let k = 0; k < 40; k += 1) {
          const x = Math.random() * 200;
          const y = Math.random() * 200;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + Math.random() * 10 - 5, y + Math.random() * 10 - 5, x + Math.random() * 16 - 8, y + Math.random() * 16 - 8);
          ctx.stroke();
        }
        root.style.setProperty('--th-grain', `url(${canvas.toDataURL()})`);
        // The full-screen overlay used to multiply this texture over the scene,
        // and a blend mode makes the compositor redo the whole screen every frame.
        // Multiplying by a colour c at alpha a darkens by a*(1-c), which is the same
        // as laying black at alpha a*(1-c) over it with normal blending.
        const paper = ctx.getImageData(0, 0, 200, 200);
        for (let i = 0; i < paper.data.length; i += 4) {
          paper.data[i + 3] = Math.round(paper.data[i + 3] * (1 - paper.data[i + 1] / 255));
          paper.data[i] = 0;
          paper.data[i + 1] = 0;
          paper.data[i + 2] = 0;
        }
        ctx.putImageData(paper, 0, 0);
        root.style.setProperty('--th-grain-overlay', `url(${canvas.toDataURL()})`);
      }
    } catch {
      /* grain is decoration only */
    }
  }, []);

  function speak(id: string, pool: string[]) {
    const n = counts[id] ?? 0;
    const line = pool[n % pool.length];
    setCounts((c) => ({ ...c, [id]: n + 1 }));
    setTalk((t) => ({ id, line, n: (t?.n ?? 0) + 1 }));
    window.clearTimeout(talkTimer.current);
    talkTimer.current = window.setTimeout(() => setTalk(null), 3400);
  }

  // The curtain stays down (a change window) until someone pulls the cord again.
  function pullCord() {
    setClosed((c) => !c);
  }



  return (
    <div
      ref={rootRef}
      className={styles.scene}
      data-night={night}
      data-curtain={closed ? 'closed' : 'open'}
      data-offstage={offstage}
      data-stage={stageInView ? 'on' : 'off'}
    >
      <div className={styles.wall} aria-hidden="true">
        <div className={styles.wallNight} />
        <div className={styles.wallGlow} />
      </div>

      <header className={styles.playbill}>
        <MarqueePlaybill night={night} />
        <span className={styles.claws} aria-hidden="true" />
      </header>

      <div className={styles.stageWrap}>
      <div ref={stageRef} className={styles.theatre}>
        {showStage && <TheatreStage night={night} wolves={wolves} talk={talk} closed={closed} speak={speak} pullCord={pullCord} />}
      </div>

      <div className={styles.audience} aria-hidden="true">{showStage && <Audience />}</div>
      </div>

      <div className={styles.ticket}>
        <div className={styles.ticketPaper}>
          <div className={styles.stub} aria-hidden="true">
            <span className={styles.admit}>ADMIT ONE</span>
            <span className={styles.serial}>Nº 000040</span>
          </div>
          <SignInCard
            night={night}
            className={styles.signin}
            kicker={night ? 'Late show · Row G · Seat unknown' : 'Matinee · Row G · Seat reserved'}
          />
        </div>
      </div>

      <p className={styles.srOnly} aria-live="polite">{talk ? talk.line : ''}</p>
      <div className={styles.grain} aria-hidden="true" />
    </div>
  );
}
