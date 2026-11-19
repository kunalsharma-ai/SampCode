/**
 * Provider keys live in the database, set in Settings > Integrations (ADR 0043), not in the server's
 * environment. Before the run, this saves the stand-ins the specs use: Deepgram on port 5191 (the
 * milestone 12 spec) and Twilio on port 5192 (the milestone 19 spec), with the same command an operator
 * would use (apps/api/dist/cli/set-integration.js). Only the stand-ins' addresses come from the
 * environment (DEEPGRAM_API_BASE, TWILIO_API_BASE in playwright.config.ts), as in the API tests.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const cli = join(__dirname, '../apps/api/dist/cli/set-integration.js');

function save(key: string, values: Record<string, string>) {
  execFileSync('node', [cli, key, '-'], { input: JSON.stringify(values), stdio: ['pipe', 'inherit', 'inherit'] });
}

export default function globalSetup() {
  save('deepgram', { apiKey: 'e2e-key', model: 'e2e-model' });
  save('twilio', {
    accountSid: `AC${'e'.repeat(32)}`,
    authToken: 'e2e-twilio-token',
    callerId: '+442070000000',
    webhookBase: 'http://localhost:4000/api',
  });
}
