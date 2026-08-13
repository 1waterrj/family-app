import {
  parsePersistedClientSession,
  type ClientSession,
} from '@family/api-client';

import { dashboardQueryPersistenceKey } from '../query/dashboard-query';
import type { AsyncKeyValueStore } from '../query/indexed-db-storage';

export const DASHBOARD_SESSION_KEY = 'family-dashboard-session';

export interface DashboardSessionStore {
  load(): Promise<ClientSession | undefined>;
  save(session: ClientSession): Promise<void>;
  clear(): Promise<void>;
}

export function createDashboardSessionStore({
  sessionStorage,
  queryStorage,
}: {
  sessionStorage: AsyncKeyValueStore;
  queryStorage: AsyncKeyValueStore;
}): DashboardSessionStore {
  async function load(): Promise<ClientSession | undefined> {
    const serialized = await sessionStorage.getItem(DASHBOARD_SESSION_KEY);
    if (!serialized) return undefined;
    const session = parseDashboardSession(serialized);
    if (session) return session;
    await Promise.allSettled([
      sessionStorage.removeItem(DASHBOARD_SESSION_KEY),
    ]);
    return undefined;
  }

  return {
    load,
    async save(session) {
      if (session.role !== 'DASHBOARD') {
        throw new Error('Dashboard sessions require the DASHBOARD role.');
      }
      const priorSession = await load();
      if (
        priorSession &&
        dashboardQueryPersistenceKey(priorSession) !==
          dashboardQueryPersistenceKey(session)
      ) {
        await queryStorage.removeItem(
          dashboardQueryPersistenceKey(priorSession),
        );
      }
      await sessionStorage.setItem(
        DASHBOARD_SESSION_KEY,
        JSON.stringify(session),
      );
    },
    async clear() {
      const priorSession = await load();
      const cleanupResults = await Promise.allSettled([
        priorSession
          ? queryStorage.removeItem(dashboardQueryPersistenceKey(priorSession))
          : Promise.resolve(),
        sessionStorage.removeItem(DASHBOARD_SESSION_KEY),
      ]);
      for (const result of cleanupResults) {
        if (result.status === 'rejected') throw result.reason;
      }
    },
  };
}

function parseDashboardSession(value: string): ClientSession | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsePersistedClientSession(parsed, 'DASHBOARD') ?? undefined;
  } catch {
    return undefined;
  }
}
