import type { Metadata } from 'next';
import { ensureDatabase } from '../../../db/migrate';
import { JOIN_COPY } from '../../../lib/game/join-copy';
import { lookupJoinPage, toPublicJoinPage, type PublicJoinPage } from '../../../lib/join/lookup';
import JoinForms from './join-forms';

export const metadata: Metadata = { title: 'Join a game · Watercooler Werewolf', robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Look the game up here so the first paint already names it.
  let page: PublicJoinPage | null = null;
  let lookupError = '';
  try {
    await ensureDatabase();
    const found = await lookupJoinPage(code);
    if (found) page = toPublicJoinPage(found);
    else lookupError = JOIN_COPY.invalidLink;
  } catch {
    lookupError = 'Unable to look up this sign-up link. Refresh to try again.';
  }
  return <main className="setup-shell centered front-of-house"><JoinForms code={code} page={page} lookupError={lookupError} /></main>;
}
