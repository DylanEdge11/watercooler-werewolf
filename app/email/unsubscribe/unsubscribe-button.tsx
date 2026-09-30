'use client';

import { useState } from 'react';

export default function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid' | 'failed'>('idle');

  async function turnOff() {
    if (state === 'busy') return;
    setState('busy');
    try {
      const response = await fetch('/api/email/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setState(response.ok ? 'done' : response.status === 404 ? 'invalid' : 'failed');
    } catch {
      setState('failed');
    }
  }

  if (state === 'done') return <p className="action-success unsubscribe-action" role="status">Done. Game email is off.</p>;
  if (state === 'invalid') return <p className="form-error unsubscribe-action" role="alert">This unsubscribe link is not valid.</p>;
  return (
    <div className="unsubscribe-action">
      {state === 'failed' && <p className="form-error" role="alert">Something went wrong. Try again in a moment.</p>}
      <button className="primary-button" type="button" onClick={() => void turnOff()} disabled={state === 'busy'}>{state === 'busy' ? 'Turning off…' : 'Turn off game email'}</button>
    </div>
  );
}
