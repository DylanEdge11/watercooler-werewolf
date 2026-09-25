import type { ReactNode } from 'react';
import type { RoleKey } from './player-dashboard';

/**
 * Cut-paper role art for the role card's medallion, drawn like BrandMark:
 * flat card pieces, each role's outline repeated underneath as a dark
 * offset shadow so it reads as card stock on the plum disc.
 */

const CREAM = '#f3e6c6';
const HIGHLIGHT = '#fff6de';
const GOLD = '#e3b04b';
const GOLD_SOFT = '#ffd57c';
const LILAC = '#c9c2e6';
const SLATE = '#9a93a8';
const CURTAIN = '#b8323a';
const WINE = '#5c2330';
const INK = '#2b2118';

function Shadow({ children }: { children: ReactNode }) {
  return <g fill="#1d0508" stroke="#1d0508" opacity=".45" transform="translate(1.5 2)">{children}</g>;
}

const WOLF_HEAD = 'M15 13L25 25H39L49 13L47 29L51 38L42 40L36 50L32 52L28 50L22 40L13 38L17 29Z';
const SHIELD = 'M32 9L50 15V31C50 42 42 50 32 55C22 50 14 42 14 31V15Z';
const HEART = 'M32 52C16 40 10 32 10 24C10 16 16 11 22 11C27 11 30 14 32 18C34 14 37 11 42 11C48 11 54 16 54 24C54 32 48 40 32 52Z';

const ART: Record<RoleKey | 'HIDDEN', ReactNode> = {
  VILLAGER: <>
    <Shadow><path d="M12 30L32 13L52 30Z M17 29H47V52H17Z M40 16H45V25L40 21Z" strokeWidth="0" /></Shadow>
    <path d="M40 16H45V25L40 21Z" fill={SLATE} />
    <path d="M17 29H47V52H17Z" fill={CREAM} />
    <path d="M12 30L32 13L52 30Z" fill={CURTAIN} stroke={HIGHLIGHT} strokeOpacity=".45" strokeWidth=".8" strokeLinejoin="round" />
    <path d="M20 34H26V40H20Z M38 34H44V40H38Z" fill={GOLD_SOFT} />
    <path d="M29 41H35.5V52H29Z" fill="#7a4f2c" />
  </>,
  WEREWOLF: <>
    <circle cx="46" cy="16" r="8" fill={GOLD_SOFT} />
    <Shadow><path d={WOLF_HEAD} /></Shadow>
    <path d={WOLF_HEAD} fill="#766f86" stroke={HIGHLIGHT} strokeOpacity=".5" strokeWidth=".8" strokeLinejoin="round" />
    <path d="M18.5 18L24.5 25.5L20.5 28Z M45.5 18L39.5 25.5L43.5 28Z" fill={WINE} />
    <path d="M28 25H36L32 33Z" fill={SLATE} />
    <path d="M26 36L32 34L38 36L36.5 45.5L32 49.5L27.5 45.5Z" fill={CREAM} />
    <path d="M29.3 41.5H34.7L32 44.6Z" fill={INK} />
    <path d="M22.5 30.5L29 32.6L25.6 34.6Z M41.5 30.5L35 32.6L38.4 34.6Z" fill="#ffd84a" />
  </>,
  SEER: <>
    <Shadow><circle cx="32" cy="27" r="16" /><path d="M21 52L43 52L39 42L25 42Z" /></Shadow>
    <path d="M21 52L43 52L39 42L25 42Z" fill={GOLD} />
    <rect x="17" y="50.5" width="30" height="5" rx="1" fill={CREAM} />
    <circle cx="32" cy="27" r="16" fill={LILAC} stroke={HIGHLIGHT} strokeOpacity=".6" strokeWidth=".8" />
    <path d="M22.5 29A10 10 0 0 1 29 17.5" fill="none" stroke="#fff6dc" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M37 22.5l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z" fill={GOLD_SOFT} />
  </>,
  BODYGUARD: <>
    <Shadow><path d={SHIELD} /></Shadow>
    <path d={SHIELD} fill={CREAM} stroke={HIGHLIGHT} strokeWidth=".8" />
    <path d="M32 9L14 15V31C14 42 22 50 32 55Z" fill={CURTAIN} />
    <circle cx="32" cy="30" r="5" fill={GOLD_SOFT} stroke={INK} strokeWidth="1.4" />
  </>,
  HUNTER: <>
    <Shadow><path d="M24 8Q50 32 24 56" fill="none" strokeWidth="4.5" strokeLinecap="round" /></Shadow>
    <path d="M24 8L24 56" stroke="#fff6dc" strokeWidth="1.2" />
    <path d="M24 8Q50 32 24 56" fill="none" stroke={GOLD} strokeWidth="4.5" strokeLinecap="round" />
    <path d="M9 32H51" stroke={CREAM} strokeWidth="2.8" strokeLinecap="round" />
    <path d="M58 32L48 26.5L50.5 32L48 37.5Z" fill={LILAC} stroke={HIGHLIGHT} strokeWidth=".8" strokeLinejoin="round" />
    <path d="M9 32L5 27M9 32L5 37M14 32L10 27M14 32L10 37" stroke={CURTAIN} strokeWidth="2.4" strokeLinecap="round" />
  </>,
  MASON: <>
    <Shadow><path d="M14 17H48V26H14Z M10 28H54V37H10Z M14 39H48V48H14Z" /></Shadow>
    <path d="M14 17H30V26H14Z M32 17H48V26H32Z" fill={CURTAIN} />
    <path d="M10 28H21V37H10Z M23 28H41V37H23Z M43 28H54V37H43Z" fill="#c9564c" />
    <path d="M14 39H30V48H14Z M32 39H48V48H32Z" fill={CURTAIN} />
    <path d="M14 17H48 M10 28H54 M14 39H48" stroke={HIGHLIGHT} strokeOpacity=".4" strokeWidth=".8" />
    <path d="M40 50L52 54L49 57L38 52Z" fill={SLATE} stroke={HIGHLIGHT} strokeOpacity=".5" strokeWidth=".6" />
    <path d="M38 52L34 55" stroke="#7a4f2c" strokeWidth="2.4" strokeLinecap="round" />
  </>,
  APPRENTICE_SEER: <>
    <Shadow><path d="M8 24V51Q20 46 32 51Q44 46 56 51V24Z" /></Shadow>
    <path d="M8 24V51Q20 46 32 51Q44 46 56 51V24Z" fill={WINE} />
    <path d="M10 22Q21 17 31 22V48Q21 43 10 48Z" fill={CREAM} />
    <path d="M33 22Q43 17 54 22V48Q43 43 33 48Z" fill={CREAM} stroke={HIGHLIGHT} strokeWidth=".6" />
    <path d="M14 27.5Q20.5 25 27 27.5M14 32.5Q20.5 30 27 32.5M14 37.5Q20.5 35 27 37.5" fill="none" stroke={SLATE} strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="43.5" cy="33" r="7" fill={LILAC} />
    <path d="M43.5 28.5l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" fill={GOLD_SOFT} />
  </>,
  MAYOR: <>
    <Shadow><path d="M22 13H42V42H22Z" /><ellipse cx="32" cy="44" rx="20" ry="5" /></Shadow>
    <path d="M22 13H42V42H22Z" fill="#3a2f45" stroke={HIGHLIGHT} strokeOpacity=".5" strokeWidth=".8" />
    <path d="M22 33H42V39H22Z" fill={GOLD} />
    <ellipse cx="32" cy="44" rx="20" ry="5" fill="#3a2f45" stroke={HIGHLIGHT} strokeOpacity=".5" strokeWidth=".8" />
    <path d="M26 16V30" stroke={HIGHLIGHT} strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
    <circle cx="38" cy="36" r="4" fill={CURTAIN} stroke={GOLD_SOFT} strokeWidth="1.2" />
  </>,
  CUPID: <>
    <path d="M8 46L56 16" stroke={CREAM} strokeWidth="2.6" strokeLinecap="round" />
    <Shadow><path d={HEART} /></Shadow>
    <path d={HEART} fill="#e46a7a" stroke={HIGHLIGHT} strokeOpacity=".5" strokeWidth=".8" />
    <path d="M17 22Q18 16 23 15.5" fill="none" stroke="#fff6dc" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M22 37.3L42 24.8" stroke={CREAM} strokeWidth="2.6" strokeLinecap="round" />
    <path d="M57 15.4L51.8 24L49.4 20.2L47 16.4Z" fill={GOLD_SOFT} />
    <path d="M8 46L6 40M8 46L2 44M12 43.5L10 37.5M12 43.5L6 41.5" stroke={CURTAIN} strokeWidth="2.2" strokeLinecap="round" />
  </>,
  // A closed stage curtain: the role is concealed on this device.
  HIDDEN: <>
    <Shadow><path d="M10 10H54V52H10Z" /></Shadow>
    <path d="M12 14H32V52Q26 49 22 52Q17 49 12 52Z M32 14H52V52Q47 49 42 52Q38 49 32 52Z" fill={CURTAIN} />
    <path d="M17 16V50M22.5 16V50M27.5 16V50M36.5 16V50M41.5 16V50M47 16V50" stroke="#7d1f2a" strokeWidth="1.4" />
    <path d="M32 14V52" stroke="#1d0508" strokeOpacity=".5" strokeWidth="1.2" />
    <path d="M10 10H54V17Q48.5 21 43 17Q37.5 21 32 17Q26.5 21 21 17Q15.5 21 10 17Z" fill={WINE} stroke={GOLD} strokeWidth="1" />
  </>,
};

export default function RoleMedallion({ role, hidden = false }: { role: RoleKey | null; hidden?: boolean }) {
  // The curtain stays closed until a role is released or while the player hides it.
  const art = hidden || !role ? ART.HIDDEN : ART[role];
  return <svg className="role-medallion" viewBox="0 0 64 64" aria-hidden="true" focusable="false">{art}</svg>;
}
