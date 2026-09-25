import { afterEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  verify: vi.fn(async () => true),
  sendMail: vi.fn(async (message: Record<string, unknown>) => ({ message })),
  close: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      transport.options = options;
      return transport;
    },
  },
}));

import { openMailer } from './smtp';

const settings = {
  host: 'smtp.pilot.test',
  port: 587,
  secure: false,
  user: 'moderator@pilot.test',
  password: 'fictional-app-password',
  from: 'Watercooler Werewolf <moderator@pilot.test>',
};

function smtpError(code: string): Error {
  return Object.assign(new Error(`${code} from server`), { code, responseCode: 535 });
}

afterEach(() => {
  vi.restoreAllMocks();
  transport.verify.mockReset().mockResolvedValue(true);
  transport.sendMail.mockReset().mockImplementation(async (message) => ({ message }));
});

describe('SMTP mailer', () => {
  it('requires TLS and sends plain text from the configured sender', async () => {
    const mailer = openMailer(settings);
    expect(transport.options).toMatchObject({ host: 'smtp.pilot.test', port: 587, secure: false, requireTLS: true, auth: { user: 'moderator@pilot.test' } });
    expect(await mailer.send({ to: 'ana@pilot.test', subject: 'Subject', text: 'Body' })).toEqual({ ok: true });
    expect(transport.sendMail).toHaveBeenCalledWith({ from: settings.from, to: 'ana@pilot.test', subject: 'Subject', text: 'Body' });
    mailer.close();
    expect(transport.close).toHaveBeenCalled();
  });

  it('explains a rejected sign-in without logging the password', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    transport.verify.mockRejectedValue(Object.assign(smtpError('EAUTH'), { password: settings.password }));
    const result = await openMailer(settings).verify();
    expect(result).toEqual({ ok: false, reason: 'The email account rejected the sign-in. Check SMTP_USER and SMTP_PASSWORD.' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(settings.password);
    expect(JSON.stringify(log.mock.calls)).toContain('EAUTH');
  });

  it.each([
    ['ETIMEDOUT', 'The email server could not be reached. Check SMTP_HOST and SMTP_PORT.'],
    ['EENVELOPE', 'The email server refused this address.'],
    ['EMESSAGE', 'The email server did not accept this message.'],
  ])('reports %s as a delivery failure', async (code, reason) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    transport.sendMail.mockRejectedValue(smtpError(code));
    expect(await openMailer(settings).send({ to: 'ana@pilot.test', subject: 'S', text: 'T' })).toEqual({ ok: false, reason });
  });
});
