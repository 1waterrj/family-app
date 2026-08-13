import {
  createDashboardSessionStore,
  DASHBOARD_SESSION_KEY,
} from '../src/auth/dashboard-session';
import { dashboardQueryPersistenceKey } from '../src/query/dashboard-query';
import type { AsyncKeyValueStore } from '../src/query/indexed-db-storage';
import { dashboardSession } from './test-fixtures';

function memoryStore(events: string[] = []): AsyncKeyValueStore {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      events.push(`set:${key}`);
      values.set(key, value);
    },
    async removeItem(key) {
      events.push(`remove:${key}`);
      values.delete(key);
    },
  };
}

describe('dashboard browser session partitioning', () => {
  test('normalizes a valid restored local dashboard origin', async () => {
    const sessionStorage = memoryStore();
    const store = createDashboardSessionStore({
      sessionStorage,
      queryStorage: memoryStore(),
    });
    await sessionStorage.setItem(
      DASHBOARD_SESSION_KEY,
      JSON.stringify({
        ...dashboardSession,
        apiOrigin: 'HTTP://LOCALHOST:80/',
      }),
    );

    await expect(store.load()).resolves.toEqual({
      ...dashboardSession,
      apiOrigin: 'http://localhost',
    });
  });

  test.each([
    ['public origin', { apiOrigin: 'https://family.example.test' }],
    ['deceptive origin', { apiOrigin: 'http://localhost.example.com' }],
    ['malformed actor id', { actorId: 'not-a-uuid' }],
    ['malformed household id', { householdId: 'not-a-uuid' }],
    ['wrong role', { role: 'PARENT' }],
    ['empty token', { accessToken: '' }],
  ])(
    'fails closed and scrubs a restored session with a %s',
    async (_case, override) => {
      const sessionStorage = memoryStore();
      const store = createDashboardSessionStore({
        sessionStorage,
        queryStorage: memoryStore(),
      });
      await sessionStorage.setItem(
        DASHBOARD_SESSION_KEY,
        JSON.stringify({ ...dashboardSession, ...override }),
      );

      await expect(store.load()).resolves.toBeUndefined();
      expect(await sessionStorage.getItem(DASHBOARD_SESSION_KEY)).toBeNull();
    },
  );

  test('removes the prior actor IndexedDB cache before publishing the new session', async () => {
    const events: string[] = [];
    const sessionStorage = memoryStore(events);
    const queryStorage = memoryStore(events);
    const store = createDashboardSessionStore({ sessionStorage, queryStorage });
    await store.save(dashboardSession);
    events.length = 0;

    const replacement = {
      ...dashboardSession,
      actorId: '10000000-0000-4000-8000-000000000009',
    };
    await store.save(replacement);

    expect(events).toEqual([
      `remove:${dashboardQueryPersistenceKey(dashboardSession)}`,
      `set:${DASHBOARD_SESSION_KEY}`,
    ]);
    expect(await store.load()).toEqual(replacement);
  });

  test('refuses a parent session at the storage boundary', async () => {
    const store = createDashboardSessionStore({
      sessionStorage: memoryStore(),
      queryStorage: memoryStore(),
    });

    await expect(
      store.save({ ...dashboardSession, role: 'PARENT' }),
    ).rejects.toThrow('Dashboard sessions require the DASHBOARD role.');
    expect(await store.load()).toBeUndefined();
  });

  test('removes the session even when its persisted query cache cannot be removed', async () => {
    const sessionStorage = memoryStore();
    const underlyingQueryStorage = memoryStore();
    const cacheKey = dashboardQueryPersistenceKey(dashboardSession);
    const queryStorage: AsyncKeyValueStore = {
      ...underlyingQueryStorage,
      async removeItem(key) {
        if (key === cacheKey) throw new Error('cache unavailable');
        await underlyingQueryStorage.removeItem(key);
      },
    };
    const store = createDashboardSessionStore({
      sessionStorage,
      queryStorage,
    });
    await store.save(dashboardSession);
    await underlyingQueryStorage.setItem(cacheKey, 'private snapshot');

    await expect(store.clear()).rejects.toThrow('cache unavailable');

    expect(await sessionStorage.getItem(DASHBOARD_SESSION_KEY)).toBeNull();
    expect(await underlyingQueryStorage.getItem(cacheKey)).toBe(
      'private snapshot',
    );
  });
});
