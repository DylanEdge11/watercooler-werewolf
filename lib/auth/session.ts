import { cookies } from 'next/headers';
import { ensureDatabase } from '../../db/migrate';
import { getDb } from '../../db';
import { randomToken, sha256 } from './crypto';

const MODERATOR_COOKIE = 'ww_mod_session';
const PLAYER_COOKIE = 'ww_player_session';
export const SPECTATOR_COOKIE = 'ww_spectator_session';
const SESSION_DAYS = 7;

export interface ModeratorIdentity {
  id: string;
  email: string;
}

export interface SpectatorIdentity {
  spectatorId: string;
  gameId: string;
  displayName: string;
}

export interface PlayerIdentity {
  seatId: string;
  gameId: string;
  displayName: string;
  alive: boolean;
}

function expiryDate(): Date {
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + SESSION_DAYS);
  return expires;
}

async function setSessionCookie(name: string, token: string, expires: Date): Promise<void> {
  const store = await cookies();
  store.set(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  });
  // One device shows one game view: signing in as a player ends a spectator
  // session there, and the other way round.
  if (name === PLAYER_COOKIE) store.delete(SPECTATOR_COOKIE);
  if (name === SPECTATOR_COOKIE) store.delete(PLAYER_COOKIE);
}

export async function createModeratorSession(moderatorId: string): Promise<void> {
  await ensureDatabase();
  const db = getDb();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = expiryDate();
  await db
    .prepare(
      'INSERT INTO moderator_sessions (id, moderator_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), moderatorId, tokenHash, expires.toISOString(), new Date().toISOString())
    .run();
  await setSessionCookie(MODERATOR_COOKIE, token, expires);
}

export async function createPlayerSession(seatId: string, sessionVersion: number): Promise<void> {
  await ensureDatabase();
  const session = await preparePlayerSession(seatId, sessionVersion);
  await getDb()
    .prepare(
      'INSERT INTO seat_sessions (id, seat_id, token_hash, session_version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(...session.values)
    .run();
  await session.setCookie();
}

/**
 * A player session that a caller inserts inside its own transaction (for
 * example together with a seat claim). Set the cookie only after that
 * transaction commits.
 */
export async function preparePlayerSession(seatId: string, sessionVersion: number): Promise<{
  values: [string, string, string, number, string, string];
  setCookie: () => Promise<void>;
}> {
  const token = randomToken();
  const expires = expiryDate();
  return {
    values: [crypto.randomUUID(), seatId, await sha256(token), sessionVersion, expires.toISOString(), new Date().toISOString()],
    setCookie: () => setSessionCookie(PLAYER_COOKIE, token, expires),
  };
}

/**
 * A spectator session a caller inserts inside its own transaction (for
 * example together with the spectator's first sign-in). Set the cookie only
 * after that transaction commits.
 */
export async function prepareSpectatorSession(spectatorId: string, sessionVersion: number): Promise<{
  values: [string, string, string, number, string, string];
  setCookie: () => Promise<void>;
}> {
  const token = randomToken();
  const expires = expiryDate();
  return {
    values: [crypto.randomUUID(), spectatorId, await sha256(token), sessionVersion, expires.toISOString(), new Date().toISOString()],
    setCookie: () => setSessionCookie(SPECTATOR_COOKIE, token, expires),
  };
}

export async function getCurrentSpectator(): Promise<SpectatorIdentity | null> {
  await ensureDatabase();
  const token = (await cookies()).get(SPECTATOR_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256(token);
  return (
    (await getDb()
      .prepare(
        `SELECT sp.id AS spectatorId, sp.game_id AS gameId, sp.display_name AS displayName
         FROM spectator_sessions ss
         JOIN spectators sp ON sp.id = ss.spectator_id
         WHERE ss.token_hash = ?
           AND ss.expires_at > ?
           AND ss.session_version = sp.session_version
           AND sp.status = 'ACTIVE'
         LIMIT 1`,
      )
      .bind(tokenHash, new Date().toISOString())
      .first<SpectatorIdentity>()) ?? null
  );
}

export async function getCurrentModerator(): Promise<ModeratorIdentity | null> {
  await ensureDatabase();
  const token = (await cookies()).get(MODERATOR_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256(token);
  return (
    (await getDb()
      .prepare(
        `SELECT ma.id, ma.email
         FROM moderator_sessions ms
         JOIN moderator_accounts ma ON ma.id = ms.moderator_id
         WHERE ms.token_hash = ? AND ms.expires_at > ?
         LIMIT 1`,
      )
      .bind(tokenHash, new Date().toISOString())
      .first<ModeratorIdentity>()) ?? null
  );
}

export async function getCurrentPlayer(): Promise<PlayerIdentity | null> {
  await ensureDatabase();
  const token = (await cookies()).get(PLAYER_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256(token);
  return (
    (await getDb()
      .prepare(
        `SELECT s.id AS seatId, s.game_id AS gameId, s.display_name AS displayName, s.alive AS alive
         FROM seat_sessions ss
         JOIN seats s ON s.id = ss.seat_id
         WHERE ss.token_hash = ?
           AND ss.expires_at > ?
           AND ss.session_version = s.session_version
           AND s.status = 'CLAIMED'
         LIMIT 1`,
      )
      .bind(tokenHash, new Date().toISOString())
      .first<PlayerIdentity>()) ?? null
  );
}

export async function clearModeratorSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(MODERATOR_COOKIE)?.value;
  if (token) {
    await ensureDatabase();
    await getDb()
      .prepare('DELETE FROM moderator_sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  }
  store.delete(MODERATOR_COOKIE);
}

export async function clearPlayerSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(PLAYER_COOKIE)?.value;
  if (token) {
    await ensureDatabase();
    await getDb()
      .prepare('DELETE FROM seat_sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  }
  store.delete(PLAYER_COOKIE);
}


export async function clearSpectatorSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SPECTATOR_COOKIE)?.value;
  if (token) {
    await ensureDatabase();
    await getDb()
      .prepare('DELETE FROM spectator_sessions WHERE token_hash = ?')
      .bind(await sha256(token))
      .run();
  }
  store.delete(SPECTATOR_COOKIE);
}
