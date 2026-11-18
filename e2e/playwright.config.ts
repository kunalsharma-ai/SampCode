import { defineConfig } from '@playwright/test';

/**
 * Full-stack acceptance test. Starts the built API, studio, respondent runtime and CAPI app unless they are
 * already running (set E2E_REUSE=1 to use servers you started yourself).
 * Requires a migrated database (DATABASE_URL) and `pnpm build` first.
 */
// Every spec signs up a fresh organization, so the run needs more than the default 5 sign-ups a minute.
// Transcription (Milestone 17) goes to a stand-in for Deepgram that the milestone 12 spec runs on port 5191,
// the dialer (Milestone 19) to a stand-in for Twilio that the milestone 19 spec runs on port 5192. Their keys
// are saved in the database by global-setup.ts (ADR 0043); only the stand-ins' addresses are set here.
const env = {
  ...process.env,
  ALLOW_SIGNUP: 'true',
  SIGNUP_RATE_PER_MINUTE: '50',
  LOGIN_RATE_PER_MINUTE: '50',
  SSO_ALLOW_INSECURE_ISSUER: 'true',
  DEEPGRAM_API_BASE: 'http://127.0.0.1:5191',
  TWILIO_API_BASE: 'http://127.0.0.1:5192',
} as Record<string, string>;
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    // navigator.webdriver stays false, so test respondents are not flagged as automation (Milestone 12;
    // the automation check itself is covered by the API tests). A fake microphone lets the CAPI app record.
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  webServer: [
    { command: 'node ../apps/api/dist/main.js', url: 'http://localhost:4000/api/health', reuseExistingServer: true, env, timeout: 60_000 },
    { command: 'pnpm --filter @zapx/studio start', url: 'http://localhost:3000/login', reuseExistingServer: true, env, timeout: 120_000 },
    { command: 'pnpm --filter @zapx/runtime preview', url: 'http://localhost:5173', reuseExistingServer: true, env, timeout: 60_000 },
    { command: 'pnpm --filter @zapx/capi preview', url: 'http://localhost:5174', reuseExistingServer: true, env, timeout: 60_000 },
  ],
});
