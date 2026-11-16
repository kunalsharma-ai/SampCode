/**
 * Platform integrations set up in the CRM (Settings > Integrations), with the environment as the
 * fallback. Each integration is a list of fields; a field saved in the CRM wins, and a field left
 * empty there falls back to its environment variable. Once an integration has been saved in the CRM,
 * its on/off switch there wins too.
 *
 * Every process (API tasks, the worker) keeps a copy of the saved rows in memory and refreshes it every
 * few seconds (IntegrationSettingsService), so `integration(key)` is synchronous and cheap. Consumers
 * rebuild their provider when `fingerprint` changes, so a change in the CRM needs no restart.
 *
 * Secrets are sealed with SecretBox (AES-256-GCM, key from SECRETS_KEY) and are never sent back to the
 * browser: the CRM only learns whether a secret is set and its last four characters.
 *
 * Every outside API key lives here (anthropic, ipinfo, deepgram, twilio, stripe, s3, sendgrid and the
 * SampAudience connection). Only infrastructure settings stay in the environment: the database,
 * JWT_SECRET, SECRETS_KEY itself, worker switches, proxies and the CDN secret (docs/operations/go-live.md).
 */
import { z } from 'zod';
import { config, type AppConfig } from '../config';

export const INTEGRATION_KEYS = ['anthropic', 'ipinfo', 'deepgram', 'twilio', 'stripe', 's3', 'sendgrid', 'sampleon'] as const;
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
  /** The environment variable this field falls back to (shown in the CRM). */
  env: string;
  fromEnv: (c: AppConfig) => string | undefined;
  /** Value used when neither the CRM nor the environment sets one. */
  fallback?: (c: AppConfig) => string;
  /** Returns a problem with the value, or null. */
  check?: (v: string) => string | null;
}

export interface IntegrationDef {
  key: IntegrationKey;
  name: string;
  category: 'AI' | 'Data quality' | 'Interviews' | 'Billing' | 'Storage' | 'Email' | 'Sampledge';
  purpose: string;
  /** What leaves SampCode when it is on (shown next to the switch). */
  privacy: string;
  signupUrl: string;
  fields: FieldDef[];
  /** Whether the environment alone turns it on (used until the integration is saved in the CRM). */
  envEnabled: (c: AppConfig) => boolean;
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
const jsonOrEmpty = (o: object) => (Object.keys(o).length ? JSON.stringify(o) : undefined);

const SENDGRID: IntegrationDef = {
  key: 'sendgrid',
  name: 'SendGrid (email)',
  category: 'Email',
  purpose: 'Sends survey invitations, reminders, password resets and scheduled reports by email.',
  privacy: "Recipients' email addresses and the message text are sent to SendGrid.",
  signupUrl: 'https://app.sendgrid.com/settings/api_keys',
  envEnabled: (c) => c.EMAIL_PROVIDER === 'sendgrid',
  fields: [
    {
      name: 'apiKey',
      label: 'API key',
      help: 'A key with Mail Send permission.',
      secret: true,
      required: true,
      placeholder: 'SG.…',
      env: 'SENDGRID_API_KEY',
      fromEnv: (c) => c.SENDGRID_API_KEY || undefined,
      check: maxLen(300),
    },
    {
      name: 'fromEmail',
      label: 'From address',
      help: 'A sender verified in SendGrid (Sender Authentication).',
      required: true,
      placeholder: 'surveys@yourcompany.com',
      env: 'EMAIL_FROM',
      fromEnv: (c) => c.EMAIL_FROM || undefined,
      check: pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'is not an email address'),
    },
    {
      name: 'fromName',
      label: 'From name',
      env: 'EMAIL_FROM_NAME',
      fromEnv: (c) => c.EMAIL_FROM_NAME,
      fallback: () => 'SampCode surveys',
      check: maxLen(100),
    },
  ],
};

const SAMPLEON: IntegrationDef = {
  // The key and SAMPLEON_* variables keep the technical id; people see SampAudience.
  key: 'sampleon',
  name: 'SampAudience (audiences and invitations)',
  category: 'Sampledge',
  purpose: 'Sends audience requests for independent surveys to SampAudience and receives its signed progress events.',
  privacy: 'Survey ids, targets and launch links are sent to SampAudience; respondents arrive with a SampAudience token only.',
  signupUrl: '',
  envEnabled: (c) => !!c.SAMPLEON_URL,
  callbacks: (c) => [{ label: 'Events address to give SampAudience (Connected systems)', url: `${c.STUDIO_URL.replace(/\/$/, '')}/api/v1/sampleon/events` }],
  fields: [
    {
      name: 'url',
      label: 'SampAudience address',
      required: true,
      placeholder: 'https://audience.sampledge.com',
      env: 'SAMPLEON_URL',
      fromEnv: (c) => c.SAMPLEON_URL,
      check: pattern(/^https?:\/\/[^/\s@]+(\/\S*)?$/, 'must be an http(s) address'),
    },
    {
      name: 'clientId',
      label: 'Client id at SampAudience',
      help: 'The id SampCode is registered under in SampAudience → Settings → Connected systems.',
      env: 'SAMPLEON_CLIENT_ID',
      fromEnv: (c) => c.SAMPLEON_CLIENT_ID,
      fallback: () => 'zapx',
      check: pattern(/^[A-Za-z0-9_.-]{1,64}$/, 'may use letters, digits, . _ and -'),
    },
    {
      name: 'clientSecret',
      label: 'Signing secret',
      help: 'Shown once by SampAudience when SampCode is added there. Signs every call and checks the events it sends back.',
      secret: true,
      required: true,
      env: 'SAMPLEON_CLIENT_SECRET',
      fromEnv: (c) => c.SAMPLEON_CLIENT_SECRET,
      check: maxLen(500),
    },
    {
      name: 'outcomeSecret',
      label: 'Outcome secret',
      help: 'The outcome secret SampAudience shows for SampCode (create one there). Confirms completes server to server.',
      secret: true,
      env: 'SAMPLEON_OUTCOME_SECRET',
      fromEnv: (c) => c.SAMPLEON_OUTCOME_SECRET,
      check: maxLen(500),
    },
  ],
};

export const INTEGRATIONS: Record<IntegrationKey, IntegrationDef> = {
  sendgrid: SENDGRID,
  sampleon: SAMPLEON,
  anthropic: {
    key: 'anthropic',
    name: 'Claude (Anthropic)',
    category: 'AI',
    purpose: 'AI Survey Architect, AI translation and the AI assistants. Organizations still choose their own AI limits.',
    privacy: 'Briefs, uploaded questionnaires and texts to translate are sent to Anthropic when someone uses an AI feature.',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    envEnabled: (c) => !!c.ANTHROPIC_API_KEY && !!c.AI_MODEL,
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        env: 'ANTHROPIC_API_KEY',
        placeholder: 'sk-ant-…',
        fromEnv: (c) => c.ANTHROPIC_API_KEY,
        check: maxLen(500),
      },
      {
        name: 'model',
        label: 'Model',
        required: true,
        help: 'Default model for every AI task, e.g. claude-opus-5-5.',
        env: 'AI_MODEL',
        fromEnv: (c) => c.AI_MODEL,
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'modelArchitect',
        label: 'Model for the AI Survey Architect (optional)',
        env: 'AI_MODEL_ARCHITECT',
        fromEnv: (c) => c.AI_MODEL_ARCHITECT,
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'modelTranslate',
        label: 'Model for translation (optional)',
        env: 'AI_MODEL_TRANSLATE',
        fromEnv: (c) => c.AI_MODEL_TRANSLATE,
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'modelInsights',
        label: 'Model for research insights (optional)',
        env: 'AI_MODEL_INSIGHTS',
        fromEnv: (c) => c.AI_MODEL_INSIGHTS,
        check: pattern(/^[A-Za-z0-9._:@/-]{1,100}$/, 'is not a model id'),
      },
      {
        name: 'pricing',
        label: 'Prices for cost tracking (USD per million tokens)',
        kind: 'json',
        help: 'Check current pricing on anthropic.com. Used only for the usage estimates.',
        placeholder: '{"claude-opus-5-5":{"input":4,"output":20}}',
        env: 'AI_PRICING',
        fromEnv: (c) => jsonOrEmpty(c.AI_PRICING),
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
    envEnabled: (c) => c.NETWORK_REPUTATION === 'ipinfo',
    fields: [
      {
        name: 'token',
        label: 'Access token',
        help: 'Your IPinfo plan must include privacy detection.',
        secret: true,
        required: true,
        env: 'IPINFO_TOKEN',
        fromEnv: (c) => c.IPINFO_TOKEN,
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
    envEnabled: (c) => c.TRANSCRIPTION === 'deepgram',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        secret: true,
        required: true,
        env: 'DEEPGRAM_API_KEY',
        fromEnv: (c) => c.DEEPGRAM_API_KEY,
        check: maxLen(200),
      },
      {
        name: 'model',
        label: 'Model',
        help: "A model from Deepgram's model list, e.g. nova-3.",
        required: true,
        env: 'DEEPGRAM_MODEL',
        fromEnv: (c) => c.DEEPGRAM_MODEL,
        check: pattern(/^[A-Za-z0-9._-]{1,100}$/, 'is not a Deepgram model name'),
      },
    ],
  },
  twilio: {
    key: 'twilio',
    name: 'Twilio (phone dialer)',
    category: 'Interviews',
    purpose: "Click-to-call for CATI: the interviewer's phone rings first, then the respondent is dialled, so numbers stay hidden.",
    privacy: "Respondents' and interviewers' phone numbers are sent to Twilio to place calls; recordings come back from Twilio.",
    signupUrl: 'https://www.twilio.com/try-twilio',
    envEnabled: (c) => c.TELEPHONY === 'twilio',
    fields: [
      {
        name: 'accountSid',
        label: 'Account SID',
        required: true,
        placeholder: 'AC…',
        env: 'TWILIO_ACCOUNT_SID',
        fromEnv: (c) => c.TWILIO_ACCOUNT_SID,
        check: pattern(/^AC[0-9a-f]{32}$/, 'starts with AC followed by 32 letters and digits'),
      },
      {
        name: 'authToken',
        label: 'Auth token',
        secret: true,
        required: true,
        env: 'TWILIO_AUTH_TOKEN',
        fromEnv: (c) => c.TWILIO_AUTH_TOKEN,
        check: maxLen(200),
      },
      {
        name: 'callerId',
        label: 'Caller ID',
        help: 'A Twilio number (or verified caller ID) in international form.',
        required: true,
        placeholder: '+442071234567',
        env: 'TWILIO_CALLER_ID',
        fromEnv: (c) => c.TWILIO_CALLER_ID,
        check: pattern(/^\+[1-9][0-9]{6,14}$/, 'must be in international form, e.g. +442071234567'),
      },
      {
        name: 'webhookBase',
        label: 'Public API address Twilio calls back',
        help: 'Leave empty to use the studio address followed by /api.',
        env: 'TELEPHONY_WEBHOOK_BASE',
        fromEnv: (c) => c.TELEPHONY_WEBHOOK_BASE,
        fallback: (c) => `${c.STUDIO_URL.replace(/\/$/, '')}/api`,
        check: pattern(/^https?:\/\/[^/\s]+(\/\S*)?$/, 'must be a URL'),
      },
      {
        name: 'smsFrom',
        label: 'Send survey links by SMS from (optional)',
        help: 'A Twilio number in international form or a Messaging Service SID (MG…). Set it to turn on SMS invitations.',
        placeholder: '+447700900123',
        env: 'SMS_FROM',
        fromEnv: (c) => c.SMS_FROM,
        check: pattern(/^(\+[1-9][0-9]{6,14}|MG[0-9a-fA-F]{32})$/, 'must be a number like +447700900123 or a Messaging Service SID'),
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
    envEnabled: (c) => c.BILLING === 'stripe',
    callbacks: (c) => [{ label: 'Webhook endpoint to add in Stripe', url: `${c.STUDIO_URL.replace(/\/$/, '')}/api/billing/webhook` }],
    fields: [
      {
        name: 'secretKey',
        label: 'Secret key',
        secret: true,
        required: true,
        placeholder: 'sk_live_… or rk_live_…',
        env: 'STRIPE_SECRET_KEY',
        fromEnv: (c) => c.STRIPE_SECRET_KEY,
        check: pattern(/^(sk|rk)_(live|test)_[A-Za-z0-9_]+$/, 'starts with sk_live_, sk_test_, rk_live_ or rk_test_'),
      },
      {
        name: 'webhookSecret',
        label: 'Webhook signing secret',
        secret: true,
        required: true,
        placeholder: 'whsec_…',
        env: 'STRIPE_WEBHOOK_SECRET',
        fromEnv: (c) => c.STRIPE_WEBHOOK_SECRET,
        check: pattern(/^whsec_[A-Za-z0-9_]+$/, 'starts with whsec_'),
      },
      {
        name: 'prices',
        label: 'Plan prices',
        kind: 'json',
        required: true,
        help: 'Plan code to Stripe price ID.',
        placeholder: '{"team":"price_…","business":"price_…"}',
        env: 'STRIPE_PRICES',
        fromEnv: (c) => jsonOrEmpty(c.STRIPE_PRICES),
        check: json(pricesSchema, '{"team": "price_..."}'),
      },
      {
        name: 'apiVersion',
        label: 'Stripe API version (optional)',
        help: "Empty uses your account's default.",
        env: 'STRIPE_API_VERSION',
        fromEnv: (c) => c.STRIPE_API_VERSION,
        check: pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z]+)?$/, 'looks like 2026-09-30.clover'),
      },
      {
        name: 'fallbackPlan',
        label: 'Plan when a subscription ends',
        kind: 'select',
        options: [...PLAN_CODES],
        env: 'BILLING_FALLBACK_PLAN',
        fromEnv: (c) => c.BILLING_FALLBACK_PLAN,
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
    envEnabled: (c) => c.FILE_STORE === 's3',
    warning:
      'Switching storage does not copy files. Files saved before the switch stay where they were, so switch before going live or copy them yourself.',
    fields: [
      {
        name: 'bucket',
        label: 'Bucket',
        required: true,
        env: 'S3_BUCKET',
        fromEnv: (c) => c.S3_BUCKET,
        check: pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'is not a bucket name'),
      },
      {
        name: 'region',
        label: 'Region',
        required: true,
        env: 'S3_REGION',
        fromEnv: (c) => c.S3_REGION,
        check: pattern(/^[a-z]{2}(-[a-z]+)+-[0-9]$/, 'looks like eu-west-1'),
      },
      {
        name: 'prefix',
        label: 'Folder inside the bucket (optional)',
        placeholder: 'zapx/production',
        env: 'S3_PREFIX',
        fromEnv: (c) => c.S3_PREFIX,
        check: pattern(/^[A-Za-z0-9._/-]{1,200}$/, 'may use letters, digits, . _ / and -'),
      },
      {
        name: 'kmsKeyId',
        label: 'KMS key (optional)',
        help: 'Key ID or ARN for SSE-KMS. Empty uses SSE-S3 (AES-256).',
        env: 'S3_KMS_KEY_ID',
        fromEnv: (c) => c.S3_KMS_KEY_ID,
        check: maxLen(300),
      },
      {
        name: 'accessKeyId',
        label: 'Access key ID (only outside AWS)',
        help: 'Leave both keys empty on AWS: the server uses its own role.',
        env: 'AWS_ACCESS_KEY_ID',
        fromEnv: () => undefined,
        check: pattern(/^[A-Z0-9]{16,128}$/, 'is not an access key ID'),
      },
      {
        name: 'secretAccessKey',
        label: 'Secret access key (only outside AWS)',
        secret: true,
        env: 'AWS_SECRET_ACCESS_KEY',
        fromEnv: () => undefined,
        check: maxLen(200),
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
  /** Switched on (in the CRM, or by the environment before it was saved there). */
  switchedOn: boolean;
  /** Where the on/off switch comes from. */
  source: 'crm' | 'env';
  values: Record<string, string>;
  /** Where each value comes from. */
  origins: Record<string, 'crm' | 'env' | 'default' | 'none'>;
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

/** The settings an integration runs with right now: the CRM first, then the environment. */
export function integration(key: IntegrationKey): EffectiveIntegration {
  const def = INTEGRATIONS[key];
  const c = config();
  const row = saved.get(key);
  const values: Record<string, string> = {};
  const origins: EffectiveIntegration['origins'] = {};
  for (const f of def.fields) {
    const fromCrm = row?.values[f.name];
    const fromEnv = f.fromEnv(c);
    const fallback = f.fallback?.(c);
    if (fromCrm) [values[f.name], origins[f.name]] = [fromCrm, 'crm'];
    else if (fromEnv) [values[f.name], origins[f.name]] = [fromEnv, 'env'];
    else if (fallback) [values[f.name], origins[f.name]] = [fallback, 'default'];
    else [values[f.name], origins[f.name]] = ['', 'none'];
  }
  const missing = def.fields.filter((f) => f.required && !values[f.name]).map((f) => f.name);
  const switchedOn = row ? row.enabled : def.envEnabled(c);
  const enabled = switchedOn && !missing.length;
  const fingerprint = JSON.stringify([enabled, values]);
  return { key, enabled, switchedOn, source: row ? 'crm' : 'env', values, origins, missing, fingerprint };
}

/** Last four characters of a secret, only when it is long enough that this gives nothing away. */
export const secretHint = (v: string) => (v.length >= 16 ? `…${v.slice(-4)}` : null);
