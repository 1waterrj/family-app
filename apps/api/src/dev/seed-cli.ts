import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDatabase } from '../db/client.js';
import { seedDevelopmentHousehold } from './seed.js';

type SeedCliOptions = {
  environment?: Record<string, string | undefined>;
  outputDirectory?: string;
  now?: Date;
  createDatabase?: typeof createDatabase;
  seedDevelopmentHousehold?: typeof seedDevelopmentHousehold;
};

export async function runDevelopmentSeedCli(
  options: SeedCliOptions = {},
): Promise<void> {
  const environment = options.environment ?? process.env;
  if (environment.NODE_ENV === 'production') {
    throw new Error('Development household seed is disabled in production.');
  }

  const databaseUrl = requiredEnvironment(environment, 'DATABASE_URL');
  const developmentAuthSecret = requiredEnvironment(
    environment,
    'DEVELOPMENT_AUTH_SECRET',
  );
  const parentApiOrigin = requiredEnvironment(
    environment,
    'DEV_PARENT_API_ORIGIN',
  );
  const dashboardApiOrigin = requiredEnvironment(
    environment,
    'DEV_DASHBOARD_API_ORIGIN',
  );
  const databaseFactory = options.createDatabase ?? createDatabase;
  const runSeed = options.seedDevelopmentHousehold ?? seedDevelopmentHousehold;
  const database = databaseFactory(databaseUrl);

  try {
    await runSeed({
      database,
      developmentAuthSecret,
      parentApiOrigin,
      dashboardApiOrigin,
      outputDirectory: options.outputDirectory ?? '.local/dev-fixtures',
      now: options.now ?? new Date(),
    });
  } finally {
    await database.$client.end({ timeout: 5 });
  }
}

function requiredEnvironment(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function isExecutedDirectly(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href,
  );
}

if (isExecutedDirectly()) {
  await runDevelopmentSeedCli();
}
