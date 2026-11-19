/** Runtime configuration, read once from the environment and validated. */
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

/** One model's price in USD per million tokens (the price table is set in Settings > Integrations > Claude). */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** Parts of the example secrets in .env.example and the test setup; never acceptable in production. */
const KNOWN_DEV_SECRETS = ['dev-only-secret', 'change-me', 'changeme', 'test-secret'];

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    /** Signs sign-in sessions. Made on the first start and kept in the database unless set here (ADR 0043). */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    API_PORT: z.coerce.number().default(4000),
    RUNTIME_BASE_URL: z.string().url().default('http://localhost:5173'),
    /** Where interviewers open the offline CAPI app (shown in the studio). */
    CAPI_APP_URL: z.string().url().default('http://localhost:5174'),
    ALLOW_SIGNUP: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** Sign-ups allowed per minute from one address (raise only for automated test runs). */
    SIGNUP_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(5),
    /** Provider per task (only "anthropic" is implemented; see docs/modules/ai-gateway.md). */
    AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
    /** Only for tests: an Anthropic-compatible stand-in. */
    ANTHROPIC_API_BASE: z.string().url().default('https://api.anthropic.com'),
    /** How often each process re-reads the integrations saved in the CRM (Settings > Integrations). */
    INTEGRATIONS_REFRESH_MS: z.coerce.number().int().min(1_000).max(600_000).default(15_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(600_000),
    /** Circuit breaker: consecutive provider failures that open the circuit, and how long it stays open. */
    AI_BREAKER_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
    AI_BREAKER_OPEN_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    /** Defaults for tenants without their own AI policy. */
    AI_DEFAULT_RPM: z.coerce.number().int().min(0).max(10_000).default(10),
    AI_DEFAULT_RPD: z.coerce.number().int().min(0).max(1_000_000).default(500),
    /**
     * Master key for every secret SampCode keeps in the database (32+ chars; ADR 0043). Set it, or SECRETS_KEY_FILE
     * (read at start-up by platform/installation-secrets.ts). Development without it: derived from JWT_SECRET.
     */
    SECRETS_KEY: optionalString.refine((v) => !v || v.length >= 32, 'SECRETS_KEY must be at least 32 characters'),
    /**
     * Derives the keys for test links, network/device hashes and SSO state (security review S5), so
     * they survive a JWT_SECRET rotation. Made on the first start and kept in the database unless set here (ADR 0043).
     */
    SIGNING_KEYS_SECRET: optionalString.refine((v) => !v || v.length >= 32, 'SIGNING_KEYS_SECRET must be at least 32 characters'),
    NODE_ENV: z.string().default('development'),
    /** Callback outbox worker. "off" leaves delivery to another process (or to tests). */
    CALLBACK_WORKER: z.enum(['on', 'off']).default('on'),
    CALLBACK_POLL_MS: z.coerce.number().int().min(200).max(600_000).default(5_000),
    CALLBACK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
    /** Allow callbacks to private and loopback addresses (development and tests only). */
    CALLBACK_ALLOW_PRIVATE_HOSTS: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** An unfinished interview with no activity for this long is recorded as partial (abandoned). */
    ABANDON_AFTER_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 30)
      .default(24 * 60),
    /** Max upload size for questionnaire files, in megabytes. */
    UPLOAD_MAX_MB: z.coerce.number().min(1).max(50).default(15),
    /** Max size of one survey media upload (video, audio, images), in megabytes. Images are capped at 10, audio at 25. */
    MEDIA_MAX_MB: z.coerce.number().min(1).max(500).default(100),
    /**
     * Milestone 12: request header carrying the respondent's country as set by your edge network (for
     * example cloudfront-viewer-country or cf-ipcountry). Empty: no country check. Only set this when
     * the API is reachable through that edge alone, or respondents could send the header themselves.
     */
    GEO_COUNTRY_HEADER: z
      .string()
      .regex(/^[a-z0-9-]*$/i)
      .default('')
      .transform((v) => v.toLowerCase()),
    /** Only for tests: an IPinfo-compatible stand-in. VPN and proxy checks are set up in Settings > Integrations. */
    IPINFO_API_BASE: z.string().url().default('https://ipinfo.io'),
    NETWORK_REPUTATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
    /** Only for tests: a Deepgram-compatible stand-in. Transcription is set up in Settings > Integrations. */
    DEEPGRAM_API_BASE: z.string().url().default('https://api.deepgram.com'),
    TRANSCRIPTION_TIMEOUT_S: z.coerce.number().int().min(10).max(3600).default(600),
    /** Only for tests: a Twilio-compatible stand-in. The phone dialer and SMS are set up in Settings > Integrations. */
    TWILIO_API_BASE: z.string().url().default('https://api.twilio.com'),
    /** Seconds to let each phone ring before giving up. */
    TELEPHONY_RING_SECONDS: z.coerce.number().int().min(5).max(120).default(30),
    /** Only for tests: a SendGrid-compatible stand-in. Email is set up in Settings > Integrations. */
    SENDGRID_API_BASE: z.string().url().default('https://api.sendgrid.com'),
    /**
     * Only for tests: a local SMTP stand-in such as smtp://127.0.0.1:2525 (plain, no TLS). When set it
     * replaces the server, port and encryption saved for SMTP email; the sender and password still come
     * from Settings > Integrations. Never set it in production.
     */
    SMTP_TEST_ENDPOINT: z
      .string()
      .regex(/^smtp:\/\/[^/\s:]+:[0-9]{1,5}$/, 'must look like smtp://127.0.0.1:2525')
      .optional(),
    /**
     * Blueprint phase 5, data residency: the region this deployment keeps data in (e.g. "eu", "us",
     * "in"). An organization that sets its own region sees a warning when the two differ. Empty: not declared.
     */
    DATA_REGION: z.string().max(20).default(''),
    /** Largest interview recording (CAPI audio), in megabytes. Photos are capped at 15. */
    CAPTURE_MAX_MB: z.coerce.number().min(1).max(500).default(100),
    /** Delete photos and recordings this many days after they were uploaded. 0 keeps them until erased. */
    CAPTURE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
    /** Exports with more rows than this are refused by the download endpoint and run as background jobs. */
    EXPORT_SYNC_MAX_ROWS: z.coerce.number().int().min(1).default(10_000),
    /** Background jobs (Milestone 7): run the job worker in this process. Turn off in the API when a separate worker runs. */
    JOB_WORKER: z.enum(['on', 'off']).default('on'),
    JOB_POLL_MS: z.coerce.number().int().min(100).max(600_000).default(2_000),
    /** Super admin automation: check the platform automation rules in this process, every PLATFORM_AUTOMATION_MS. */
    PLATFORM_AUTOMATION: z.enum(['on', 'off']).default('on'),
    PLATFORM_AUTOMATION_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
    /** Where the local file store keeps files (exports, uploads for AI jobs). */
    FILES_DIR: z.string().default('.data/files'),
    /** S3-compatible endpoint for testing (MinIO, LocalStack). Leave unset on AWS. S3 itself is set up in Settings > Integrations. */
    S3_ENDPOINT: optionalString,
    /** Export files are deleted after this many hours. */
    EXPORT_FILE_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(72),
    /** Retention: finished jobs, and delivered or failed webhook deliveries, are deleted after this many days. */
    JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    /** Plan for organizations created by sign-up (Milestone 8): free, team, business or enterprise. */
    DEFAULT_PLAN: z.enum(['free', 'team', 'business', 'enterprise']).default('enterprise'),
    /** Only for tests: a Stripe-compatible fake. Billing is set up in Settings > Integrations. */
    STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),
    /** Public address of the studio; SSO callbacks are ${STUDIO_URL}/api/auth/sso/callback. */
    STUDIO_URL: z.string().url().default('http://localhost:3000'),
    /** Oldest SampCode mobile app version allowed to sign in (e.g. 1.2.0); older apps are asked to update. */
    MOBILE_MIN_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .optional(),
    /** Development and tests only: allow http and private-network identity providers. */
    SSO_ALLOW_INSECURE_ISSUER: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** Load balancers and proxies in front of the API that add X-Forwarded-For (1 behind one ALB). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    /** Sign-in attempts allowed per minute from one address (raise only for automated test runs). */
    /**
     * Where rate-limit counters live (security review S4): `database` shares them between every API
     * process; `memory` counts per process. Default: database in production, memory otherwise.
     */
    THROTTLE_STORE: z.enum(['database', 'memory']).optional(),
    LOGIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
    /** Milestone 20: wrong passwords in a row before an account is locked, and for how long. */
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(100).default(10),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** Hours a password reset link works (administrator link or "forgot password" email). */
    PASSWORD_RESET_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  })
  .superRefine((c, ctx) => {
    // Milestone 20: refuse to start in production with settings that are only safe on a laptop.
    if (c.NODE_ENV === 'production') {
      if (!c.COOKIE_SECURE)
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production (sessions only over https)' });
      if (KNOWN_DEV_SECRETS.some((d) => c.JWT_SECRET.includes(d)))
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'is the example value; generate one with openssl rand -hex 32' });
      if (c.SECRETS_KEY && (c.SECRETS_KEY === c.JWT_SECRET || KNOWN_DEV_SECRETS.some((d) => c.SECRETS_KEY!.includes(d))))
        ctx.addIssue({ code: 'custom', path: ['SECRETS_KEY'], message: 'must be its own random value, not JWT_SECRET or the example' });
    }
    if (c.NODE_ENV === 'production' && !c.SECRETS_KEY)
      ctx.addIssue({ code: 'custom', path: ['SECRETS_KEY'], message: 'SECRETS_KEY is required in production' });
    if (c.NODE_ENV === 'production' && !c.SIGNING_KEYS_SECRET)
      ctx.addIssue({ code: 'custom', path: ['SIGNING_KEYS_SECRET'], message: 'SIGNING_KEYS_SECRET is required in production' });
    if (
      c.NODE_ENV === 'production' &&
      c.SIGNING_KEYS_SECRET &&
      (c.SIGNING_KEYS_SECRET === c.JWT_SECRET ||
        c.SIGNING_KEYS_SECRET === c.SECRETS_KEY ||
        KNOWN_DEV_SECRETS.some((d) => c.SIGNING_KEYS_SECRET!.includes(d)))
    )
      ctx.addIssue({ code: 'custom', path: ['SIGNING_KEYS_SECRET'], message: 'must be its own random value' });
    if (c.NODE_ENV === 'production' && c.CALLBACK_ALLOW_PRIVATE_HOSTS) {
      ctx.addIssue({ code: 'custom', path: ['CALLBACK_ALLOW_PRIVATE_HOSTS'], message: 'must be false in production' });
    }
    if (c.NODE_ENV === 'production' && c.SMTP_TEST_ENDPOINT) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_TEST_ENDPOINT'], message: 'is only for tests; remove it in production' });
    }
    if (c.NODE_ENV === 'production' && c.SSO_ALLOW_INSECURE_ISSUER) {
      ctx.addIssue({ code: 'custom', path: ['SSO_ALLOW_INSECURE_ISSUER'], message: 'must be false in production' });
    }
  });

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/** Tests change the environment between suites; this forgets the cached copy. */
export function resetConfig() {
  cached = undefined;
}
export function config(): AppConfig {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      throw new Error(`Invalid configuration: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    cached = r.data;
  }
  return cached;
}
