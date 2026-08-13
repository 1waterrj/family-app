import { familyQueryKeys, type ClientSession } from '@family/api-client';
import { dehydrate } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import {
  createParentDehydrateOptions,
  createParentQueryClient,
  parentQueryCacheBuster,
} from '../src/query/create-query-client';

const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

const trackedQueryClients: QueryClient[] = [];

function createTrackedQueryClient(): QueryClient {
  const queryClient = createParentQueryClient(parentSession);
  trackedQueryClients.push(queryClient);
  return queryClient;
}

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) {
    queryClient.clear();
  }
});

describe('parent persisted query ownership', () => {
  test('persists parent snapshots, child ledgers, and only the scrubbed feedback list', () => {
    const queryClient = createTrackedQueryClient();
    queryClient.setQueryData(
      familyQueryKeys.parentSnapshot(parentSession),
      'parent snapshot',
    );
    queryClient.setQueryData(
      familyQueryKeys.ledger(
        parentSession,
        '30000000-0000-4000-8000-000000000001',
      ),
      'child ledger',
    );
    queryClient.setQueryData(
      familyQueryKeys.dashboardSnapshot({
        ...parentSession,
        role: 'DASHBOARD',
      }),
      'dashboard snapshot',
    );
    queryClient.setQueryData(
      familyQueryKeys.feedbackList(parentSession),
      'feedback list',
    );
    queryClient.setQueryData(
      familyQueryKeys.feedbackDetail(
        parentSession,
        '30000000-0000-4000-8000-000000000099',
      ),
      'private diagnostic detail',
    );
    queryClient.setQueryData(['unowned', 'form-draft'], 'secret draft');

    const persisted = dehydrate(
      queryClient,
      createParentDehydrateOptions(parentSession),
    );

    expect(persisted.queries.map((query) => query.state.data)).toEqual([
      'parent snapshot',
      'child ledger',
      'feedback list',
    ]);
  });

  test('rejects suffix lookalikes and family reads outside the active session scope', () => {
    const queryClient = createTrackedQueryClient();
    const childId = '30000000-0000-4000-8000-000000000001';

    queryClient.setQueryData(
      familyQueryKeys.parentSnapshot(parentSession),
      'owned parent snapshot',
    );
    queryClient.setQueryData(
      familyQueryKeys.ledger(parentSession, childId),
      'owned child ledger',
    );

    const unownedKeys = [
      [
        'unowned',
        parentSession.apiOrigin,
        parentSession.householdId,
        parentSession.actorId,
        'PARENT',
        'parent-snapshot',
      ],
      ['unowned', 'ledger', childId],
      [
        'family',
        'http://192.168.1.10:3000',
        parentSession.householdId,
        parentSession.actorId,
        'PARENT',
        'parent-snapshot',
      ],
      [
        'family',
        parentSession.apiOrigin,
        '20000000-0000-4000-8000-000000000009',
        parentSession.actorId,
        'PARENT',
        'parent-snapshot',
      ],
      [
        'family',
        parentSession.apiOrigin,
        parentSession.householdId,
        '10000000-0000-4000-8000-000000000009',
        'PARENT',
        'parent-snapshot',
      ],
      [
        'family',
        parentSession.apiOrigin,
        parentSession.householdId,
        parentSession.actorId,
        'DASHBOARD',
        'ledger',
        childId,
      ],
      [...familyQueryKeys.parentSnapshot(parentSession), 'parent-snapshot'],
    ] as const;

    for (const [index, queryKey] of unownedKeys.entries()) {
      queryClient.setQueryData(queryKey, `unowned read ${index}`);
    }

    const persisted = dehydrate(
      queryClient,
      createParentDehydrateOptions(parentSession),
    );

    expect(persisted.queries.map((query) => query.state.data)).toEqual([
      'owned parent snapshot',
      'owned child ledger',
    ]);
  });

  test('does not persist completed mutations', async () => {
    jest.useFakeTimers();
    try {
      const queryClient = createTrackedQueryClient();
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationKey: ['family', 'approval-form'],
        mutationFn: async () => 'approved',
      });
      await mutation.execute(undefined);

      const persisted = dehydrate(
        queryClient,
        createParentDehydrateOptions(parentSession),
      );

      expect(persisted.mutations).toEqual([]);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  test('binds persisted data to origin, household, actor, and role', () => {
    expect(parentQueryCacheBuster(parentSession)).toBe(
      'http://127.0.0.1:3000:20000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:PARENT',
    );
    expect(
      parentQueryCacheBuster({
        ...parentSession,
        actorId: '10000000-0000-4000-8000-000000000009',
      }),
    ).not.toBe(parentQueryCacheBuster(parentSession));
  });
});
