import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runDevelopmentSeedCli } from '../src/dev/seed-cli.js';

describe('development seed CLI', () => {
  it('refuses production before constructing a database client or creating files', async () => {
    // Break caught: the CLI performing configuration side effects before its
    // production defense, even though the seed function eventually refuses.
    const outputDirectory = join(
      process.cwd(),
      '.local/production-cli-tripwire',
    );

    await expect(
      runDevelopmentSeedCli({
        environment: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://fixture',
          DEVELOPMENT_AUTH_SECRET: 'fixture-development-secret',
          DEV_PARENT_API_ORIGIN: 'http://192.168.20.15:3000',
          DEV_DASHBOARD_API_ORIGIN: 'http://127.0.0.1:5173',
        },
        outputDirectory,
        createDatabase() {
          throw new Error('Database client was constructed.');
        },
        async seedDevelopmentHousehold() {
          throw new Error('Seed function was invoked.');
        },
      }),
    ).rejects.toThrow('Development household seed is disabled in production.');

    await expect(stat(outputDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
