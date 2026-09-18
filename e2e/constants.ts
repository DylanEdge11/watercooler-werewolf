import type { RoleComposition } from '../lib/game/types';

export const BASE_URL = process.env.E2E_BASE_URL?.trim() || 'http://localhost:3100';
export const MODERATOR_EMAIL = 'playwright-owner@e2e.test';
export const MODERATOR_PASSWORD = 'playwright-e2e-password-2026';

export const DEFAULT_COMPOSITION: RoleComposition = {
  VILLAGER: 12,
  WEREWOLF: 3,
  SEER: 1,
  BODYGUARD: 1,
  HUNTER: 1,
  MASON: 2,
};

export const WEREWOLF_HEAVY_COMPOSITION: RoleComposition = {
  VILLAGER: 6,
  WEREWOLF: 9,
  SEER: 1,
  BODYGUARD: 1,
  HUNTER: 1,
  MASON: 2,
};
