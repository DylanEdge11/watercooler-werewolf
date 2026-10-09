'use client';

import { useEffect, useId, useRef } from 'react';
import type { SignInChoice } from '@/lib/auth/login-matches';

interface SignInChoicesProps {
  choices: SignInChoice[];
  /** True while a sign-in request is in flight; the buttons wait so one press sends one request. */
  busy: boolean;
  onChoose: (choice: SignInChoice) => void;
  className: string;
  headingClassName: string;
  buttonClassName: string;
}

/**
 * Shown after an email and PIN were accepted for more than one game that has
 * not ended. Plain buttons, so Tab, Enter and Space work; focus moves to the
 * first one when the list appears, so a keyboard user can answer straight away.
 */
export default function SignInChoices({ choices, busy, onChoose, className, headingClassName, buttonClassName }: SignInChoicesProps) {
  const headingId = useId();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, [choices]);

  return (
    <div role="group" aria-labelledby={headingId} className={className}>
      <p id={headingId} className={headingClassName}>Which game do you want to open?</p>
      {choices.map((choice, index) => (
        <button key={choice.id} ref={index === 0 ? first : undefined} type="button" className={buttonClassName} disabled={busy} onClick={() => onChoose(choice)}>
          {choice.gameName} · {choice.displayName}
        </button>
      ))}
    </div>
  );
}
