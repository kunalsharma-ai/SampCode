import './database-url';
import { logger } from './bootstrap';
import { config } from './config';
import { closeOnSignals, createApp } from './http/app';

async function main() {
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
