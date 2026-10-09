import { ensureDatabase } from '@/db/migrate';
import { INVALID_CLAIM_LINK, lookupClaimSeat, type ClaimSeat } from '@/lib/auth/claim';
import ClaimForm from './claim-form';

export default async function ClaimPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Look the seat up here so the first paint already greets the player by name.
  let seat: ClaimSeat | null = null;
  let lookupError = '';
  try {
    await ensureDatabase();
    seat = await lookupClaimSeat(code);
    if (!seat) lookupError = INVALID_CLAIM_LINK;
  } catch {
    lookupError = 'Unable to look up this seat. Refresh to try again.';
  }
  return <main className="setup-shell centered front-of-house"><ClaimForm code={code} seat={seat} lookupError={lookupError} /></main>;
}
