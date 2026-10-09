import { ensureDatabase } from '@/db/migrate';
import { INVALID_SPECTATOR_LINK, lookupSpectatorLink, type SpectatorLink } from '@/lib/auth/spectator-link';
import SpectateForm from './spectate-form';

export default async function SpectatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let spectator: SpectatorLink | null = null;
  let lookupError = '';
  try {
    await ensureDatabase();
    spectator = await lookupSpectatorLink(code);
    if (!spectator) lookupError = INVALID_SPECTATOR_LINK;
  } catch {
    lookupError = 'Unable to look up this spectator link. Refresh to try again.';
  }
  return <main className="setup-shell centered front-of-house"><SpectateForm code={code} spectator={spectator} lookupError={lookupError} /></main>;
}
