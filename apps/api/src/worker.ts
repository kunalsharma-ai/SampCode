/**
 * Background worker process (Milestone 7): runs jobs, vendor callbacks and webhooks, without the
 * HTTP server. Run the API with JOB_WORKER=off and CALLBACK_WORKER=off when this process runs.
 */
import './database-url';
import { logger } from './bootstrap';
import { config } from './config';
import { closeOnSignals, createApp } from './http/app';
import { loadInstallationSecrets, retiredEnvInUse } from './platform/installation-secrets';
import { CallbackWorker } from './integrations/callback.worker';
import { JobWorker } from './jobs/job.worker';

async function main() {
  // JWT_SECRET and SIGNING_KEYS_SECRET: made on the first start and kept in MongoDB (ADR 0043).
  const made = await loadInstallationSecrets();
  if (made.length) logger.log(`${made.join(' and ')} read from the database`);
  const retired = retiredEnvInUse();
  if (retired.length) logger.warn(`Ignored (API keys are set in Settings > Integrations now, ADR 0043): ${retired.join(', ')}`);
  const app = await createApp().init();
  closeOnSignals(app, logger);
  // This process always works the queues, whatever JOB_WORKER and CALLBACK_WORKER say for the API.
  app.get(JobWorker).start();
  app.get(CallbackWorker).start();
  logger.log(`Worker running (jobs every ${config().JOB_POLL_MS} ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
