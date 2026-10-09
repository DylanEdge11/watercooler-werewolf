import { redirect } from 'next/navigation';
import { getCurrentModerator } from '@/lib/auth/session';
import PlayerViewStudio from './player-view-studio';

export const dynamic = 'force-dynamic';

export default async function PlayerPreviewPage() {
  const moderator = await getCurrentModerator();
  if (!moderator) redirect('/moderator');
  return <PlayerViewStudio />;
}
