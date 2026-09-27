'use client';

import { useEffect, useState } from 'react';

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Older browsers and non-secure contexts: copy through a temporary text area.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Copy was blocked by the browser.');
}

/** Copies prepared text for email or chat and says so for a moment. */
export default function CopyButton({ text, label, accessibleLabel, className = 'secondary-button' }: { text: string; label: string; accessibleLabel?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  const visible = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy blocked; select the text' : label;
  return <button className={className} type="button" aria-label={state === 'idle' ? accessibleLabel : undefined} aria-live="polite" onClick={() => {
    void writeClipboard(text).then(() => setState('copied'), () => setState('failed'));
  }}>{visible}</button>;
}
