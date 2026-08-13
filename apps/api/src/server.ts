import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { createDatabase } from './db/client.js';
import {
  FEEDBACK_RETENTION_BATCH_SIZE,
  FEEDBACK_RETENTION_INTERVAL_MS,
  FEEDBACK_RETENTION_MS,
  startFeedbackRetentionWorker,
} from './workers/feedback-retention.js';

const config = readConfig(process.env);
const database = createDatabase(config.databaseUrl);
const app = buildApp({
  database,
  nodeEnv: config.nodeEnv,
  developmentAuthSecret: config.developmentAuthSecret,
  householdPayoutCeilingCents: config.householdPayoutCeilingCents,
  feedbackGithubRepository: config.feedbackGithubRepository,
  logger: true,
});

const feedbackRetentionWorker = startFeedbackRetentionWorker({
  database,
  intervalMs: FEEDBACK_RETENTION_INTERVAL_MS,
  retentionMs: FEEDBACK_RETENTION_MS,
  batchSize: FEEDBACK_RETENTION_BATCH_SIZE,
  log: app.log,
});

app.addHook('onClose', async () => {
  await feedbackRetentionWorker.stop();
  await database.$client.end({ timeout: 5 });
});

try {
  await feedbackRetentionWorker.initialCleanup;
  await app.listen({ host: config.apiHost, port: config.apiPort });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
