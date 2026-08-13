import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { ActorAuthenticator } from '../src/auth/actor-context.js';
import type { Database } from '../src/db/client.js';

const privateCanary = 'PRIVATE-FEEDBACK-CANARY-7c512a';

describe('API error logging privacy', () => {
  it('logs only allowlisted request metadata for database failures', async () => {
    // Break caught: Drizzle/Postgres error serialization publishes private request values from message, params, query, cause, or stack.
    const logs: string[] = [];
    const databaseError = Object.assign(new Error(privateCanary), {
      params: [privateCanary],
      query: `insert into feedback_reports values ('${privateCanary}')`,
      cause: new Error(`nested ${privateCanary}`),
    });
    const database = {
      execute: async () => Promise.reject(databaseError),
      transaction: async () => Promise.reject(databaseError),
    } as unknown as Database;
    const actorId = randomUUID();
    const householdId = randomUUID();
    const actorAuthenticator: ActorAuthenticator = {
      kind: 'production',
      authenticate: async () => ({
        role: 'PARENT',
        actorId,
        householdId,
      }),
    };
    const app = buildApp({
      database,
      nodeEnv: 'test',
      actorAuthenticator,
      logger: {
        level: 'error',
        stream: { write: (message) => void logs.push(message) },
      },
    });

    try {
      const feedback = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        headers: { 'idempotency-key': randomUUID() },
        payload: {
          category: 'BROKEN',
          description: privateCanary,
          diagnosticSnapshot: {
            source: 'PARENT_IOS',
            appVersion: '1.2.3',
            currentScreen: 'PARENT_FEEDBACK',
            events: [],
          },
        },
      });
      const readiness = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(feedback.statusCode).toBe(500);
      expect(readiness.statusCode).toBe(503);
      expect(logs.join('\n')).not.toContain(privateCanary);
      expect(logs.join('\n')).not.toMatch(/"(?:err|params|query|stack)"/iu);
    } finally {
      await app.close();
    }
  });
});
