import {
  createFamilyApiClient,
  familyQueryKeys,
  type ClientSession,
} from '@family/api-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
  queryOptions,
  type DehydrateOptions,
} from '@tanstack/react-query';
import type { DashboardSnapshot } from '@family/contracts';

import type { AsyncKeyValueStore } from './indexed-db-storage';

export function dashboardQueryCacheBuster(session: ClientSession): string {
  return `${session.apiOrigin}:${session.householdId}:${session.actorId}:${session.role}`;
}

export function dashboardQueryPersistenceKey(session: ClientSession): string {
  return `family-dashboard-query-cache:${encodeURIComponent(dashboardQueryCacheBuster(session))}`;
}

export function createDashboardDehydrateOptions(
  session: ClientSession,
): DehydrateOptions {
  return {
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) &&
      queryKeysEqual(
        query.queryKey,
        familyQueryKeys.dashboardSnapshot(session),
      ),
    shouldDehydrateMutation: () => false,
  };
}

export function createDashboardQueryClient(
  session: ClientSession,
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 7 * 24 * 60 * 60 * 1_000,
        retry: 2,
      },
      mutations: { retry: false },
      dehydrate: createDashboardDehydrateOptions(session),
    },
  });
}

export function createDashboardQueryPersister(
  storage: AsyncKeyValueStore,
  session: ClientSession,
) {
  return createAsyncStoragePersister({
    storage,
    key: dashboardQueryPersistenceKey(session),
  });
}

export function dashboardSnapshotQueryOptions(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
) {
  const client = createFamilyApiClient({
    apiOrigin: session.apiOrigin,
    accessToken: session.accessToken,
    fetch: fetchImpl,
  });
  return queryOptions({
    queryKey: familyQueryKeys.dashboardSnapshot(session),
    queryFn: () => client.getDashboardSnapshot(),
    refetchInterval: (query) =>
      dashboardSnapshotPollingInterval(
        query.state.data,
        document.visibilityState,
      ),
    refetchIntervalInBackground: false,
  });
}

export function dashboardSnapshotPollingInterval(
  snapshot: DashboardSnapshot | undefined,
  visibilityState: DocumentVisibilityState,
): number | false {
  if (visibilityState !== 'visible') return false;
  const hasActiveWork = snapshot?.chores.some(
    ({ status }) => status === 'CLAIMED' || status === 'AWAITING_APPROVAL',
  );
  return hasActiveWork ? 5_000 : 30_000;
}

function queryKeysEqual(
  candidate: readonly unknown[],
  expected: readonly unknown[],
): boolean {
  return (
    candidate.length === expected.length &&
    candidate.every((segment, index) => segment === expected[index])
  );
}
