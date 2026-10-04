import type { Metadata } from 'next';
import { ensureDatabase } from '../../../../db/migrate';
import { lookupSetupLink, type SetupLink } from '../../../../lib/auth/moderator-setup';
import { MODERATOR_SETUP_COPY } from '../../../../lib/game/join-copy';
import BrandHeader from '../../brand-header';
import SetupForm from './setup-form';

export const metadata: Metadata = { title: 'Set up your moderator sign-in · Watercooler Werewolf', robots: { index: false } };

export default async function ModeratorSetupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let link: Pick<SetupLink, 'displayName' | 'gameName'> | null = null;
  let lookupError = '';
  try {
    await ensureDatabase();
    const found = await lookupSetupLink(code);
    if (found) link = { displayName: found.displayName, gameName: found.gameName };
    else lookupError = MODERATOR_SETUP_COPY.invalidLink;
  } catch {
    lookupError = 'Unable to look up this setup link. Refresh to try again.';
  }
  return (
    <main className="setup-shell backstage">
      <BrandHeader />
      <SetupForm code={code} link={link} lookupError={lookupError} />
    </main>
  );
}
