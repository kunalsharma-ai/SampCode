import './database-url';
import { logger } from './bootstrap';
import { config } from './config';
import { closeOnSignals, createApp } from './http/app';
import { loadInstallationSecrets, retiredEnvInUse } from './platform/installation-secrets';

async function main() {
  // JWT_SECRET and SIGNING_KEYS_SECRET: made on the first start and kept in MongoDB (ADR 0043).
  const made = await loadInstallationSecrets();
  if (made.length) logger.log(`${made.join(' and ')} read from the database`);
  const retired = retiredEnvInUse();
  if (retired.length) logger.warn(`Ignored (API keys are set in Settings > Integrations now, ADR 0043): ${retired.join(', ')}`);
  const cfg = config();
  const app = createApp();
  await app.listen(cfg.API_PORT);
  closeOnSignals(app, logger);
  logger.log(`API listening on http://localhost:${cfg.API_PORT}/api`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
