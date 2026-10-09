import { ensureDatabase } from '@/db/migrate';
import { JOIN_COPY } from '@/lib/game/join-copy';
import { routeError, jsonError } from '@/lib/http/errors';
import { lookupJoinPage, toPublicJoinPage } from '@/lib/join/lookup';
import type { RouteContext } from '@/lib/http/route-context';

/** What the public page shows for a sign-up link, or 404 when the code matches no game. */
export async function GET(_request: Request, context: RouteContext<{ code: string }>) {
  try {
    await ensureDatabase();
    const { code } = await context.params;
    const page = await lookupJoinPage(code);
    if (!page) return jsonError(JOIN_COPY.invalidLink, 404);
    return Response.json({ ok: true, page: toPublicJoinPage(page) });
  } catch (error) {
    return routeError(error, 'Unable to look up this sign-up link.');
  }
}
