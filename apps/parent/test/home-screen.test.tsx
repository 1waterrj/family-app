import type { ClientSession } from '@family/api-client';
import { ParentSnapshotSchema } from '@family/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { createParentQueryClient } from '../src/query/create-query-client';
import { HomeScreen } from '../src/screens/home-screen';

const session: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

const snapshot = ParentSnapshotSchema.parse({
  household: {
    id: session.householdId,
    name: 'Example Family',
    timeZone: 'America/New_York',
    createdAt: '2026-08-01T12:00:00.000Z',
  },
  serverTime: '2026-08-10T12:00:00.000Z',
  children: [
    {
      profile: {
        id: '30000000-0000-4000-8000-000000000001',
        householdId: session.householdId,
        name: 'Avery',
        color: '#7B61A8',
        imageUrl: null,
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      balanceCents: 850,
    },
    {
      profile: {
        id: '30000000-0000-4000-8000-000000000002',
        householdId: session.householdId,
        name: 'Riley',
        color: '#197C83',
        imageUrl: null,
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      balanceCents: 325,
    },
  ],
  templates: [],
  chores: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      householdId: session.householdId,
      choreTemplateId: '50000000-0000-4000-8000-000000000001',
      name: 'Make the bed',
      imageKey: 'make-bed',
      imageUrl: null,
      instructions: 'Pull up the covers.',
      valueCents: 150,
      durationMinutes: 15,
      status: 'CLAIMED',
      claimedChildId: '30000000-0000-4000-8000-000000000001',
      claimDeadlineAt: '2026-08-10T12:15:00.000Z',
      submittedAt: null,
      createdAt: '2026-08-10T12:00:00.000Z',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      householdId: session.householdId,
      choreTemplateId: '50000000-0000-4000-8000-000000000002',
      name: 'Tidy toys',
      imageKey: 'tidy-toys',
      imageUrl: null,
      instructions: 'Put toys in their bins.',
      valueCents: 200,
      durationMinutes: 20,
      status: 'AWAITING_APPROVAL',
      claimedChildId: '30000000-0000-4000-8000-000000000002',
      claimDeadlineAt: '2026-08-10T12:20:00.000Z',
      submittedAt: '2026-08-10T12:10:00.000Z',
      createdAt: '2026-08-10T12:00:00.000Z',
    },
  ],
  pendingApprovals: [
    {
      submissionAttemptId: '60000000-0000-4000-8000-000000000001',
      child: {
        id: '30000000-0000-4000-8000-000000000002',
        householdId: session.householdId,
        name: 'Riley',
        color: '#197C83',
        imageUrl: null,
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      chore: {
        id: '40000000-0000-4000-8000-000000000002',
        householdId: session.householdId,
        choreTemplateId: '50000000-0000-4000-8000-000000000002',
        name: 'Tidy toys',
        imageKey: 'tidy-toys',
        imageUrl: null,
        instructions: 'Put toys in their bins.',
        valueCents: 200,
        durationMinutes: 20,
        status: 'AWAITING_APPROVAL',
        claimedChildId: '30000000-0000-4000-8000-000000000002',
        claimDeadlineAt: '2026-08-10T12:20:00.000Z',
        submittedAt: '2026-08-10T12:10:00.000Z',
        createdAt: '2026-08-10T12:00:00.000Z',
      },
      claimedAt: '2026-08-10T12:00:00.000Z',
      submittedAt: '2026-08-10T12:10:00.000Z',
    },
  ],
});

function snapshotFetch(): typeof globalThis.fetch {
  return async () =>
    new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

function renderHome(isOnline = true, onOpenApprovals = () => undefined) {
  const queryClient = createParentQueryClient(session);
  trackedQueryClients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <HomeScreen
        session={session}
        fetch={snapshotFetch()}
        isOnline={isOnline}
        onOpenApprovals={onOpenApprovals}
      />
    </QueryClientProvider>,
  );
}

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) {
    queryClient.clear();
  }
});

describe('parent home', () => {
  test('renders child balances, an active chore, and the pending approval count from a validated snapshot', async () => {
    renderHome();

    expect(await screen.findByText('Avery')).toBeVisible();
    expect(screen.getByText('$8.50')).toBeVisible();
    expect(screen.getByText('Riley')).toBeVisible();
    expect(screen.getByText('$3.25')).toBeVisible();
    expect(screen.getByText('Make the bed')).toBeVisible();
    expect(screen.getByText('1 chore awaiting approval')).toBeVisible();
  });

  test('labels cached household data as offline without blanking it', async () => {
    renderHome(false);

    expect(
      await screen.findByText('Offline — showing saved data'),
    ).toBeVisible();
    expect(screen.getByText('Avery')).toBeVisible();
    expect(screen.getByText('$8.50')).toBeVisible();
  });

  test('opens the approval inbox from the pending count control', async () => {
    const onOpenApprovals = jest.fn();
    renderHome(true, onOpenApprovals);

    fireEvent.press(
      await screen.findByRole('button', { name: 'Review 1 pending approval' }),
    );

    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });
});
