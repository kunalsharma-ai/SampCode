# 0044: Email over SMTP (nodemailer), Zoho Mail by default, set up in the database

Status: Accepted (2026-11-18). Builds on ADR 0043 (every API key in the database).

## Context

The owner sends mail from a Zoho Mail mailbox and asked for the mailer transport to be written as:

```js
const transporter = nodemailer.createTransport({
  host: 'smtppro.zoho.in',
  port: 465,
  secure: true, // SSL/TLS
  auth: { user: sender, pass: '…' },
});
```

Until now SampCode could only send through SendGrid's HTTP API. Under ADR 0043 the password cannot be
written in the code or in `.env`.

## Decision

- **New integration `smtp`** ("SMTP email (Zoho Mail)") in Settings → Integrations: server (default
  `smtppro.zoho.in`), port (`465` default, or `587`), encryption (`ssl` default = `secure: true`, or
  `starttls`), sender email (the SMTP user, also the From address), password (secret, sealed with
  `SECRETS_KEY` like every other key) and From name. Port 465 must go with `ssl` and 587 with `starttls`.
- **The transport** is `nodemailer.createTransport({ host, port, secure, auth: { user, pass } })`, built
  in `apps/api/src/distribution/mailer.ts` (`smtpTransport`), with TLS 1.2 or later, `requireTLS` on 587
  so the password never travels in clear, 15-second timeouts and a small pool (2 connections) that is
  rebuilt when the saved settings change.
- **SMTP wins over SendGrid** when both are on; turning SMTP off falls back to SendGrid; with neither,
  email is off as before.
- **Test connection** runs `transporter.verify()`: connect, TLS, sign in; nothing is sent. A refused
  sign-in says to use a Zoho app password when two-factor sign-in is on.
- **No internal servers:** the server field must be a public DNS name (no IP addresses, `localhost` or
  `.internal`/`.local` names), so the page cannot be used to probe the server's own network. Tests use
  `SMTP_TEST_ENDPOINT` (plain SMTP on 127.0.0.1), which the API refuses to start with in production.

## Consequences

- An installation can send from its own Zoho mailbox with no SendGrid account and no file edits.
- Zoho limits how many emails a mailbox sends per day; large invitation waves may need SendGrid or a
  higher Zoho plan.
- Tests: `apps/api/test/smtp-mailer.test.ts` (a local `smtp-server` plays Zoho).
