import { familyQueryKeys } from '@family/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { createDashboardQueryClient } from '../src/query/dashboard-query';
import { FamilyHomeScreen } from '../src/screens/family-home-screen';
import { dashboardSession, dashboardSnapshot } from './test-fixtures';

describe('family kitchen home', () => {
  test('keeps a cached snapshot visible while offline and reports when it was updated', () => {
    const queryClient = createDashboardQueryClient(dashboardSession);
    queryClient.setQueryData(
      familyQueryKeys.dashboardSnapshot(dashboardSession),
      dashboardSnapshot,
      { updatedAt: Date.parse('2026-08-10T11:45:00.000Z') },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <FamilyHomeScreen
          session={dashboardSession}
          fetch={async () => {
            throw new TypeError('offline');
          }}
          isOnline={false}
          now={() => new Date('2026-08-10T12:00:00.000Z')}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Avery')).toBeVisible();
    expect(screen.getByText('$8.50')).toBeVisible();
    expect(screen.getByText('Riley')).toBeVisible();
    expect(screen.getByText('$3.25')).toBeVisible();
    expect(screen.getByText('Make the bed')).toBeVisible();
    expect(screen.getByText('1 chore ready')).toBeVisible();
    expect(screen.getByText(/^Last updated /)).toHaveTextContent(
      'Last updated 7:45 AM',
    );
    expect(screen.getByText('Offline — showing saved data')).toBeVisible();
    queryClient.clear();
  });

  test('renders the Chore Board as a dashboard-sized primary target', () => {
    const queryClient = createDashboardQueryClient(dashboardSession);
    queryClient.setQueryData(
      familyQueryKeys.dashboardSnapshot(dashboardSession),
      dashboardSnapshot,
    );

    render(
      <QueryClientProvider client={queryClient}>
        <FamilyHomeScreen
          session={dashboardSession}
          fetch={async () => new Response()}
          isOnline
          now={() => new Date('2026-08-10T12:00:00.000Z')}
        />
      </QueryClientProvider>,
    );

    const primaryAction = screen.getByRole('button', {
      name: 'Open Chore Board',
    });
    expect(getComputedStyle(primaryAction).minHeight).toBe('64px');
    expect(getComputedStyle(primaryAction).minWidth).toBe('64px');
    queryClient.clear();
  });

  test('opens a child-owned active chore from the family home', () => {
    const queryClient = createDashboardQueryClient(dashboardSession);
    queryClient.setQueryData(
      familyQueryKeys.dashboardSnapshot(dashboardSession),
      dashboardSnapshot,
    );
    const openActiveChore = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <FamilyHomeScreen
          session={dashboardSession}
          fetch={async () => new Response()}
          isOnline
          now={() => new Date('2026-08-10T12:00:00.000Z')}
          onOpenActiveChore={openActiveChore}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: "Open Avery's chore Make the bed" }),
    );
    expect(openActiveChore).toHaveBeenCalledWith(
      dashboardSnapshot.chores[0],
      dashboardSnapshot.children[0],
    );
    queryClient.clear();
  });
});
