/**
 * Test defaults. In a running server JWT_SECRET and SIGNING_KEYS_SECRET come from the database
 * (platform/installation-secrets.ts, run by main.ts and worker.ts); the tests build the app directly,
 * so they get fixed values here unless a test sets its own.
 */
process.env.JWT_SECRET ||= 'test-secret-jwt-0123456789abcdef0123456789';
process.env.SECRETS_KEY ||= 'test-secret-box-0123456789abcdef0123456789';
