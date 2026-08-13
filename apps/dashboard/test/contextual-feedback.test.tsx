import {
  createFeedbackOutbox,
  FamilyApiError,
  type ClientSession,
} from '@family/api-client';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { App, DASHBOARD_FEEDBACK_OUTBOX_KEY } from '../src/app';
import type { DashboardSessionStore } from '../src/auth/dashboard-session';
import type { AsyncKeyValueStore } from '../src/query/indexed-db-storage';
import { ActiveChoreScreen } from '../src/screens/active-chore-screen';
import { ChoreDetailScreen } from '../src/screens/chore-detail-screen';
import { FamilyHomeScreen } from '../src/screens/family-home-screen';
import { SetupScreen } from '../src/screens/setup-screen';
import {
  credentialJson,
  dashboardSession,
  dashboardSnapshot,
} from './test-fixtures';

const rawFailure =
  'Avery failed Tidy toys at https://private.test/families/secret-family';

describe('dashboard contextual feedback', () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => {
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  test('opens an editable BROKEN overlay from snapshot failure without automatic submission or private diagnostics', async () => {
    // Break caught: the snapshot failure cannot open feedback, bypasses the modal, or copies raw server data.
    const storage = memoryStore();
    const requests: Request[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (new URL(request.url).pathname === '/v1/feedback') {
        return Response.json(feedbackReceipt);
      }
      return Response.json(
        {
          code: 'INTERNAL_ERROR',
          message: rawFailure,
          requestId: '90000000-0000-4000-8000-000000000001',
        },
        { status: 503 },
      );
    };
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );

    await screen.findByRole(
      'button',
      { name: 'Report this problem' },
      { timeout: 6_000 },
    );
    const retryButton = screen.getByRole('button', { name: 'Try again' });
    const attemptsBeforeRetry = snapshotRequests(requests).length;
    fireEvent.click(retryButton);
    await waitFor(() =>
      expect(snapshotRequests(requests)).toHaveLength(attemptsBeforeRetry + 1),
    );
    await screen.findByText('Loading your family…');
    const reportButtonAfterRetry = await screen.findByRole(
      'button',
      { name: 'Report this problem' },
      { timeout: 6_000 },
    );
    fireEvent.click(reportButtonAfterRetry);

    expect(screen.getByRole('dialog', { name: 'Tell us' })).toBeVisible();
    expect(screen.getByTestId('dashboard-content')).toHaveAttribute('inert');
    expect(
      screen.getByRole('button', { name: 'Something broke' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Tell us more (optional)')).toHaveValue('');
    expect(feedbackRequests(requests)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(reportButtonAfterRetry).toHaveFocus());
    fireEvent.click(reportButtonAfterRetry);
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(feedbackRequests(requests)).toHaveLength(1));
    const command = (await feedbackRequests(requests)[0]!.json()) as {
      category: string;
      description: string;
      diagnosticSnapshot: { events: unknown[] };
    };
    expect(command.category).toBe('BROKEN');
    expect(command.description).toBe('');
    expect(command.diagnosticSnapshot.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'SCREEN', screen: 'DASHBOARD_HOME' }),
      ]),
    );
    const diagnostics = JSON.stringify(command.diagnosticSnapshot);
    expect(diagnostics).not.toContain(rawFailure);
    expect(diagnostics).not.toContain(dashboardSession.accessToken);
    expect(diagnostics).not.toContain(
      dashboardSnapshot.children[0]!.profile.id,
    );
    expect(diagnostics).not.toContain('Avery');
    expect(diagnostics).not.toContain('Tidy toys');
    expect(diagnostics).not.toContain('https://private.test');
  }, 12_000);

  test('keeps an expected snapshot 4xx recoverable without offering a problem report', async () => {
    // Break caught: an expired or rejected dashboard session is mislabeled as an unexpected product failure.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <FamilyHomeScreen
          session={dashboardSession}
          fetch={async () =>
            Response.json(
              {
                code: 'UNAUTHORIZED',
                message: 'The dashboard session is no longer valid.',
                requestId: '90000000-0000-4000-8000-000000000002',
              },
              { status: 401 },
            )
          }
          isOnline
          onReportProblem={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        'Family data could not be loaded. Try again in a moment.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Report this problem' }),
    ).not.toBeInTheDocument();
    queryClient.clear();
  });

  test('keeps claim retry and reports only fixed chore-detail context', async () => {
    // Break caught: claim reporting replaces retry or forwards the child, chore, request body, or raw exception.
    const openDraft = vi.fn();
    const chore = dashboardSnapshot.chores[1]!;
    const child = dashboardSnapshot.children[0]!;
    render(
      <ChoreDetailScreen
        chore={chore}
        children={dashboardSnapshot.children}
        claim={vi.fn().mockRejectedValue(new Error(rawFailure))}
        isOnline
        isConnectivityPaused={false}
        onClaimed={() => undefined}
        onBack={() => undefined}
        onRefresh={() => undefined}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: child.profile.name }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the family server. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'DASHBOARD_CHORE_DETAIL',
    });
    const forwarded = JSON.stringify(openDraft.mock.calls);
    expect(forwarded).not.toContain(rawFailure);
    expect(forwarded).not.toContain(chore.id);
    expect(forwarded).not.toContain(chore.name);
    expect(forwarded).not.toContain(child.profile.id);
    expect(forwarded).not.toContain(child.profile.name);
  });

  test('submits the fixed chore-detail screen from contextual App feedback', async () => {
    // Break caught: opening the shared overlay replaces the contextual screen with DASHBOARD_FEEDBACK before the App snapshots diagnostics.
    const requests: Request[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path === '/v1/feedback') return Response.json(feedbackReceipt);
      if (request.method === 'POST' && path.endsWith('/claim')) {
        return Response.json(
          {
            code: 'INTERNAL_ERROR',
            message: rawFailure,
            requestId: '90000000-0000-4000-8000-000000000003',
          },
          { status: 503 },
        );
      }
      return Response.json(dashboardSnapshot);
    };
    render(
      <App
        sessionStore={fixedSessionStore(dashboardSession)}
        queryStorage={memoryStore()}
        fetch={fetchImpl}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Chore Board' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /open chore tidy toys/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Report this problem' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => expect(feedbackRequests(requests)).toHaveLength(1));
    const command = (await feedbackRequests(requests)[0]!.json()) as {
      diagnosticSnapshot: {
        currentScreen: string;
        events: Array<{ kind: string; screen?: string }>;
      };
    };
    expect(command.diagnosticSnapshot.currentScreen).toBe(
      'DASHBOARD_CHORE_DETAIL',
    );
    expect(command.diagnosticSnapshot.events).toEqual(
      expect.arrayContaining([
        {
          kind: 'SCREEN',
          screen: 'DASHBOARD_CHORE_DETAIL',
          at: expect.any(String),
        },
      ]),
    );
    expect(JSON.stringify(command.diagnosticSnapshot)).not.toContain(
      rawFailure,
    );
  });

  test('does not offer reporting for the expected unavailable-claim conflict', async () => {
    // Break caught: a normal lost claim race is mislabeled as an unexpected product failure.
    const openDraft = vi.fn();
    const back = vi.fn();
    let releaseRefresh!: () => void;
    const refresh = vi.fn(
      () => new Promise<void>((resolve) => (releaseRefresh = resolve)),
    );
    render(
      <ChoreDetailScreen
        chore={dashboardSnapshot.chores[1]!}
        children={dashboardSnapshot.children}
        claim={vi.fn().mockRejectedValue(
          new FamilyApiError('CONFLICT', 'Another helper got there first.', {
            code: 'CHORE_UNAVAILABLE',
          }),
        )}
        isOnline
        isConnectivityPaused={false}
        onClaimed={() => undefined}
        onBack={back}
        onRefresh={refresh}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: 'Avery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That chore was just claimed.',
    );
    expect(
      screen.queryByRole('button', { name: 'Report this problem' }),
    ).not.toBeInTheDocument();
    expect(openDraft).not.toHaveBeenCalled();

    releaseRefresh();
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });

  test('keeps a structured claim-validation failure recoverable without reporting', async () => {
    // Break caught: an expected contracted 4xx falls through the claim flow's generic report path.
    const openDraft = vi.fn();
    const child = dashboardSnapshot.children[0]!;
    render(
      <ChoreDetailScreen
        chore={dashboardSnapshot.chores[1]!}
        children={dashboardSnapshot.children}
        claim={vi.fn().mockRejectedValue(
          new FamilyApiError('VALIDATION', 'The claim is invalid.', {
            code: 'VALIDATION_ERROR',
          }),
        )}
        isOnline
        isConnectivityPaused={false}
        onClaimed={() => undefined}
        onBack={() => undefined}
        onRefresh={() => undefined}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose who' }));
    fireEvent.click(screen.getByRole('button', { name: child.profile.name }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the family server. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Report this problem' }),
    ).not.toBeInTheDocument();
    expect(openDraft).not.toHaveBeenCalled();
  });

  test('keeps completion retry and reports only fixed active-chore context', async () => {
    // Break caught: completion reporting replaces retry or forwards active chore and child content.
    const openDraft = vi.fn();
    const child = dashboardSnapshot.children[0]!;
    const chore = {
      ...dashboardSnapshot.chores[1]!,
      status: 'CLAIMED' as const,
      claimedChildId: child.profile.id,
      claimDeadlineAt: '2026-08-10T12:20:00.000Z',
    };
    render(
      <ActiveChoreScreen
        chore={chore}
        child={child}
        serverOffsetMs={0}
        now={() => Date.parse('2026-08-10T12:10:00.000Z')}
        submit={vi.fn().mockRejectedValue(new Error(rawFailure))}
        onSubmitted={() => undefined}
        onBack={() => undefined}
        onRefresh={() => undefined}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I finished' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the family server. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'DASHBOARD_ACTIVE_CHORE',
    });
    const forwarded = JSON.stringify(openDraft.mock.calls);
    expect(forwarded).not.toContain(rawFailure);
    expect(forwarded).not.toContain(chore.id);
    expect(forwarded).not.toContain(chore.name);
    expect(forwarded).not.toContain(child.profile.id);
    expect(forwarded).not.toContain(child.profile.name);
  });

  test('refreshes an expected active-chore state race without offering a problem report', async () => {
    // Break caught: a deadline/state race is treated as an unexpected failure and exposes a report action.
    const openDraft = vi.fn();
    const refresh = vi.fn();
    const child = dashboardSnapshot.children[0]!;
    const chore = {
      ...dashboardSnapshot.chores[1]!,
      status: 'CLAIMED' as const,
      claimedChildId: child.profile.id,
      claimDeadlineAt: '2026-08-10T12:20:00.000Z',
    };
    const submit = vi.fn().mockRejectedValue(
      new FamilyApiError('CONFLICT', 'The chore cannot be submitted.', {
        code: 'INVALID_STATE',
      }),
    );
    render(
      <ActiveChoreScreen
        chore={chore}
        child={child}
        serverOffsetMs={0}
        now={() => Date.parse('2026-08-10T12:10:00.000Z')}
        submit={submit}
        onSubmitted={() => undefined}
        onBack={() => undefined}
        onRefresh={refresh}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: "I'm done" }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, I finished' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This chore changed on the family server. Try again after it refreshes.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Report this problem' }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(openDraft).not.toHaveBeenCalled();
  });

  test('queues contextual setup feedback without credentials and flushes only after a valid session import', async () => {
    // Break caught: setup storage errors are unreportable, auto-submit credentials, or flush before authentication.
    const storage = memoryStore();
    let currentSession: ClientSession | undefined;
    let rejectSave = true;
    const sessionStore: DashboardSessionStore = {
      load: vi.fn(async () => currentSession),
      save: vi.fn(async (session) => {
        if (rejectSave) throw new Error(rawFailure);
        currentSession = session;
      }),
      clear: vi.fn(),
    };
    const requests: Request[] = [];
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (new URL(request.url).pathname === '/v1/feedback') {
        return Response.json(feedbackReceipt);
      }
      return Response.json(dashboardSnapshot);
    };
    render(
      <App
        sessionStore={sessionStore}
        queryStorage={storage}
        fetch={fetchImpl}
      />,
    );

    const credential = credentialJson('DASHBOARD');
    fireEvent.change(
      await screen.findByLabelText('Dashboard credential JSON'),
      {
        target: { value: credential },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect dashboard' }));
    expect(
      await screen.findByText('The dashboard credential could not be saved.'),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(
      screen.getByRole('button', { name: 'Something broke' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(feedbackRequests(requests)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    const outbox = createFeedbackOutbox({
      storage,
      key: DASHBOARD_FEEDBACK_OUTBOX_KEY,
    });
    await waitFor(async () => expect(await outbox.list()).toHaveLength(1));
    expect((await outbox.list())[0]?.scope).toBeNull();
    expect(feedbackRequests(requests)).toHaveLength(0);

    rejectSave = false;
    fireEvent.click(screen.getByRole('button', { name: 'Connect dashboard' }));

    await waitFor(() => expect(feedbackRequests(requests)).toHaveLength(1));
    const command = (await feedbackRequests(requests)[0]!.json()) as {
      category: string;
      description: string;
      diagnosticSnapshot: unknown;
    };
    expect(command.category).toBe('BROKEN');
    expect(command.description).toBe('');
    expect(JSON.stringify(command.diagnosticSnapshot)).not.toContain(
      credential,
    );
    expect(JSON.stringify(command.diagnosticSnapshot)).not.toContain(
      rawFailure,
    );
    await waitFor(async () => expect(await outbox.list()).toEqual([]));
  });

  test('does not offer reporting for ordinary setup validation', async () => {
    // Break caught: expected malformed-credential guidance is mislabeled as an unexpected product failure.
    render(
      <SetupScreen
        sessionStore={fixedSessionStore(undefined)}
        browserOrigin="http://127.0.0.1:5173"
        onComplete={() => undefined}
        onReportProblem={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Dashboard credential JSON'), {
      target: { value: '{bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect dashboard' }));
    expect(
      await screen.findByText(
        'Paste the dashboard credential JSON from your family server.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Report this problem' }),
    ).not.toBeInTheDocument();
  });
});

const feedbackReceipt = {
  id: '70000000-0000-4000-8000-000000000001',
  status: 'NEW' as const,
  createdAt: '2026-08-10T12:00:00.000Z',
};

function memoryStore(): AsyncKeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

function fixedSessionStore(
  session: ClientSession | undefined,
): DashboardSessionStore {
  return {
    load: vi.fn().mockResolvedValue(session),
    save: vi.fn(),
    clear: vi.fn(),
  };
}

function feedbackRequests(requests: Request[]): Request[] {
  return requests.filter(
    (request) => new URL(request.url).pathname === '/v1/feedback',
  );
}

function snapshotRequests(requests: Request[]): Request[] {
  return requests.filter(
    (request) => new URL(request.url).pathname === '/v1/dashboard/snapshot',
  );
}
