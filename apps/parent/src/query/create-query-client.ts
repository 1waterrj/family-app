import type AsyncStorage from '@react-native-async-storage/async-storage';
import { familyQueryKeys, type ClientSession } from '@family/api-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
  type DehydrateOptions,
} from '@tanstack/react-query';

export function parentQueryCacheBuster(session: ClientSession): string {
  return `${session.apiOrigin}:${session.householdId}:${session.actorId}:${session.role}`;
}

export function parentQueryPersistenceKey(session: ClientSession): string {
  return `family-parent-query-cache:${encodeURIComponent(parentQueryCacheBuster(session))}`;
}

export function createParentDehydrateOptions(
  session: ClientSession,
): DehydrateOptions {
  return {
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) &&
      isPersistableRead(session, query.queryKey),
    shouldDehydrateMutation: () => false,
  };
}

export function createParentQueryClient(session: ClientSession): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 7 * 24 * 60 * 60 * 1_000,
        retry: 2,
      },
      mutations: {
        retry: false,
      },
      dehydrate: createParentDehydrateOptions(session),
    },
  });
}

export function createParentQueryPersister(
  asyncStorage: typeof AsyncStorage,
  session: ClientSession,
) {
  return createAsyncStoragePersister({
    storage: asyncStorage,
    key: parentQueryPersistenceKey(session),
  });
}

function isPersistableRead(
  session: ClientSession,
  queryKey: readonly unknown[],
): boolean {
  if (queryKeysEqual(queryKey, familyQueryKeys.parentSnapshot(session))) {
    return true;
  }
  if (queryKeysEqual(queryKey, familyQueryKeys.feedbackList(session))) {
    return true;
  }
  if (queryKey.length !== 7 || typeof queryKey[6] !== 'string') {
    return false;
  }
  return queryKeysEqual(queryKey, familyQueryKeys.ledger(session, queryKey[6]));
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
