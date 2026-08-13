import { familyQueryKeys } from '@family/api-client';
import { dehydrate } from '@tanstack/react-query';

import {
  createDashboardDehydrateOptions,
  createDashboardQueryClient,
  dashboardQueryCacheBuster,
  dashboardSnapshotPollingInterval,
} from '../src/query/dashboard-query';
import { dashboardSession, dashboardSnapshot } from './test-fixtures';

describe('dashboard persisted query ownership', () => {
  test('persists exactly the active dashboard snapshot and no mutations', async () => {
    const queryClient = createDashboardQueryClient(dashboardSession);
    queryClient.setQueryData(
      familyQueryKeys.dashboardSnapshot(dashboardSession),
      'dashboard snapshot',
    );
    queryClient.setQueryData(
      familyQueryKeys.parentSnapshot({ ...dashboardSession, role: 'PARENT' }),
      'parent snapshot',
    );
    queryClient.setQueryData(['family', 'form-draft'], 'draft');
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ['family', 'claim'],
      mutationFn: async () => 'claimed',
    });
    await mutation.execute(undefined);

    const persisted = dehydrate(
      queryClient,
      createDashboardDehydrateOptions(dashboardSession),
    );

    expect(persisted.queries.map((query) => query.state.data)).toEqual([
      'dashboard snapshot',
    ]);
    expect(persisted.mutations).toEqual([]);
    queryClient.clear();
  });

  test('binds cached reads to origin, household, actor, and dashboard role', () => {
    expect(dashboardQueryCacheBuster(dashboardSession)).toBe(
      'http://127.0.0.1:5173:20000000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000001:DASHBOARD',
    );
    expect(
      dashboardQueryCacheBuster({
        ...dashboardSession,
        actorId: '10000000-0000-4000-8000-000000000009',
      }),
    ).not.toBe(dashboardQueryCacheBuster(dashboardSession));
  });

  test('polls active work every five seconds, idle work every thirty, and pauses while hidden', () => {
    expect(dashboardSnapshotPollingInterval(dashboardSnapshot, 'visible')).toBe(
      5_000,
    );
    expect(
      dashboardSnapshotPollingInterval(
        {
          ...dashboardSnapshot,
          chores: dashboardSnapshot.chores.map((chore) => ({
            ...chore,
            status: 'AVAILABLE' as const,
          })),
        },
        'visible',
      ),
    ).toBe(30_000);
    expect(dashboardSnapshotPollingInterval(dashboardSnapshot, 'hidden')).toBe(
      false,
    );
  });
});
