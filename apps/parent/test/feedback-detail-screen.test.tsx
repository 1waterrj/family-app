import {
  FamilyApiError,
  familyQueryKeys,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import {
  FeedbackReportSchema,
  type FeedbackReport,
  type UpdateFeedbackCommand,
} from '@family/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { HighlightedPrivateText } from '../src/features/feedback/highlighted-private-text';
import { FeedbackDetailScreen } from '../src/screens/feedback-detail-screen';

const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

const feedbackReport = FeedbackReportSchema.parse({
  id: '30000000-0000-4000-8000-000000000001',
  category: 'BROKEN',
  source: 'PARENT_IOS',
  appVersion: '1.2.3',
  screen: 'PARENT_HOME',
  status: 'NEW',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
  title: 'Something broke for Avery',
  description: 'Avery could not connect.',
  diagnosticSnapshot: {
    source: 'PARENT_IOS',
    appVersion: '1.2.3',
    currentScreen: 'PARENT_HOME',
    events: [
      {
        kind: 'SCREEN',
        at: '2026-08-10T11:59:00.000Z',
        screen: 'PARENT_HOME',
      },
      {
        kind: 'NETWORK',
        at: '2026-08-10T11:59:30.000Z',
        state: 'OFFLINE',
      },
    ],
  },
  privacyFindings: [
    { field: 'TITLE', kind: 'KNOWN_PRIVATE_TERM', start: 20, end: 25 },
    {
      field: 'DESCRIPTION',
      kind: 'KNOWN_PRIVATE_TERM',
      start: 0,
      end: 5,
    },
  ],
  publicIssueUrl: null,
  reviewedAt: null,
  exportedAt: null,
  closedAt: null,
});

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('parent feedback review', () => {
  test('edits and scrubs the report while preserving immutable source metadata', async () => {
    // Break caught: a parent cannot jointly scrub text, diagnostics, workflow state, and a known issue URL.
    const idempotencyKeys = [
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
    ];
    const updateFeedback = jest.fn(
      async (_feedbackId: string, input: UpdateFeedbackCommand) =>
        changedReport(input),
    );
    const { queryClient } = renderDetail({
      client: detailClient({ updateFeedback }),
      randomUUID: () => idempotencyKeys.shift()!,
    });
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    expect(await screen.findByText('Something broke')).toBeVisible();
    expect(screen.getByText('Parent app · iOS')).toBeVisible();
    expect(screen.getByText('App version 1.2.3')).toBeVisible();
    expect(screen.getByText('Current screen: Parent home')).toBeVisible();
    expect(screen.getAllByLabelText('Possible family name')).toHaveLength(2);
    expect(screen.getAllByLabelText('Possible family name')[0]).toHaveStyle({
      backgroundColor: '#FFF0C2',
      fontWeight: '800',
    });

    fireEvent.changeText(
      screen.getByLabelText('Feedback title'),
      'Connection button failed',
    );
    fireEvent.changeText(
      screen.getByLabelText('Feedback description'),
      'The connection button stopped responding.',
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Remove diagnostic event 1' }),
    );
    fireEvent.press(screen.getByRole('radio', { name: 'Ready' }));
    fireEvent.changeText(
      screen.getByLabelText('Public issue URL (optional)'),
      'https://github.com/family/app/issues/42',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Changes saved.')).toBeVisible();
    expect(updateFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: feedbackReport.updatedAt,
      title: 'Connection button failed',
      description: 'The connection button stopped responding.',
      diagnosticEvents: [feedbackReport.diagnosticSnapshot.events[1]],
      status: 'READY',
      publicIssueUrl: 'https://github.com/family/app/issues/42',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: familyQueryKeys.feedbackList(parentSession),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: familyQueryKeys.feedbackDetail(
        parentSession,
        feedbackReport.id,
      ),
    });

    fireEvent.press(
      screen.getByRole('button', { name: 'Remove all diagnostics' }),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(2));
    expect(updateFeedback.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        idempotencyKey: '50000000-0000-4000-8000-000000000002',
        expectedUpdatedAt: '2026-08-10T13:00:00.000Z',
        diagnosticEvents: [],
      }),
    );
  });

  test('merges overlapping privacy findings into one ordered accessible warning span', () => {
    // Break caught: overlapping findings duplicate, reorder, or hide private text from assistive technology.
    render(
      <HighlightedPrivateText
        text="Avery@example"
        findings={[
          {
            field: 'DESCRIPTION',
            kind: 'KNOWN_PRIVATE_TERM',
            start: 0,
            end: 5,
          },
          {
            field: 'DESCRIPTION',
            kind: 'EMAIL',
            start: 3,
            end: 13,
          },
        ]}
      />,
    );

    const warning = screen.getByLabelText(
      'Possible family name; Possible email address',
    );
    expect(warning).toHaveTextContent('Avery@example');
    expect(warning).toHaveStyle({ backgroundColor: '#FFF0C2' });
  });

  test('preserves the complete edited draft after a failed save', async () => {
    // Break caught: a local-server failure discards text or a parent's diagnostic scrub decisions.
    const updateFeedback = jest.fn().mockRejectedValue(new Error('offline'));
    renderDetail({ client: detailClient({ updateFeedback }) });
    await screen.findByDisplayValue(feedbackReport.title);

    fireEvent.changeText(
      screen.getByLabelText('Feedback description'),
      'Keep this private draft.',
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Remove diagnostic event 1' }),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByRole('alert', {
        name: 'Feedback changes could not be saved. Try again.',
      }),
    ).toBeVisible();
    expect(screen.getByDisplayValue('Keep this private draft.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Remove diagnostic event 1' }),
    ).toBeNull();
    expect(screen.getByText('1 diagnostic event attached')).toBeVisible();
  });

  test('never offers or transports EXPORTED from ordinary review and requires an explicit safe status change', async () => {
    // Break caught: editing an already-exported report can forge a new export event without a successful GitHub handoff.
    const exportedReport = FeedbackReportSchema.parse({
      ...feedbackReport,
      status: 'EXPORTED',
      reviewedAt: '2026-08-10T13:00:00.000Z',
      exportedAt: '2026-08-10T13:30:00.000Z',
      updatedAt: '2026-08-10T13:30:00.000Z',
    });
    const updateFeedback = jest.fn(
      async (_feedbackId: string, input: UpdateFeedbackCommand) =>
        FeedbackReportSchema.parse({
          ...exportedReport,
          title: input.title ?? exportedReport.title,
          description: input.description ?? exportedReport.description,
          status: input.status ?? exportedReport.status,
          exportedAt:
            input.status === 'READY' ? null : exportedReport.exportedAt,
          updatedAt: '2026-08-10T14:00:00.000Z',
        }),
    );
    renderDetail({
      client: detailClient({
        getFeedback: jest.fn().mockResolvedValue(exportedReport),
        updateFeedback,
      }),
      randomUUID: () => '50000000-0000-4000-8000-000000000001',
    });

    await screen.findByDisplayValue(exportedReport.title);
    expect(screen.queryByRole('radio', { name: 'Exported' })).toBeNull();
    expect(
      screen.getByText(
        'Current status: Exported by maintainer handoff. Choose a review status only if you intend to change it.',
      ),
    ).toBeVisible();

    fireEvent.changeText(
      screen.getByLabelText('Feedback description'),
      'Ordinary review after export.',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));
    expect(updateFeedback.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: exportedReport.updatedAt,
      title: exportedReport.title,
      description: 'Ordinary review after export.',
      diagnosticEvents: exportedReport.diagnosticSnapshot.events,
      publicIssueUrl: null,
    });
    expect(updateFeedback.mock.calls[0]?.[1]).not.toHaveProperty('status');

    fireEvent.press(screen.getByRole('radio', { name: 'Ready' }));
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(2));
    expect(updateFeedback.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ status: 'READY' }),
    );
  });

  test('preserves local edits and rebases their revision after a structured conflict', async () => {
    // Break caught: the UI retries a stale revision or gives a generic error with no safe refresh path.
    const newerReport = FeedbackReportSchema.parse({
      ...feedbackReport,
      title: 'Another parent scrubbed this title',
      description: 'Another parent scrubbed this description.',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockResolvedValueOnce(newerReport)
      .mockResolvedValue(newerReport);
    const updateFeedback = jest
      .fn()
      .mockRejectedValueOnce(
        new FamilyApiError('CONFLICT', 'Feedback changed on the server.', {
          code: 'CONFLICT',
        }),
      )
      .mockImplementationOnce(async (_id, input) =>
        FeedbackReportSchema.parse({
          ...newerReport,
          description: input.description,
          updatedAt: '2026-08-10T15:00:00.000Z',
        }),
      );
    const idempotencyKeys = [
      '50000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
    ];
    renderDetail({
      client: detailClient({ getFeedback, updateFeedback }),
      randomUUID: () => idempotencyKeys.shift()!,
    });
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Feedback description'),
      'Keep my local scrubbed description.',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByRole('alert', {
        name: 'This feedback changed on the server. Load the latest copy before saving again.',
      }),
    ).toBeVisible();
    expect(updateFeedback.mock.calls[0]?.[1]).toMatchObject({
      expectedUpdatedAt: feedbackReport.updatedAt,
      description: 'Keep my local scrubbed description.',
    });
    expect(
      screen.getByDisplayValue('Keep my local scrubbed description.'),
    ).toBeVisible();

    fireEvent.press(
      screen.getByRole('button', { name: 'Load latest and keep my edits' }),
    );
    expect(
      await screen.findByText(
        'Latest server copy loaded. Review your edits and save again.',
      ),
    ).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(2));
    expect(updateFeedback.mock.calls[1]?.[1]).toMatchObject({
      expectedUpdatedAt: newerReport.updatedAt,
      description: 'Keep my local scrubbed description.',
    });
  });

  test('does not recreate an absent private detail query when a late update succeeds', async () => {
    // Break caught: mutation success writes private report data into a removed query with the global multi-day cache lifetime.
    let resolveUpdate!: (report: FeedbackReport) => void;
    const lateCanonicalReport = FeedbackReportSchema.parse({
      ...feedbackReport,
      title: 'Late canonical private title',
      description: 'Late canonical private description.',
      updatedAt: '2026-08-10T14:00:00.000Z',
    });
    const freshReport = FeedbackReportSchema.parse({
      ...lateCanonicalReport,
      title: 'Freshly fetched title',
      description: 'Fetched only after reopening.',
      updatedAt: '2026-08-10T15:00:00.000Z',
    });
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockResolvedValueOnce(freshReport);
    const updateFeedback = jest.fn(
      () =>
        new Promise<FeedbackReport>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const client = detailClient({ getFeedback, updateFeedback });
    const first = renderDetail({ client });
    const detailKey = familyQueryKeys.feedbackDetail(
      parentSession,
      feedbackReport.id,
    );
    await screen.findByDisplayValue(feedbackReport.title);
    fireEvent.changeText(
      screen.getByLabelText('Feedback description'),
      'Save still running while I leave.',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateFeedback).toHaveBeenCalledTimes(1));

    first.unmount();
    first.queryClient.removeQueries({ queryKey: detailKey, exact: true });
    expect(first.queryClient.getQueryState(detailKey)).toBeUndefined();

    await act(async () => resolveUpdate(lateCanonicalReport));
    await waitFor(() => expect(first.queryClient.isMutating()).toBe(0));

    expect(first.queryClient.getQueryState(detailKey)).toBeUndefined();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(first.queryClient.getQueryData(detailKey)).toBeUndefined();

    const reopened = render(
      <FeedbackDetailScreen
        feedbackId={feedbackReport.id}
        session={parentSession}
        fetch={unusedFetch}
        client={client}
      />,
      { wrapper: queryWrapper(first.queryClient) },
    );
    expect(screen.queryByDisplayValue(lateCanonicalReport.title)).toBeNull();
    expect(await screen.findByDisplayValue(freshReport.title)).toBeVisible();
    expect(getFeedback).toHaveBeenCalledTimes(2);
    reopened.unmount();
  });

  test('deletes only after an explicit confirmation', async () => {
    // Break caught: an accidental first press permanently deletes private feedback.
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockRejectedValue(new Error('not found'));
    const deleteFeedback = jest.fn().mockResolvedValue({
      id: feedbackReport.id,
      deleted: true as const,
    });
    let unmountAfterDelete: () => void = () => undefined;
    const onDeleted = jest.fn(() => unmountAfterDelete());
    const view = renderDetail({
      client: detailClient({ deleteFeedback, getFeedback }),
      onDeleted,
    });
    const { queryClient } = view;
    unmountAfterDelete = view.unmount;
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await screen.findByDisplayValue(feedbackReport.title);

    fireEvent.press(screen.getByRole('button', { name: 'Delete feedback' }));
    expect(deleteFeedback).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText('Delete this feedback permanently?'),
    ).toBeVisible();

    fireEvent.press(
      screen.getByRole('button', { name: 'Delete feedback permanently' }),
    );
    await waitFor(() => expect(deleteFeedback).toHaveBeenCalledTimes(1));
    expect(deleteFeedback).toHaveBeenCalledWith(feedbackReport.id, {
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: familyQueryKeys.feedbackList(parentSession),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          familyQueryKeys.feedbackDetail(parentSession, feedbackReport.id),
        ),
      ).toBeUndefined(),
    );
  });

  test('cancels an in-flight detail generation and removes private cache before a confirming 404', async () => {
    // Break caught: a late GET response repopulates deleted private feedback and flashes it when the route is reopened.
    let resolveStaleGet!: (report: FeedbackReport) => void;
    const getFeedback = jest
      .fn()
      .mockResolvedValueOnce(feedbackReport)
      .mockImplementationOnce(
        () =>
          new Promise<FeedbackReport>((resolve) => {
            resolveStaleGet = resolve;
          }),
      )
      .mockRejectedValue(new Error('not found'));
    let unmountAfterDelete: () => void = () => undefined;
    const onDeleted = jest.fn(() => unmountAfterDelete());
    const client = detailClient({ getFeedback });
    const first = renderDetail({ client, onDeleted });
    unmountAfterDelete = first.unmount;
    const detailKey = familyQueryKeys.feedbackDetail(
      parentSession,
      feedbackReport.id,
    );
    await screen.findByDisplayValue(feedbackReport.title);

    const staleRefetch = first.queryClient.refetchQueries({
      queryKey: detailKey,
      exact: true,
    });
    await waitFor(() => expect(getFeedback).toHaveBeenCalledTimes(2));
    fireEvent.press(screen.getByRole('button', { name: 'Delete feedback' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Delete feedback permanently' }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));

    const cacheImmediatelyAfterDelete =
      first.queryClient.getQueryData(detailKey);
    await act(async () => resolveStaleGet(feedbackReport));
    await staleRefetch;
    expect(cacheImmediatelyAfterDelete).toBeUndefined();
    expect(first.queryClient.getQueryData(detailKey)).toBeUndefined();

    const reopened = render(
      <FeedbackDetailScreen
        feedbackId={feedbackReport.id}
        session={parentSession}
        fetch={unusedFetch}
        client={client}
      />,
      { wrapper: queryWrapper(first.queryClient) },
    );
    expect(screen.queryByDisplayValue(feedbackReport.title)).toBeNull();
    expect(
      await screen.findByRole('alert', {
        name: 'This feedback could not be loaded.',
      }),
    ).toBeVisible();
    expect(getFeedback.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(first.queryClient.getQueryData(detailKey)).toBeUndefined();
    reopened.unmount();
    await act(async () => {
      await first.queryClient.cancelQueries();
      first.queryClient.clear();
    });
  });

  test('reveals the public handoff only on a maintainer-enabled phone', async () => {
    // Break caught: an ordinary parent device exposes GitHub concepts or a maintainer cannot reach export.
    const onPreparePublicIssue = jest.fn();
    const first = renderDetail({
      client: detailClient(),
      onPreparePublicIssue,
      maintainerToolsEnabled: false,
    });
    await screen.findByDisplayValue(feedbackReport.title);
    expect(
      screen.queryByRole('button', { name: 'Prepare public issue' }),
    ).toBeNull();
    first.unmount();

    renderDetail({
      client: detailClient(),
      onPreparePublicIssue,
      maintainerToolsEnabled: true,
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Prepare public issue' }),
    );
    expect(onPreparePublicIssue).toHaveBeenCalledWith(feedbackReport.id);
  });
});

function renderDetail({
  client,
  randomUUID,
  onDeleted = () => undefined,
  onPreparePublicIssue = () => undefined,
  maintainerToolsEnabled = false,
}: {
  client: Pick<
    FamilyApiClient,
    'getFeedback' | 'updateFeedback' | 'deleteFeedback'
  >;
  randomUUID?: () => string;
  onDeleted?: () => void;
  onPreparePublicIssue?: (feedbackId: string) => void;
  maintainerToolsEnabled?: boolean;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  });
  trackedQueryClients.push(queryClient);
  const view = render(
    <FeedbackDetailScreen
      feedbackId={feedbackReport.id}
      session={parentSession}
      fetch={unusedFetch}
      client={client}
      randomUUID={randomUUID}
      onDeleted={onDeleted}
      onPreparePublicIssue={onPreparePublicIssue}
      maintainerToolsEnabled={maintainerToolsEnabled}
    />,
    { wrapper: queryWrapper(queryClient) },
  );
  return { ...view, queryClient };
}

function detailClient(
  overrides: Partial<
    Pick<FamilyApiClient, 'getFeedback' | 'updateFeedback' | 'deleteFeedback'>
  > = {},
): Pick<FamilyApiClient, 'getFeedback' | 'updateFeedback' | 'deleteFeedback'> {
  return {
    getFeedback: jest.fn().mockResolvedValue(feedbackReport),
    updateFeedback: jest
      .fn()
      .mockImplementation(async (_id, input) => changedReport(input)),
    deleteFeedback: jest.fn().mockResolvedValue({
      id: feedbackReport.id,
      deleted: true,
    }),
    ...overrides,
  };
}

function changedReport(input: UpdateFeedbackCommand): FeedbackReport {
  return FeedbackReportSchema.parse({
    ...feedbackReport,
    title: input.title ?? feedbackReport.title,
    description: input.description ?? feedbackReport.description,
    status: input.status ?? feedbackReport.status,
    publicIssueUrl:
      input.publicIssueUrl === undefined
        ? feedbackReport.publicIssueUrl
        : input.publicIssueUrl,
    diagnosticSnapshot: {
      ...feedbackReport.diagnosticSnapshot,
      events:
        input.diagnosticEvents ?? feedbackReport.diagnosticSnapshot.events,
    },
    privacyFindings: [],
    reviewedAt: '2026-08-10T13:00:00.000Z',
    updatedAt: '2026-08-10T13:00:00.000Z',
  });
}

function queryWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const unusedFetch: typeof globalThis.fetch = async () =>
  new Response(null, { status: 204 });
