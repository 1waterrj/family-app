import {
  familyQueryKeys,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import { FeedbackListItemSchema } from '@family/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Pressable, Text } from 'react-native';

import { FeedbackInboxScreen } from '../src/screens/feedback-inbox-screen';

const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

const olderReport = FeedbackListItemSchema.parse({
  id: '30000000-0000-4000-8000-000000000001',
  category: 'BROKEN',
  source: 'PARENT_IOS',
  appVersion: '1.2.3',
  screen: 'PARENT_HOME',
  status: 'NEW',
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
  descriptionPreview: 'The chore button stopped working.',
  hasDiagnostics: true,
});

const newerReport = FeedbackListItemSchema.parse({
  id: '30000000-0000-4000-8000-000000000002',
  category: 'IDEA',
  source: 'PARENT_ANDROID',
  appVersion: '2.0.0',
  screen: 'PARENT_FEEDBACK',
  status: 'REVIEWING',
  createdAt: '2026-08-10T13:00:00.000Z',
  updatedAt: '2026-08-10T13:05:00.000Z',
  descriptionPreview: 'Add a weekly family summary.',
  hasDiagnostics: false,
});

const trackedQueryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of trackedQueryClients.splice(0)) queryClient.clear();
});

describe('parent feedback inbox', () => {
  test('shows newest-first rows with review context and opens the selected report', async () => {
    // Break caught: the shared parent Inbox hides review metadata or orders old reports first.
    const onOpen = jest.fn();
    const client: Pick<FamilyApiClient, 'listFeedback'> = {
      listFeedback: jest.fn().mockResolvedValue([olderReport, newerReport]),
    };
    renderInbox({ client, onOpen });

    const openButtons = await screen.findAllByRole('button', {
      name: /^Open feedback:/,
    });
    expect(
      openButtons.map((button) => button.props.accessibilityLabel),
    ).toEqual([
      'Open feedback: I have an idea',
      'Open feedback: Something broke',
    ]);
    expect(screen.getByText('Something broke')).toBeVisible();
    expect(screen.getByText('Parent app · iOS')).toBeVisible();
    expect(screen.getAllByText(/^Submitted /)).toHaveLength(2);
    expect(screen.getByText('New')).toBeVisible();
    expect(screen.getByText('The chore button stopped working.')).toBeVisible();
    expect(screen.getByLabelText('Diagnostics attached')).toBeVisible();
    expect(screen.getByLabelText('No diagnostics attached')).toBeVisible();

    fireEvent.press(openButtons[0]!);
    expect(onOpen).toHaveBeenCalledWith(newerReport.id);
  });

  test('keeps the cached list visible and labels it stale when refresh fails', async () => {
    // Break caught: a transient offline refresh replaces the parent's last private Inbox with an error.
    const queryClient = createQueryClient();
    queryClient.setQueryData(
      familyQueryKeys.feedbackList(parentSession),
      [olderReport],
      { updatedAt: 1 },
    );
    const client: Pick<FamilyApiClient, 'listFeedback'> = {
      listFeedback: jest.fn().mockRejectedValue(new Error('offline')),
    };
    renderInbox({ client, queryClient });

    expect(
      await screen.findByText('Saved feedback - reconnect to refresh'),
    ).toBeVisible();
    expect(screen.getByText('Something broke')).toBeVisible();
    expect(screen.getByText('The chore button stopped working.')).toBeVisible();
  });

  test('offers an accessible retry after an initial load failure', async () => {
    // Break caught: an empty cache plus a failed request strands the parent without a recovery action.
    const listFeedback = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([newerReport]);
    renderInbox({ client: { listFeedback } });

    expect(
      await screen.findByRole('alert', {
        name: 'Feedback inbox could not be loaded.',
      }),
    ).toBeVisible();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('I have an idea')).toBeVisible();
  });

  test('keeps the Send feedback entry point available while the Inbox loads', () => {
    // Break caught: a slow or offline Inbox blocks ordinary private feedback submission.
    const client: Pick<FamilyApiClient, 'listFeedback'> = {
      listFeedback: jest.fn(
        () =>
          new Promise<Awaited<ReturnType<FamilyApiClient['listFeedback']>>>(
            () => undefined,
          ),
      ),
    };
    const queryClient = createQueryClient();
    render(
      <FeedbackInboxScreen
        session={parentSession}
        fetch={unusedFetch}
        client={client}
        onOpen={() => undefined}
        header={
          <Pressable accessibilityRole="button">
            <Text>Send feedback</Text>
          </Pressable>
        }
      />,
      { wrapper: queryWrapper(queryClient) },
    );

    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeVisible();
    expect(screen.getByText('Loading feedback…')).toBeVisible();
  });
});

function renderInbox({
  client,
  onOpen = () => undefined,
  queryClient = createQueryClient(),
}: {
  client: Pick<FamilyApiClient, 'listFeedback'>;
  onOpen?: (feedbackId: string) => void;
  queryClient?: QueryClient;
}) {
  return render(
    <FeedbackInboxScreen
      session={parentSession}
      fetch={unusedFetch}
      client={client}
      onOpen={onOpen}
    />,
    { wrapper: queryWrapper(queryClient) },
  );
}

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  trackedQueryClients.push(queryClient);
  return queryClient;
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
