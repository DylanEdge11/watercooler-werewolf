import { cookies } from 'next/headers';
import PlayerDashboard, { type DashboardData } from '../player-dashboard';
import { getCurrentPlayer } from '../../lib/auth/session';
import { advanceGameSafely } from '../../lib/game/automation-sweep';
import { loadDashboard } from '../../lib/player/dashboard-data';
import { parseRoleVisibility, ROLE_VISIBILITY_COOKIE } from '../../lib/player/role-visibility';

// Only visitors with a player session reach this page (proxy.ts sends everyone else to the landing page).
export const dynamic = 'force-dynamic';

export default async function Home() {
  let initialData: DashboardData | null = null;
  let unauthenticated = false;
  try {
    const identity = await getCurrentPlayer();
    if (!identity) {
      unauthenticated = true;
    } else {
      // The same steps as GET /api/player, so the first paint matches the first refresh.
      const automation = await advanceGameSafely(identity.gameId);
      const dashboard = await loadDashboard(identity.seatId, { automation });
      // Exactly the JSON the API sends, so the dashboard sees one shape either way.
      if (dashboard) initialData = JSON.parse(JSON.stringify(dashboard)) as DashboardData;
    }
  } catch {
    // The dashboard loads itself in the browser instead, as it did before server rendering.
  }
  const initialRoleHidden = initialData
    ? parseRoleVisibility((await cookies()).get(ROLE_VISIBILITY_COOKIE)?.value, initialData.player.id)
    : null;
  return <PlayerDashboard initialData={initialData} initiallyUnauthenticated={unauthenticated} initialRoleHidden={initialRoleHidden} />;
}
