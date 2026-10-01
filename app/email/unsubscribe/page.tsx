import type { Metadata } from 'next';
import BrandMark from '../../brand-mark';
import UnsubscribeButton from './unsubscribe-button';

export const metadata: Metadata = { title: 'Turn off game email · Watercooler Werewolf', robots: { index: false } };

/**
 * Opening this page changes nothing (mail scanners open every link in an email). The
 * button below turns the player's game email off.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const value = typeof token === 'string' ? token : '';
  return (
    <main className="setup-shell centered front-of-house">
      <section className="auth-card">
        <BrandMark />
        <h1>Turn off game email?</h1>
        <p>You will stop getting Watercooler Werewolf emails about new phases, deadlines and results. The game itself is not affected, and you can turn email back on from your dashboard.</p>
        {value ? <UnsubscribeButton token={value} /> : <p className="form-error" role="alert">This unsubscribe link is not valid.</p>}
      </section>
    </main>
  );
}
