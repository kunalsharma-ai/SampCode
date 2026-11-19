/**
 * Platform integrations, set up in the CRM (Settings > Integrations, or the super admin console) and
 * stored in MongoDB. This is the only place SampCode reads third-party API keys from: there is no
 * environment-variable fallback (ADR 0043), so a new installation is connected from the browser alone.
 * Each integration is a list of fields; a field may have a default (for example the Twilio callback
 * address), used while it is left empty.
 *
 * Every process (API tasks, the worker) keeps a copy of the saved rows in memory and refreshes it every
 * few seconds (IntegrationSettingsService), so `integration(key)` is synchronous and cheap. Consumers
 * rebuild their provider when `fingerprint` changes, so a change in the CRM needs no restart.
 *
 * Secrets are sealed with SecretBox (AES-256-GCM, key from SECRETS_KEY) and are never sent back to the
 * browser: the CRM only learns whether a secret is set and its last four characters.
 *
 * What still comes from the environment is only what the server needs before it can read the database
 * (the database address, SECRETS_KEY, the web addresses) and switches for how the server runs: see
 * docs/operations/go-live.md.
 */
import { z } from 'zod';
import { config, type AppConfig } from '../config';

export const INTEGRATION_KEYS = [
  'anthropic',
  'ipinfo',
  'deepgram',
  'twilio',
  'smtp',
  'sendgrid',
  'stripe',
  's3',
  'sampleon',
  'cdn',
] as const;
/** Model used when none is chosen in the CRM. */
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];
export const isIntegrationKey = (k: string): k is IntegrationKey => (INTEGRATION_KEYS as readonly string[]).includes(k);

export interface FieldDef {
  name: string;
  label: string;
  help?: string;
  /** Secret fields are sealed at rest and never shown again. */
  secret?: boolean;
  /** Needed before the integration can be turned on. */
  required?: boolean;
  kind?: 'text' | 'json' | 'select';
  options?: string[];
  placeholder?: string;
  /** Value used while the field is left empty. */
  fallback?: (c: AppConfig) => string;
  /** Returns a problem with the value, or null. */
  check?: (v: string) => string | null;
}

export interface IntegrationDef {
  key: IntegrationKey;
  name: string;
  category: 'AI' | 'Data quality' | 'Interviews' | 'Email and SMS' | 'Billing' | 'Storage' | 'Audience' | 'Network';
  purpose: string;
  /** What leaves SampCode when it is on (shown next to the switch). */
  privacy: string;
  signupUrl: string;
  fields: FieldDef[];
  /** A problem with the combination of values (checked before it can be turned on), or null. */
  validate?: (values: Record<string, string>) => string | null;
  /** Addresses the provider must be given, shown with a copy button. */
  callbacks?: (c: AppConfig, values: Record<string, string>) => Array<{ label: string; url: string }>;
  warning?: string;
}

const pricingSchema = z.record(
  z.string(),
  z.object({
    input: z.number().min(0),
    output: z.number().min(0),
    cacheRead: z.number().min(0).optional(),
    cacheWrite: z.number().min(0).optional(),
  }),
);
const PLAN_CODES = ['free', 'team', 'business', 'enterprise'] as const;
const pricesSchema = z.partialRecord(z.enum(PLAN_CODES), z.string().regex(/^price_[A-Za-z0-9]+$/));

const json = (schema: z.ZodType, example: string) => (v: string) => {
  try {
    const r = schema.safeParse(JSON.parse(v));
    return r.success ? null : `must look like ${example}`;
  } catch {
    return `must be JSON, like ${example}`;
  }
};
const pattern = (re: RegExp, message: string) => (v: string) => (re.test(v) ? null : message);
const maxLen = (n: number) => (v: string) => (v.length <= n ? null : `must be at most ${n} characters`);

/** Zoho Mail (India data centre, organization accounts) over SSL/TLS: the transport Kunal asked for. */
export const SMTP_DEFAULTS = { host: 'smtppro.zoho.in', port: '465', security: 'ssl' } as const;

/**
 * The SMTP server must be a public DNS name. IP addresses and local names are refused so that Settings >
 * Integrations cannot be used to make the server connect to machines on its own network (tests use
 * SMTP_TEST_ENDPOINT instead).
 */
function smtpHostProblem(v: string): string | null {
  const host = v.trim().toLowerCase();
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host))
    return 'must be a server name such as smtppro.zoho.in';
  if (/(^|\.)(localhost|local|internal|localdomain|home|lan)$/.test(host)) return 'must be a public server name';
  return null;
}

export const INTEGRATIONS: Record<IntegrationKey, IntegrationDef> = {
  anthropic: {
    key: 'anthropic',
    name: 'Claude (Anthropic)',
    category: 'AI',
    purpose: 'AI Survey Architect, AI translation and the AI assistants. Organizations still choose their own AI limits.',
    privacy: 'Briefs, uploaded questionnaires and texts to translate are sent to Anthropic when someone uses an AI feature.',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 'sk-ant-…',
        check: maxLen(500),
      },
      {
        name: 'model',
        label: 'Model',
        required: true,
        help: 'Default model for every AI task. Left empty, claude-opus-5-5 is used.',
        // Client feedback 2026-11: adding the API key alone is enough to start.
        fallback: () => DEFAULT_AI_MODEL,
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'modelArchitect',
        label: 'Model for the AI Survey Architect (optional)',
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'modelTranslate',
        label: 'Model for translation (optional)',
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'modelInsights',
        label: 'Model for research insights (optional)',
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'pricing',
        label: 'Prices for cost tracking (USD per million tokens)',
        kind: 'json',
        help: 'Check current pricing on anthropic.com. Used only for the usage estimates.',
        placeholder: '{"claude-opus-5-5":{"input":4,"output":20}}',
        check: json(pricingSchema, '{"model": {"input": 4, "output": 20}}'),
      },
    ],
  },
  ipinfo: {
    key: 'ipinfo',
    name: 'IPinfo (VPN and proxy detection)',
    category: 'Data quality',
    purpose: 'Flags online interviews from VPNs, proxies, Tor and data centres in the quality score.',
    privacy: "Each online respondent's IP address is sent to IPinfo when an interview starts.",
    signupUrl: 'https://ipinfo.io/signup',
    fields: [
      {
        name: 'token',
        label: 'Access token',
        help: 'Your IPinfo plan must include privacy detection.',
        secret: true,
        required: true,
        check: maxLen(200),
      },
    ],
  },
  deepgram: {
    key: 'deepgram',
    name: 'Deepgram (transcription)',
    category: 'Interviews',
    purpose: 'Transcribes interview recordings when a reviewer asks for a transcript.',
    privacy: 'A recording is sent to Deepgram only when a reviewer asks for its transcript.',
    signupUrl: 'https://console.deepgram.com/signup',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        check: maxLen(200),
      },
      {
        name: 'model',
        label: 'Model',
        help: "A model from Deepgram's model list, e.g. nova-3.",
        required: true,
        check: pattern(/^[A-Za-z0-9._-]{1,100}$/, 'is not a Deepgram model name'),
      },
    ],
  },
  twilio: {
    key: 'twilio',
    name: 'Twilio (phone dialer and SMS)',
    category: 'Interviews',
    purpose:
      "Click-to-call for CATI (the interviewer's phone rings first, then the respondent is dialled, so numbers stay hidden) and SMS invitations and reminders.",
    privacy:
      "Respondents' and interviewers' phone numbers are sent to Twilio to place calls and send texts; recordings come back from Twilio.",
    signupUrl: 'https://www.twilio.com/try-twilio',
    validate: (v) => (v.callerId || v.smsFrom ? null : 'needs a caller ID (phone dialer) or an SMS sender, or both'),
    fields: [
      {
        name: 'accountSid',
        label: 'Account SID',
        required: true,
        placeholder: 'AC…',
        check: pattern(/^AC[0-9a-f]{32}$/, 'starts with AC followed by 32 letters and digits'),
      },
      {
        name: 'authToken',
        label: 'Auth token',
        secret: true,
        required: true,
        check: maxLen(200),
      },
      {
        name: 'callerId',
        label: 'Caller ID for the phone dialer',
        help: 'A Twilio number (or verified caller ID) in international form. Empty: the phone dialer stays off.',
        placeholder: '+442071234567',
        check: pattern(/^\+[1-9][0-9]{6,14}$/, 'must be in international form, e.g. +442071234567'),
      },
      {
        name: 'smsFrom',
        label: 'SMS sender',
        help: 'A Twilio number in international form, or a Messaging Service SID (MG…). Empty: SMS invitations stay off.',
        placeholder: '+442071234567 or MG…',
        check: pattern(/^(\+[1-9][0-9]{6,14}|MG[0-9a-fA-F]{32})$/, 'must be a number like +442071234567 or a Messaging Service SID (MG…)'),
      },
      {
        name: 'webhookBase',
        label: 'Public API address Twilio calls back',
        help: 'Leave empty to use the studio address followed by /api.',
        fallback: (c) => `${c.STUDIO_URL.replace(/\/$/, '')}/api`,
        check: pattern(/^https?:\/\/[^/\s]+(\/\S*)?$/, 'must be a URL'),
      },
    ],
  },
  smtp: {
    key: 'smtp',
    name: 'SMTP email (Zoho Mail)',
    category: 'Email and SMS',
    purpose:
      'Email invitations and reminders, "forgot password" emails and automation emails, sent through your own mailbox over SMTP. Set up for Zoho Mail; any SMTP server works. Used instead of SendGrid when both are on.',
    privacy: "Recipients' email addresses and the email text are sent to your SMTP server (Zoho Mail by default).",
    signupUrl: 'https://www.zoho.com/mail/help/zoho-smtp.html',
    fields: [
      {
        name: 'host',
        label: 'SMTP server',
        help: 'smtppro.zoho.in for Zoho Mail organization accounts in India (smtppro.zoho.com elsewhere, smtp.zoho.in for personal accounts).',
        placeholder: 'smtppro.zoho.in',
        fallback: () => SMTP_DEFAULTS.host,
        check: (v) => smtpHostProblem(v),
      },
      {
        name: 'port',
        label: 'Port',
        kind: 'select',
        options: ['465', '587'],
        help: "465 with SSL/TLS (Zoho's default), or 587 with STARTTLS.",
        fallback: () => SMTP_DEFAULTS.port,
        check: (v) => (['465', '587'].includes(v) ? null : 'must be 465 or 587'),
      },
      {
        name: 'security',
        label: 'Encryption',
        kind: 'select',
        options: ['ssl', 'starttls'],
        help: 'ssl: SSL/TLS from the first byte (secure: true, port 465). starttls: upgraded to TLS after connecting (port 587). Both are always encrypted.',
        fallback: () => SMTP_DEFAULTS.security,
        check: (v) => (v === 'ssl' || v === 'starttls' ? null : 'must be ssl or starttls'),
      },
      {
        name: 'user',
        label: 'Sender email (SMTP user)',
        help: 'The mailbox that signs in to the SMTP server. Emails are sent from this address.',
        required: true,
        placeholder: 'surveys@yourcompany.com',
        check: pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'is not an email address'),
      },
      {
        name: 'password',
        label: 'Password',
        help: 'For Zoho, an application-specific password (Zoho Accounts > Security > App passwords) when two-factor sign-in is on.',
        secret: true,
        required: true,
        check: maxLen(300),
      },
      {
        name: 'fromName',
        label: 'From name',
        fallback: () => 'SampCode surveys',
        check: maxLen(100),
      },
    ],
    validate: (v) => ((v.port === '465') === (v.security === 'ssl') ? null : 'Use port 465 with ssl, or port 587 with starttls.'),
  },
  sendgrid: {
    key: 'sendgrid',
    name: 'SendGrid (email)',
    category: 'Email and SMS',
    purpose: 'Email invitations and reminders, "forgot password" emails and automation emails.',
    privacy: "Recipients' email addresses and the email text are sent to SendGrid.",
    signupUrl: 'https://app.sendgrid.com/settings/api_keys',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        help: 'Needs the "Mail Send" permission.',
        secret: true,
        required: true,
        placeholder: 'SG.…',
        check: maxLen(300),
      },
      {
        name: 'fromEmail',
        label: 'From address',
        help: 'A sender address or domain verified in SendGrid.',
        required: true,
        placeholder: 'surveys@example.com',
        check: pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'is not an email address'),
      },
      {
        name: 'fromName',
        label: 'From name',
        fallback: () => 'SampCode surveys',
        check: maxLen(100),
      },
    ],
  },
  stripe: {
    key: 'stripe',
    name: 'Stripe (billing)',
    category: 'Billing',
    purpose: 'Lets organization admins buy and change plans with Stripe Checkout; Stripe webhooks set the plan.',
    privacy: "The organization's ID and the buyer's e-mail address are sent to Stripe at checkout.",
    signupUrl: 'https://dashboard.stripe.com/register',
    callbacks: (c) => [{ label: 'Webhook endpoint to add in Stripe', url: `${c.STUDIO_URL.replace(/\/$/, '')}/api/billing/webhook` }],
    fields: [
      {
        name: 'secretKey',
        label: 'Secret key',
        secret: true,
        required: true,
        placeholder: 'sk_live_… or rk_live_…',
        check: pattern(/^(sk|rk)_(live|test)_[A-Za-z0-9_]+$/, 'starts with sk_live_, sk_test_, rk_live_ or rk_test_'),
      },
      {
        name: 'webhookSecret',
        label: 'Webhook signing secret',
        secret: true,
        required: true,
        placeholder: 'whsec_…',
        check: pattern(/^whsec_[A-Za-z0-9_]+$/, 'starts with whsec_'),
      },
      {
        name: 'prices',
        label: 'Plan prices',
        kind: 'json',
        required: true,
        help: 'Plan code to Stripe price ID.',
        placeholder: '{"team":"price_…","business":"price_…"}',
        check: json(pricesSchema, '{"team": "price_..."}'),
      },
      {
        name: 'apiVersion',
        label: 'Stripe API version (optional)',
        help: "Empty uses your account's default.",
        check: pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$/, 'looks like 2026-09-30.clover'),
      },
      {
        name: 'fallbackPlan',
        label: 'Plan when a subscription ends',
        kind: 'select',
        options: [...PLAN_CODES],
        fallback: () => 'free',
        check: (v) => ((PLAN_CODES as readonly string[]).includes(v) ? null : 'is not a plan'),
      },
    ],
  },
  s3: {
    key: 's3',
    name: 'Amazon S3 (file storage)',
    category: 'Storage',
    purpose: 'Keeps exports, uploads, survey media, photos and recordings in a private S3 bucket instead of the server disk.',
    privacy: 'Files are stored in your own bucket, encrypted at rest (SSE-KMS with a KMS key, otherwise SSE-S3).',
    signupUrl: 'https://s3.console.aws.amazon.com/s3/bucket/create',
    warning:
      'Switching storage does not copy files. Files saved before the switch stay where they were, so switch before going live or copy them yourself.',
    fields: [
      {
        name: 'bucket',
        label: 'Bucket',
        required: true,
        check: pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'is not a bucket name'),
      },
      {
        name: 'region',
        label: 'Region',
        required: true,
        check: pattern(/^[a-z]{2}(-[a-z]+)+-[0-9]$/, 'looks like eu-west-1'),
      },
      {
        name: 'prefix',
        label: 'Folder inside the bucket (optional)',
        placeholder: 'zapx/production',
        check: pattern(/^[A-Za-z0-9._/-]{1,200}$/, 'may use letters, digits, . _ / and -'),
      },
      {
        name: 'kmsKeyId',
        label: 'KMS key (optional)',
        help: 'Key ID or ARN for SSE-KMS. Empty uses SSE-S3 (AES-256).',
        check: maxLen(300),
      },
      {
        name: 'accessKeyId',
        label: 'Access key ID (only outside AWS)',
        help: 'Leave both keys empty on AWS: the server uses its own role.',
        check: pattern(/^[A-Z0-9]{16,128}$/, 'is not an access key ID'),
      },
      {
        name: 'secretAccessKey',
        label: 'Secret access key (only outside AWS)',
        secret: true,
        check: maxLen(200),
      },
    ],
  },
  sampleon: {
    key: 'sampleon',
    name: 'SampAudience (audience and routing)',
    category: 'Audience',
    purpose:
      'Sends audience requests for independent surveys to SampAudience, the Sampledge audience engine, and receives its signed events and outcomes.',
    privacy: 'Survey launch links, target counts and respondent outcomes are exchanged with SampAudience.',
    signupUrl: 'https://sampledge.com',
    fields: [
      {
        name: 'url',
        label: 'SampAudience address',
        required: true,
        placeholder: 'https://audience.example.com',
        check: pattern(/^https?:\/\/[^/\s]+(\/\S*)?$/, 'must be an http(s) URL'),
      },
      {
        name: 'clientId',
        label: 'Client ID',
        help: "SampCode's client ID at SampAudience.",
        fallback: () => 'zapx',
        check: pattern(/^[A-Za-z0-9._-]{1,100}$/, 'may use letters, digits, . _ and -'),
      },
      {
        name: 'clientSecret',
        label: 'Client secret',
        help: "Signs SampCode's requests and checks SampAudience's webhooks.",
        secret: true,
        required: true,
        check: maxLen(500),
      },
      {
        name: 'outcomeSecret',
        label: 'Outcome secret',
        help: 'The survey-host outcome secret SampAudience holds for SampCode (signs the server-to-server outcome confirmation).',
        secret: true,
        required: true,
        check: maxLen(500),
      },
    ],
  },
  cdn: {
    key: 'cdn',
    name: 'CDN in front of SampCode (optional)',
    category: 'Network',
    purpose:
      "Only when a CDN (CloudFront, Cloudflare, ...) sits in front of SampCode: the CDN adds this secret as the X-Zapx-Edge header, and only on requests that carry it are the viewer's address and country headers believed.",
    privacy: 'Nothing is sent anywhere; this only tells SampCode which requests came through your CDN.',
    signupUrl: 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html',
    fields: [
      {
        name: 'sharedSecret',
        label: 'Shared secret (X-Zapx-Edge header)',
        help: 'At least 32 random characters, e.g. from `openssl rand -hex 32`. Configure the same value in the CDN.',
        secret: true,
        required: true,
        check: (v) => (v.length >= 32 && v.length <= 200 ? null : 'must be 32 to 200 characters'),
      },
      {
        name: 'clientAddressHeader',
        label: "Header with the viewer's address (optional)",
        placeholder: 'cloudfront-viewer-address',
        check: pattern(/^[A-Za-z0-9-]{1,100}$/, 'may use letters, digits and -'),
      },
    ],
  },
};

/** A saved row, with its secrets already opened. */
export interface StoredIntegration {
  enabled: boolean;
  values: Record<string, string>;
  updatedAt: Date;
  updatedById: string | null;
}

export interface EffectiveIntegration {
  key: IntegrationKey;
  /** On, and every required field has a value. */
  enabled: boolean;
  /** Switched on in the CRM. */
  switchedOn: boolean;
  /** Whether anything has been saved for it yet. */
  source: 'crm' | 'none';
  values: Record<string, string>;
  /** Where each value comes from. */
  origins: Record<string, 'crm' | 'default' | 'none'>;
  missing: string[];
  /** Changes whenever anything above changes; consumers rebuild their provider when it does. */
  fingerprint: string;
}

let saved = new Map<IntegrationKey, StoredIntegration>();

/** Replace the in-memory copy of the saved rows (IntegrationSettingsService). */
export function setStoredIntegrations(rows: Map<IntegrationKey, StoredIntegration>) {
  saved = rows;
}
export function storedIntegration(key: IntegrationKey): StoredIntegration | undefined {
  return saved.get(key);
}

/** The settings an integration runs with right now (saved in the CRM, with field defaults). */
export function integration(key: IntegrationKey): EffectiveIntegration {
  const def = INTEGRATIONS[key];
  const c = config();
  const row = saved.get(key);
  const values: Record<string, string> = {};
  const origins: EffectiveIntegration['origins'] = {};
  for (const f of def.fields) {
    const fromCrm = row?.values[f.name];
    const fallback = f.fallback?.(c);
    if (fromCrm) [values[f.name], origins[f.name]] = [fromCrm, 'crm'];
    else if (fallback) [values[f.name], origins[f.name]] = [fallback, 'default'];
    else [values[f.name], origins[f.name]] = ['', 'none'];
  }
  const missing = def.fields.filter((f) => f.required && !values[f.name]).map((f) => f.name);
  const switchedOn = row?.enabled ?? false;
  const enabled = switchedOn && !missing.length && !def.validate?.(values);
  const fingerprint = JSON.stringify([enabled, values]);
  return { key, enabled, switchedOn, source: row ? 'crm' : 'none', values, origins, missing, fingerprint };
}

/** Last four characters of a secret, only when it is long enough that this gives nothing away. */
export const secretHint = (v: string) => (v.length >= 16 ? `…${v.slice(-4)}` : null);
