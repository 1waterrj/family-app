import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../../db/migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://family:family@127.0.0.1:54329/family',
  },
});
