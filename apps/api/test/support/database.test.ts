import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { startTestDatabase } from './database.js';

describe('test database lifecycle', () => {
  it('cleans up a real container when migration setup fails', async () => {
    const emptyMigrationsFolder = await mkdtemp(
      join(tmpdir(), 'family-api-empty-migrations-'),
    );

    try {
      const result = await startTestDatabase({
        migrationsFolder: emptyMigrationsFolder,
      }).then(
        (database) => ({ database }),
        (error: unknown) => ({ error }),
      );

      expect(result).toMatchObject({ error: expect.any(Error) });
      await result.database?.stop();
    } finally {
      await rm(emptyMigrationsFolder, { recursive: true, force: true });
    }
  }, 60_000);

  it('stops a real database after its SQL client has ended', async () => {
    const database = await startTestDatabase();

    await database.sql.end({ timeout: 5 });
    await expect(database.stop()).resolves.toBeUndefined();
  }, 60_000);
});
