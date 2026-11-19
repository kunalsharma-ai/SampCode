/**
 * SMTP email (Zoho Mail by default): the transport Kunal asked for,
 * `nodemailer.createTransport({ host: 'smtppro.zoho.in', port: 465, secure: true, auth: { user: sender, pass } })`,
 * with every value set in Settings > Integrations and the password sealed in the database (ADR 0043,
 * ADR 0044). A local SMTP server (smtp-server) plays Zoho; SMTP_TEST_ENDPOINT points the transport at it.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  // Replaced with the stand-in's port in beforeAll (config is read lazily).
  process.env.SMTP_TEST_ENDPOINT = 'smtp://127.0.0.1:9';
});

import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiApp } from '../src/http/app';
import { PrismaService } from '../src/common/prisma.service';
import { resetConfig } from '../src/config';
import { emailProvider, emailService, smtpSettings, smtpTransport, SmtpProvider } from '../src/distribution/mailer';
import { integration } from '../src/platform/integrations';
import { clearIntegrations, saveIntegration } from './support/integrations';

const run = `smtp${Date.now().toString(36)}`;
const SENDER = 'surveys@sampcode-test.in';
const PASSWORD = 'zoho-app-password-0123456789'; // secret-scan:allow (fake test value)

let app: ApiApp;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: Record<string, string>;
let operatorsBefore: string[] = [];
let smtp: SMTPServer;
const logins: Array<{ user: string; ok: boolean }> = [];
const mails: Array<{ from: string; to: string[]; raw: string }> = [];

beforeAll(async () => {
  smtp = new SMTPServer({
    secure: false,
    authOptional: false,
    allowInsecureAuth: true, // plain SMTP on 127.0.0.1 only; the real transport always uses TLS
    disabledCommands: ['STARTTLS'],
    logger: false,
    onAuth(auth, _session, cb) {
      const ok = auth.username === SENDER && auth.password === PASSWORD;
      logins.push({ user: auth.username ?? '', ok });
      return ok ? cb(null, { user: auth.username }) : cb(Object.assign(new Error('Authentication Failed'), { responseCode: 535 }));
    },
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString()));
      stream.on('end', () => {
        mails.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
        });
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
  process.env.SMTP_TEST_ENDPOINT = `smtp://127.0.0.1:${(smtp.server.address() as AddressInfo).port}`;
  resetConfig();

  app = createApp();
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
  await clearIntegrations(prisma, 'smtp', 'sendgrid');

  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  admin = { Authorization: `Bearer ${reg.body.token}` };
  const me = await http.get('/api/auth/me').set(admin).expect(200);
  operatorsBefore = (await prisma.tenant.findMany({ where: { platformOperator: true }, select: { id: true } })).map((t) => t.id);
  await prisma.tenant.updateMany({ data: { platformOperator: false } });
  await prisma.tenant.update({ where: { id: me.body.tenant.id }, data: { platformOperator: true } });
});

afterAll(async () => {
  if (prisma) {
    await clearIntegrations(prisma, 'smtp', 'sendgrid');
    await prisma.tenant.updateMany({ data: { platformOperator: false } });
    await prisma.tenant.updateMany({ where: { id: { in: operatorsBefore } }, data: { platformOperator: true } });
  }
  emailProvider(); // closes the pooled transport now that SMTP is off
  await app?.close();
  await new Promise<void>((r) => (smtp ? smtp.close(() => r()) : r()));
});

describe('SMTP email settings', () => {
  it('defaults to Zoho Mail over SSL/TLS: smtppro.zoho.in, port 465, secure', async () => {
    const list = (await http.get('/api/platform/integrations').set(admin).expect(200)).body.integrations;
    const s = list.find((i: { key: string }) => i.key === 'smtp');
    expect(s).toMatchObject({ enabled: false, category: 'Email and SMS' });
    const field = (n: string) => s.fields.find((f: { name: string }) => f.name === n);
    expect(field('host')).toMatchObject({ origin: 'default', value: 'smtppro.zoho.in' });
    expect(field('port')).toMatchObject({ origin: 'default', value: '465', kind: 'select' });
    expect(field('security')).toMatchObject({ origin: 'default', value: 'ssl' });
    expect(field('password')).toMatchObject({ secret: true });
    expect(emailService()).toBeNull();
  });

  it('builds the same transport as the snippet: host, port 465, secure: true, auth user = sender', () => {
    const t = smtpTransport({ host: 'smtppro.zoho.in', port: 465, secure: true, user: SENDER, pass: PASSWORD, fromName: 'x' });
    const o = t.options as { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; requireTLS: boolean };
    expect(o).toMatchObject({ host: 'smtppro.zoho.in', port: 465, secure: true, auth: { user: SENDER, pass: PASSWORD } });
    t.close();
    // Port 587 must upgrade to TLS before the password is sent.
    const starttls = smtpTransport({ host: 'smtppro.zoho.in', port: 587, secure: false, user: SENDER, pass: PASSWORD, fromName: 'x' });
    expect(starttls.options).toMatchObject({ secure: false, requireTLS: true });
    starttls.close();
  });

  it('without the test endpoint, the saved values are used as they are', () => {
    const saved = process.env.SMTP_TEST_ENDPOINT;
    delete process.env.SMTP_TEST_ENDPOINT;
    resetConfig();
    try {
      expect(
        smtpSettings({ host: 'smtppro.zoho.in', port: '465', security: 'ssl', user: SENDER, password: PASSWORD, fromName: 'n' }),
      ).toEqual({
        host: 'smtppro.zoho.in',
        port: 465,
        secure: true,
        user: SENDER,
        pass: PASSWORD,
        fromName: 'n',
        testServer: false,
      });
    } finally {
      process.env.SMTP_TEST_ENDPOINT = saved;
      resetConfig();
    }
  });

  it('refuses servers on the local network and mismatched port and encryption', async () => {
    for (const host of ['127.0.0.1', 'localhost', 'mail.internal', '10.0.0.5', 'http://smtppro.zoho.in'])
      await http.put('/api/platform/integrations/smtp').set(admin).send({ enabled: false, values: { host } }).expect(400);
    await http
      .put('/api/platform/integrations/smtp')
      .set(admin)
      .send({ enabled: true, values: { user: SENDER, password: PASSWORD, port: '587', security: 'ssl' } })
      .expect(400);
  });

  it('saves the sender and password in the database, sealed, and never sends the password back', async () => {
    const saved = (
      await http
        .put('/api/platform/integrations/smtp')
        .set(admin)
        .send({ enabled: true, values: { user: SENDER, password: PASSWORD } })
        .expect(200)
    ).body;
    expect(JSON.stringify(saved)).not.toContain(PASSWORD);
    const row = await prisma.platformIntegration.findUniqueOrThrow({ where: { key: 'smtp' } });
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(integration('smtp')).toMatchObject({
      enabled: true,
      values: { host: 'smtppro.zoho.in', port: '465', security: 'ssl', user: SENDER },
    });
    expect(emailService()).toBe('smtp');
    expect((await http.get('/api/auth/password-options').expect(200)).body.forgotPasswordEmail).toBe(true);
  });

  it('"Test connection" signs in to the SMTP server without sending anything', async () => {
    const before = mails.length;
    const ok = (await http.post('/api/platform/integrations/smtp/test').set(admin).send({}).expect(200)).body;
    expect(ok).toMatchObject({ ok: true });
    expect(ok.message).toContain(SENDER);
    expect(logins.at(-1)).toEqual({ user: SENDER, ok: true });
    const bad = (
      await http
        .post('/api/platform/integrations/smtp/test')
        .set(admin)
        .send({ values: { password: 'wrong-password' } })
        .expect(200)
    ).body;
    expect(bad).toMatchObject({ ok: false });
    expect(bad.message).toMatch(/rejected the sender email or password/);
    expect(bad.message).not.toContain('wrong-password');
    expect(mails.length).toBe(before);
  });
});

describe('sending', () => {
  it('SMTP wins over SendGrid and sends from the sender address with one-click unsubscribe', async () => {
    await saveIntegration(prisma, 'sendgrid', { apiKey: 'SG.test-key', fromEmail: 'other@example.com' });
    const provider = emailProvider();
    expect(provider).toBeInstanceOf(SmtpProvider);
    expect(emailProvider()).toBe(provider); // one pooled transport while the settings stay the same
    await provider!.send(
      {
        to: { email: 'respondent@example.com', name: 'Asha' },
        subject: 'Your survey',
        text: 'Hello Asha',
        unsubscribeUrl: 'https://x.test/u/1',
      },
      AbortSignal.timeout(10_000),
    );
    const m = mails.at(-1)!;
    expect(m.from).toBe(SENDER);
    expect(m.to).toEqual(['respondent@example.com']);
    expect(m.raw).toMatch(/^From: SampCode surveys <surveys@sampcode-test\.in>/m);
    expect(m.raw).toMatch(/^Subject: Your survey/m);
    expect(m.raw).toMatch(/^List-Unsubscribe: <https:\/\/x\.test\/u\/1>/m);
    expect(m.raw).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    expect(m.raw).toContain('Hello Asha');
  });

  it('a wrong password becomes a readable error, and turning SMTP off falls back to SendGrid', async () => {
    await saveIntegration(prisma, 'smtp', { user: SENDER, password: 'not-the-password' });
    const provider = emailProvider()!;
    await expect(provider.send({ to: { email: 'a@example.com' }, subject: 's', text: 't' }, AbortSignal.timeout(10_000))).rejects.toThrow(
      /rejected the sender email or password/,
    );
    await saveIntegration(prisma, 'smtp', { user: SENDER, password: PASSWORD }, false);
    expect(emailProvider()?.name).toBe('sendgrid');
    expect(emailService()).toBe('sendgrid');
  });
});
