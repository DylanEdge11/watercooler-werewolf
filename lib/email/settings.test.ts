import { describe, expect, it } from 'vitest';
import { isReservedTestAddress, readSmtpSettings } from './settings';

const gmail = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'moderator@pilot.test',
  SMTP_PASSWORD: 'fictional-app-password',
  EMAIL_FROM: 'Watercooler Werewolf <moderator@pilot.test>',
};

describe('invite email settings', () => {
  it('defaults to TLS on port 465', () => {
    expect(readSmtpSettings(gmail)).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'moderator@pilot.test',
      password: 'fictional-app-password',
      from: 'Watercooler Werewolf <moderator@pilot.test>',
    });
  });

  it('uses STARTTLS on other ports, such as a provider on 587', () => {
    expect(readSmtpSettings({ ...gmail, SMTP_HOST: 'smtp.resend.test', SMTP_PORT: '587' })).toMatchObject({ port: 587, secure: false });
  });

  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'])('is off when %s is missing', (key) => {
    expect(readSmtpSettings({ ...gmail, [key]: '  ' })).toBeNull();
  });

  it.each(['0', '70000', 'smtp'])('is off when SMTP_PORT is %s', (port) => {
    expect(readSmtpSettings({ ...gmail, SMTP_PORT: port })).toBeNull();
  });
});

describe('reserved test addresses', () => {
  it.each(['player@pilot.test', 'PLAYER@Example.COM', 'a@example.org', 'a@host.example', 'a@x.invalid', 'a@localhost', 'a@test'])(
    'never sends to %s',
    (email) => expect(isReservedTestAddress(email)).toBe(true),
  );

  // These must be ordinary, non-reserved domains (that is what they test), so
  // they can't end in .test. They are made up and each targets one rule: a
  // "test" substring, an "example" lookalike, and ".test" not at the end.
  it.each(['player@werewolf-pilot.co', 'player@contest.werewolf-pilot.co', 'player@examples.werewolf-pilot.co', 'player@test.werewolf-pilot.co'])('sends to %s', (email) => {
    expect(isReservedTestAddress(email)).toBe(false);
  });
});
