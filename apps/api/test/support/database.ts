import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { Database } from '../../src/db/client.js';
import * as schema from '../../src/db/schema.js';

export interface TestDatabase {
  database: Database;
  connectionString: string;
  sql: postgres.Sql;
  stop(): Promise<void>;
}

export interface TestDatabaseOptions {
  migrationsFolder?: string;
  maxConnections?: number;
}

const migrationsFolder = fileURLToPath(
  new URL('../../../../db/migrations', import.meta.url),
);

export async function runMigrations(
  sql: postgres.Sql,
  migrationDirectory = migrationsFolder,
): Promise<void> {
  await migrate(drizzle({ client: sql }), {
    migrationsFolder: migrationDirectory,
  });
}

export async function startTestDatabase(
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const sql = postgres(container.getConnectionUri(), {
    max: options.maxConnections ?? 1,
  });
  const database: Database = drizzle({ client: sql, schema });

  try {
    await runMigrations(sql, options.migrationsFolder);
  } catch (error) {
    try {
      await sql.end({ timeout: 5 });
    } finally {
      await container.stop();
    }
    throw error;
  }

  return {
    database,
    connectionString: container.getConnectionUri(),
    sql,
    async stop() {
      try {
        await sql.end({ timeout: 5 });
      } finally {
        await container.stop();
      }
    },
  };
}
