import { getDb } from '@/db';
import { ensureDatabase } from '@/db/migrate';
import { changes } from '@/db/results';
import { requireGameOwner } from '@/lib/auth/authorization';
import { removeCoModeratorStatements, transferOwnershipStatements } from '@/lib/auth/game-moderators';
import { assertSameOrigin } from '@/lib/http/security';
import { HttpError, routeError } from '@/lib/http/errors';
import type { RouteContext } from '@/lib/http/route-context';

const STALE = 'That moderator is no longer a co-moderator of this game. Refresh and try again.';

/** The owner removes a co-moderator from this game. */
export async function DELETE(request: Request, context: RouteContext<{ gameId: string; moderatorId: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, moderatorId } = await context.params;
    const owner = await requireGameOwner(gameId, 'remove co-moderators');
    if (moderatorId === owner.id) throw new HttpError(400, 'The owner can’t be removed. Make another moderator the owner first.');
    const db = getDb();
    const results = await db.batch(removeCoModeratorStatements(db, { gameId, ownerId: owner.id, moderatorId, eventId: crypto.randomUUID(), now: new Date().toISOString() }));
    if (changes(results[0]) !== 1) throw new HttpError(409, STALE);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to remove the co-moderator.');
  }
}

/** The owner makes a co-moderator the owner (`{ role: 'OWNER' }`) and stays on as a co-moderator. */
export async function PATCH(request: Request, context: RouteContext<{ gameId: string; moderatorId: string }>) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId, moderatorId } = await context.params;
    const owner = await requireGameOwner(gameId, 'transfer ownership');
    const body = (await request.json()) as { role?: unknown };
    if (body.role !== 'OWNER') throw new Error('Only a transfer of ownership is supported.');
    if (moderatorId === owner.id) throw new HttpError(400, 'You already own this game.');
    const db = getDb();
    const results = await db.batch(transferOwnershipStatements(db, { gameId, ownerId: owner.id, moderatorId, eventId: crypto.randomUUID(), now: new Date().toISOString() }));
    if (changes(results[0]) !== 1) throw new HttpError(409, STALE);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error, 'Unable to transfer ownership.');
  }
}
