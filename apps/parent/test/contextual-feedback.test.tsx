import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { ApprovalDetailScreen } from '../src/screens/approval-detail-screen';
import { ApprovalsScreen } from '../src/screens/approvals-screen';
import { ChoresScreen } from '../src/screens/chores-screen';
import { HomeScreen } from '../src/screens/home-screen';
import { RewardsScreen } from '../src/screens/rewards-screen';
import { SetupScreen } from '../src/screens/setup-screen';
import {
  approvalSnapshot,
  jsonResponse,
  oldAttemptId,
  parentSession,
  primaryChildId,
} from './approval-fixtures';
import {
  createMemoryAsyncStorage,
  createMemorySecureStore,
  encodeDevelopmentCredential,
} from './test-adapters';
import { createParentSessionStore } from '../src/auth/session-store';
import {
  canOpenReportProblemBeforeAuthentication,
  parseReportProblemContext,
} from '../src/features/feedback/contextual-feedback';

const rawFailure =
  'Avery failed Tidy toys at https://private.test/families/secret-family';

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('parent contextual feedback', () => {
  test('accepts only fixed parent report screens from route parameters', () => {
    // Break caught: an arbitrary or dashboard-only route value broadens the parent diagnostic allowlist.
    expect(
      parseReportProblemContext({
        category: 'BROKEN',
        screen: 'PARENT_HOME',
      }),
    ).toEqual({ category: 'BROKEN', screen: 'PARENT_HOME' });
    expect(
      parseReportProblemContext({
        category: 'BROKEN',
        screen: 'DASHBOARD_HOME',
      }),
    ).toBeUndefined();
    expect(
      parseReportProblemContext({
        category: 'BROKEN',
        screen: rawFailure,
      }),
    ).toBeUndefined();
  });

  test('allows only fixed setup reporting through the pre-auth route', () => {
    // Break caught: setup support accidentally exposes generic or authenticated-screen feedback before login.
    expect(
      canOpenReportProblemBeforeAuthentication({
        category: 'BROKEN',
        screen: 'SETUP',
      }),
    ).toBe(true);
    expect(canOpenReportProblemBeforeAuthentication(undefined)).toBe(false);
    expect(
      canOpenReportProblemBeforeAuthentication({
        category: 'BROKEN',
        screen: 'PARENT_HOME',
      }),
    ).toBe(false);
  });

  test.each([
    [
      'home',
      'Family data could not be loaded. Pull down to try again.',
      'PARENT_HOME',
      (openDraft: jest.Mock, fetchImpl: typeof globalThis.fetch) => (
        <HomeScreen
          session={parentSession}
          fetch={fetchImpl}
          isOnline
          onReportProblem={openDraft}
        />
      ),
    ],
    [
      'approvals',
      'Approval inbox could not be loaded.',
      'PARENT_APPROVALS',
      (openDraft: jest.Mock, fetchImpl: typeof globalThis.fetch) => (
        <ApprovalsScreen
          session={parentSession}
          fetch={fetchImpl}
          onReview={() => undefined}
          onReportProblem={openDraft}
        />
      ),
    ],
    [
      'approval detail',
      'This chore could not be loaded.',
      'PARENT_APPROVALS',
      (openDraft: jest.Mock, fetchImpl: typeof globalThis.fetch) => (
        <ApprovalDetailScreen
          submissionAttemptId={oldAttemptId}
          session={parentSession}
          fetch={fetchImpl}
          onReportProblem={openDraft}
        />
      ),
    ],
    [
      'chores',
      'The chore library could not be loaded.',
      'PARENT_CHORES',
      (openDraft: jest.Mock, fetchImpl: typeof globalThis.fetch) => (
        <ChoresScreen
          session={parentSession}
          fetch={fetchImpl}
          onReportProblem={openDraft}
        />
      ),
    ],
    [
      'rewards',
      'Rewards could not be loaded.',
      'PARENT_REWARDS',
      (openDraft: jest.Mock, fetchImpl: typeof globalThis.fetch) => (
        <RewardsScreen
          session={parentSession}
          fetch={fetchImpl}
          onReportProblem={openDraft}
        />
      ),
    ],
  ])(
    'opens a fixed BROKEN draft from the %s read failure',
    async (_name, failureMessage, expectedScreen, renderScreen) => {
      // Break caught: a recoverable read failure loses its contextual action or forwards private failure data.
      const openDraft = jest.fn();
      renderWithQuery(renderScreen(openDraft, failedFetch));

      expect(await screen.findByText(failureMessage)).toBeVisible();
      const retryButton = screen.getByRole('button', { name: 'Try again' });
      expect(retryButton).toBeVisible();
      fireEvent.press(
        screen.getByRole('button', { name: 'Report this problem' }),
      );

      expect(openDraft).toHaveBeenCalledWith({
        category: 'BROKEN',
        screen: expectedScreen,
      });
      expect(JSON.stringify(openDraft.mock.calls)).not.toContain(rawFailure);
      expect(JSON.stringify(openDraft.mock.calls)).not.toContain(
        parentSession.accessToken,
      );
    },
  );

  test('retries the parent snapshot from the primary read-failure action', async () => {
    // Break caught: Try again is decorative instead of re-running the failed read.
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(failedResponse())
      .mockResolvedValueOnce(jsonResponse(approvalSnapshot()));
    renderWithQuery(
      <HomeScreen
        session={parentSession}
        fetch={fetchImpl as typeof globalThis.fetch}
        isOnline
      />,
    );

    fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('TODAY AT HOME')).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('reports a ledger read failure without forwarding the selected child', async () => {
    // Break caught: ledger reporting copies the selected child or read error into the feedback draft.
    const openDraft = jest.fn();
    const fetchImpl: typeof globalThis.fetch = async (input) =>
      String(input).endsWith('/v1/parent/snapshot')
        ? jsonResponse(approvalSnapshot())
        : failedResponse();
    renderWithQuery(
      <RewardsScreen
        session={parentSession}
        fetch={fetchImpl}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.press(
      await screen.findByRole('button', { name: 'View Avery rewards' }),
    );
    expect(
      await screen.findByText('This ledger could not be loaded.'),
    ).toBeVisible();
    fireEvent.press(
      screen.getByRole('button', { name: 'Report this problem' }),
    );

    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'PARENT_REWARDS',
    });
    expect(JSON.stringify(openDraft.mock.calls)).not.toContain('Avery');
    expect(JSON.stringify(openDraft.mock.calls)).not.toContain(primaryChildId);
  });

  test('keeps approval retry primary while reporting an unexpected decision failure without form values', async () => {
    // Break caught: reporting replaces retry or copies approval notes and raw operation errors into the draft.
    const openDraft = jest.fn();
    const fetchImpl: typeof globalThis.fetch = async (input) =>
      String(input).endsWith('/v1/parent/snapshot')
        ? jsonResponse(approvalSnapshot())
        : Promise.reject(new TypeError(rawFailure));
    renderWithQuery(
      <ApprovalDetailScreen
        submissionAttemptId={oldAttemptId}
        session={parentSession}
        fetch={fetchImpl}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.changeText(
      await screen.findByLabelText('Approval note'),
      'private encouragement',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Approve chore' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve chore' })).toBeEnabled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'PARENT_APPROVALS',
    });
    expect(JSON.stringify(openDraft.mock.calls)).not.toContain(
      'private encouragement',
    );
    expect(JSON.stringify(openDraft.mock.calls)).not.toContain(rawFailure);
  });

  test('keeps template retry primary while reporting only fixed chore context', async () => {
    // Break caught: template reporting replaces retry or forwards the draft and raw operation error.
    const openDraft = jest.fn();
    const fetchImpl: typeof globalThis.fetch = async (input) =>
      String(input).endsWith('/v1/parent/snapshot')
        ? jsonResponse(approvalSnapshot())
        : Promise.reject(new TypeError(rawFailure));
    renderWithQuery(
      <ChoresScreen
        session={parentSession}
        fetch={fetchImpl}
        onReportProblem={openDraft}
      />,
    );

    await screen.findByText('Chore library');
    fireEvent.changeText(screen.getByLabelText('Chore name'), 'Private chore');
    fireEvent.changeText(
      screen.getByLabelText('Chore instructions'),
      'Private calendar instructions',
    );
    fireEvent.changeText(screen.getByLabelText('Default reward'), '2.50');
    fireEvent.changeText(screen.getByLabelText('Default duration'), '20');
    fireEvent.press(screen.getByRole('button', { name: 'Create template' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create template' }),
    ).toBeEnabled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'PARENT_CHORES',
    });
    const forwarded = JSON.stringify(openDraft.mock.calls);
    expect(forwarded).not.toContain(rawFailure);
    expect(forwarded).not.toContain('Private chore');
    expect(forwarded).not.toContain('Private calendar instructions');
  });

  test('keeps publish retry primary while reporting only fixed chore context', async () => {
    // Break caught: publish reporting replaces retry or forwards template data, overrides, request bodies, or raw errors.
    const openDraft = jest.fn();
    const template = {
      id: '50000000-0000-4000-8000-000000000003',
      householdId: parentSession.householdId,
      name: 'Private template',
      imageKey: 'dishes' as const,
      imageUrl: null,
      instructions: 'Private default instructions',
      defaultValueCents: 250,
      defaultDurationMinutes: 20,
      isActive: true,
      createdAt: '2026-08-10T12:00:00.000Z',
    };
    const fetchImpl: typeof globalThis.fetch = async (input) =>
      String(input).endsWith('/v1/parent/snapshot')
        ? jsonResponse({ ...approvalSnapshot(), templates: [template] })
        : Promise.reject(new TypeError(rawFailure));
    renderWithQuery(
      <ChoresScreen
        session={parentSession}
        fetch={fetchImpl}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Select Private template template',
      }),
    );
    fireEvent.changeText(
      screen.getByLabelText('Published instructions override'),
      'Private publish override',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add to shared pool' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Add to shared pool' }),
    ).toBeEnabled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'PARENT_CHORES',
    });
    const forwarded = JSON.stringify(openDraft.mock.calls);
    expect(forwarded).not.toContain(rawFailure);
    expect(forwarded).not.toContain(template.id);
    expect(forwarded).not.toContain(template.name);
    expect(forwarded).not.toContain('Private publish override');
  });

  test('keeps ledger retry primary while reporting only fixed rewards context', async () => {
    // Break caught: ledger write reporting replaces retry or forwards the note, selected child, body, or raw error.
    const openDraft = jest.fn();
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/parent/snapshot') {
        return jsonResponse(approvalSnapshot());
      }
      if (init?.method !== 'POST') {
        return jsonResponse({
          householdId: parentSession.householdId,
          childId: primaryChildId,
          balanceCents: 0,
          transactions: [],
        });
      }
      throw new TypeError(rawFailure);
    };
    renderWithQuery(
      <RewardsScreen
        session={parentSession}
        fetch={fetchImpl}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.press(
      await screen.findByRole('button', { name: 'View Avery rewards' }),
    );
    await screen.findByText('$0.00');
    fireEvent.changeText(screen.getByLabelText('Ledger amount'), '2.50');
    fireEvent.changeText(
      screen.getByLabelText('Ledger note'),
      'Private purchase note',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save ledger entry' }));

    expect(await screen.findByText('Unable to reach the API.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Save ledger entry' }),
    ).toBeEnabled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Report this problem' }),
    );
    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'PARENT_REWARDS',
    });
    const forwarded = JSON.stringify(openDraft.mock.calls);
    expect(forwarded).not.toContain(rawFailure);
    expect(forwarded).not.toContain('Private purchase note');
    expect(forwarded).not.toContain('Avery');
    expect(forwarded).not.toContain(primaryChildId);
  });

  test('offers reporting only after secure setup storage fails', async () => {
    // Break caught: normal credential validation is reported, or credentials leak into a setup draft.
    const sessionStore = createParentSessionStore({
      secureStore: {
        ...createMemorySecureStore(),
        setItemAsync: async () => {
          throw new Error(rawFailure);
        },
      },
      asyncStorage: createMemoryAsyncStorage(),
    });
    const openDraft = jest.fn();
    render(
      <SetupScreen
        sessionStore={sessionStore}
        onComplete={() => undefined}
        onReportProblem={openDraft}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('Credential JSON'), '{bad');
    fireEvent.press(
      screen.getByRole('button', { name: 'Import parent credentials' }),
    );
    expect(
      await screen.findByText(
        'Paste the complete development credential JSON.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Report this problem' }),
    ).toBeNull();

    const credential = encodeDevelopmentCredential('PARENT');
    fireEvent.changeText(screen.getByLabelText('Credential JSON'), credential);
    fireEvent.press(
      screen.getByRole('button', { name: 'Import parent credentials' }),
    );
    expect(
      await screen.findByText('The credential could not be saved securely.'),
    ).toBeVisible();
    fireEvent.press(
      screen.getByRole('button', { name: 'Report this problem' }),
    );

    expect(openDraft).toHaveBeenCalledWith({
      category: 'BROKEN',
      screen: 'SETUP',
    });
    expect(JSON.stringify(openDraft.mock.calls)).not.toContain(credential);
    expect(JSON.stringify(openDraft.mock.calls)).not.toContain(rawFailure);
    await waitFor(() => expect(openDraft).toHaveBeenCalledTimes(1));
  });
});

function renderWithQuery(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  trackedQueryClients.push(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

const failedFetch: typeof globalThis.fetch = async () => failedResponse();

function failedResponse(): Response {
  return jsonResponse(
    {
      code: 'INTERNAL_ERROR',
      message: rawFailure,
      requestId: '90000000-0000-4000-8000-000000000001',
    },
    503,
  );
}
