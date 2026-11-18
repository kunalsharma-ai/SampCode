/**
 * Email sending for invitations, reminders, password resets and automation emails (blueprint phase 3).
 *
 * - Off until email is set up in Settings > Integrations: no email leaves SampCode.
 * - SMTP (nodemailer, by default Zoho Mail at smtppro.zoho.in:465 over SSL/TLS) wins when it is on;
 *   otherwise SendGrid v3 Mail Send (`POST /v3/mail/send`, 202 when accepted). Another provider is one
 *   class implementing EmailProvider.
 *
 * Tested against local stand-ins (an SMTP server and the SendGrid API) only.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { integration } from '../platform/integrations';

export interface OutgoingEmail {
  to: { email: string; name?: string | null };
  subject: string;
  text: string;
  /** One-click unsubscribe (RFC 8058): the List-Unsubscribe URL that accepts a POST. Not set for emails to members. */
  unsubscribeUrl?: string;
}

export class EmailError extends Error {}

export interface EmailProvider {
  readonly name: string;
  send(mail: OutgoingEmail, signal: AbortSignal): Promise<void>;
}

export class SendGridProvider implements EmailProvider {
  readonly name = 'sendgrid';
  constructor(
    private readonly key: string,
    private readonly base: string,
    private readonly from: { email: string; name: string },
  ) {}

  async send(mail: OutgoingEmail, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base.replace(/\/$/, '')}/v3/mail/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to.email, ...(mail.to.name ? { name: mail.to.name } : {}) }] }],
        from: this.from,
        subject: mail.subject,
        content: [{ type: 'text/plain', value: mail.text }],
        ...(mail.unsubscribeUrl
          ? { headers: { 'List-Unsubscribe': `<${mail.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
          : {}),
      }),
      signal,
    }).catch((e: Error) => {
      throw new EmailError(`Could not reach SendGrid (${e.message})`);
    });
    if (res.status !== 202 && res.status !== 200) {
      const body = (await res.json().catch(() => ({}))) as { errors?: Array<{ message?: string }> };
      throw new EmailError(`SendGrid refused the email: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`.slice(0, 300));
    }
  }
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** true: SSL/TLS from the first byte (port 465). false: STARTTLS, which is then required (port 587). */
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
}

const SMTP_TIMEOUT_MS = 15_000;

/** The SMTP settings saved in Settings > Integrations (SMTP_TEST_ENDPOINT replaces the server in tests). */
export function smtpSettings(values: Record<string, string>): SmtpSettings & { testServer: boolean } {
  const test = config().SMTP_TEST_ENDPOINT;
  if (test) {
    const u = new URL(test);
    return {
      host: u.hostname,
      port: Number(u.port),
      secure: false,
      user: values.user!,
      pass: values.password!,
      fromName: values.fromName!,
      testServer: true,
    };
  }
  return {
    host: values.host!,
    port: Number(values.port),
    secure: values.security === 'ssl',
    user: values.user!,
    pass: values.password!,
    fromName: values.fromName!,
    testServer: false,
  };
}

/**
 * The nodemailer transport, the same shape as
 * `nodemailer.createTransport({ host: 'smtppro.zoho.in', port: 465, secure: true, auth: { user, pass } })`.
 */
export function smtpTransport(s: SmtpSettings & { testServer?: boolean }, pool = false): Transporter {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure, // SSL/TLS
    auth: { user: s.user, pass: s.pass },
    // Port 587: refuse to continue (and send the password) unless the server upgrades to TLS. Only the
    // local test stand-in speaks plain SMTP.
    requireTLS: !s.secure && !s.testServer,
    ignoreTLS: !!s.testServer,
    tls: { minVersion: 'TLSv1.2', servername: s.host },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    ...(pool ? { pool: true, maxConnections: 2 } : {}),
  });
}

/** Short, safe text for an SMTP failure: never the password, and Zoho's usual causes spelled out. */
export function smtpErrorText(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
  if (err.code === 'EAUTH' || err.responseCode === 535)
    return 'The SMTP server rejected the sender email or password. For Zoho with two-factor sign-in, use an app password.';
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET' || err.code === 'EDNS')
    return `Could not reach the SMTP server (${err.code}). Check the server name, port and encryption.`;
  if (err.code === 'EENVELOPE' || (err.responseCode && err.responseCode >= 500 && err.responseCode < 600))
    return `The SMTP server refused the email: ${(err.response ?? err.message ?? '').slice(0, 200)}`;
  return `SMTP error: ${(err.message ?? String(e)).slice(0, 200)}`;
}

export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport: Transporter;
  constructor(private readonly settings: SmtpSettings & { testServer?: boolean }) {
    this.transport = smtpTransport(settings, true);
  }

  async send(mail: OutgoingEmail, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new EmailError('Sending was cancelled');
    const sending = this.transport.sendMail({
      from: { name: this.settings.fromName, address: this.settings.user },
      to: mail.to.name ? { name: mail.to.name, address: mail.to.email } : mail.to.email,
      subject: mail.subject,
      text: mail.text,
      ...(mail.unsubscribeUrl
        ? { headers: { 'List-Unsubscribe': `<${mail.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
        : {}),
    });
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new EmailError('Sending the email took too long'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([sending, aborted]);
    } catch (e) {
      if (e instanceof EmailError) throw e;
      throw new EmailError(smtpErrorText(e));
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      sending.catch(() => undefined);
    }
  }

  close() {
    this.transport.close();
  }
}

// One pooled SMTP provider per saved configuration, rebuilt when the settings change.
let smtpCache: { fingerprint: string; provider: SmtpProvider } | undefined;

/** Which email service is on: SMTP first, then SendGrid; null when email is off. */
export function emailService(): 'smtp' | 'sendgrid' | null {
  if (integration('smtp').enabled) return 'smtp';
  if (integration('sendgrid').enabled) return 'sendgrid';
  return null;
}

/** The configured provider, or null when sending is off. */
export function emailProvider(): EmailProvider | null {
  const smtp = integration('smtp');
  if (smtp.enabled) {
    const fingerprint = `${smtp.fingerprint}|${config().SMTP_TEST_ENDPOINT ?? ''}`;
    if (smtpCache?.fingerprint !== fingerprint) {
      smtpCache?.provider.close();
      smtpCache = { fingerprint, provider: new SmtpProvider(smtpSettings(smtp.values)) };
    }
    return smtpCache.provider;
  }
  if (smtpCache) {
    smtpCache.provider.close();
    smtpCache = undefined;
  }
  const s = integration('sendgrid');
  if (!s.enabled) return null;
  return new SendGridProvider(s.values.apiKey!, config().SENDGRID_API_BASE, { email: s.values.fromEmail!, name: s.values.fromName! });
}
