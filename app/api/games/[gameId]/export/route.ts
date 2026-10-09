import { ensureDatabase } from '@/db/migrate';
import { requireGameModerator } from '@/lib/auth/authorization';
import { createBackupRecord } from '@/lib/backup/snapshot';
import { assertSameOrigin } from '@/lib/http/security';
import { routeError } from '@/lib/http/errors';
import type { RouteContext } from '@/lib/http/route-context';

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOrigin(request);
    await ensureDatabase();
    const { gameId } = await context.params;
    const moderator = await requireGameModerator(gameId);
    const backup = await createBackupRecord(gameId, moderator.id);
    return Response.json(
      { ...backup.data, checksum: backup.checksum },
      {
        headers: {
          'content-disposition': `attachment; filename="watercooler-werewolf-${gameId}.json"`,
          'x-backup-checksum': backup.checksum,
        },
      },
    );
  } catch (error) {
    return routeError(error, 'Unable to create the backup export.');
  }
}
