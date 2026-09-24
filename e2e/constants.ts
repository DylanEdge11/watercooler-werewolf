import type { RoleComposition } from '../lib/game/types';

function normalizedBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('E2E_BASE_URL must use http:// or https://.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new Error('E2E_BASE_URL must be an origin without credentials, a path, a query, or a fragment.');
  }
  return parsed.origin;
}

export const BASE_URL = normalizedBaseUrl(process.env.E2E_BASE_URL?.trim() || 'http://localhost:3100');
export const BASE_ORIGIN = new URL(BASE_URL).origin;
export const E2E_REMOTE = process.env.E2E_REMOTE === '1';
export const E2E_RUN_ID = (process.env.E2E_RUN_ID?.trim() || 'local').replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 80);
export const MODERATOR_EMAIL = (process.env.E2E_MODERATOR_EMAIL?.trim() || 'playwright-owner@e2e.test').toLowerCase();
export const MODERATOR_PASSWORD = process.env.E2E_MODERATOR_PASSWORD || 'playwright-e2e-password-2026';
// Only hosted runs need the bypass. Cloud sessions keep it in the environment,
// so local runs would otherwise send it to localhost and into failure reports.
export const VERCEL_AUTOMATION_BYPASS_SECRET = E2E_REMOTE ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || '' : '';
export const E2E_PLAYER_COUNT = 20;

export const DEFAULT_COMPOSITION: RoleComposition = {
  VILLAGER: 12,
  WEREWOLF: 3,
  SEER: 1,
  BODYGUARD: 1,
  HUNTER: 1,
  MASON: 2,
  APPRENTICE_SEER: 0,
  MAYOR: 0,
  CUPID: 0,
};

export const WEREWOLF_HEAVY_COMPOSITION: RoleComposition = {
  VILLAGER: 6,
  WEREWOLF: 9,
  SEER: 1,
  BODYGUARD: 1,
  HUNTER: 1,
  MASON: 2,
  APPRENTICE_SEER: 0,
  MAYOR: 0,
  CUPID: 0,
};
