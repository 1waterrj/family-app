import type { Database } from './client.js';

export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
