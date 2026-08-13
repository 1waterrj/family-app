import {
  createFeedbackOutbox,
  type ClientSession,
  type FamilyApiClient,
} from '@family/api-client';
import type { CreateFeedbackCommand } from '@family/contracts';
import { FeedbackSubmissionReceiptSchema } from '@family/contracts';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { FeedbackQueueStatus } from '../src/components/feedback-queue-status';
import {
  PARENT_FEEDBACK_OUTBOX_KEY,
  ParentFeedbackProvider,
  type ParentFeedbackRuntime,
  useFeedbackRuntime,
} from '../src/features/feedback/feedback-runtime';
import { parentFeedbackScope } from '../src/features/feedback/feedback-queries';
import {
  createMemoryAsyncStorage,
  type AsyncStorageLike,
} from './test-adapters';

const parentSession: ClientSession = {
  apiOrigin: 'http://127.0.0.1:3000',
  accessToken: 'parent-secret',
  actorId: '10000000-0000-4000-8000-000000000001',
  householdId: '20000000-0000-4000-8000-000000000001',
  role: 'PARENT',
};

test('renders an accessible actionable status when app-start and retry storage reads fail', async () => {
  // Break caught: background outbox errors are invisible and manual retry rejects without an action.
  const underlying = createMemoryAsyncStorage();
  const storage: AsyncStorageLike = {
    ...underlying,
    getItem: async (key) => {
      if (key === PARENT_FEEDBACK_OUTBOX_KEY) {
        throw new Error('storage unavailable');
      }
      return underlying.getItem(key);
    },
  };
  const createFeedback: jest.MockedFunction<FamilyApiClient['createFeedback']> =
    jest.fn();
  render(
    <ParentFeedbackProvider
      session={parentSession}
      fetch={unusedFetch}
      client={{ createFeedback }}
      isOnline
      dependencies={{
        now: () => new Date('2026-08-10T12:00:00.000Z'),
        randomUUID: () => '50000000-0000-4000-8000-000000000001',
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        storage,
      }}
    >
      <FeedbackQueueStatus />
    </ParentFeedbackProvider>,
  );

  expect(
    await screen.findByRole('alert', {
      name: 'Saved feedback could not be checked. Try again.',
    }),
  ).toBeVisible();
  const retry = screen.getByRole('button', { name: 'Try sending now' });
  fireEvent.press(retry);

  expect(
    await screen.findByRole('alert', {
      name: 'Saved feedback could not be checked. Try again.',
    }),
  ).toBeVisible();
  expect(createFeedback).not.toHaveBeenCalled();
});

test('lists only current-scope drafts with safe summaries and opens the full local draft', async () => {
  // Break caught: parents see only a count, or another household's saved text appears in the queue manager.
  const storage = createMemoryAsyncStorage();
  const outbox = createFeedbackOutbox({
    storage,
    key: PARENT_FEEDBACK_OUTBOX_KEY,
    now: () => Date.parse('2026-08-10T12:00:00.000Z'),
  });
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000001',
      'BROKEN',
      'The calendar freezes after I tap the very long family schedule link.',
      true,
    ),
    parentFeedbackScope(parentSession),
  );
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000002',
      'IDEA',
      'OTHER HOUSEHOLD PRIVATE DRAFT',
      false,
    ),
    parentFeedbackScope({
      ...parentSession,
      actorId: '10000000-0000-4000-8000-000000000009',
      householdId: '20000000-0000-4000-8000-000000000009',
    }),
  );

  renderQueue({ session: parentSession, storage, isOnline: false });

  const review = await screen.findByRole('button', {
    name: 'Review saved feedback: Something broke',
  });
  expect(screen.getByText('Diagnostics attached')).toBeVisible();
  expect(screen.getByText(/The calendar freezes after I tap/)).toBeVisible();
  expect(screen.queryByText('OTHER HOUSEHOLD PRIVATE DRAFT')).toBeNull();

  fireEvent.press(review);
  expect(screen.getByLabelText('Saved feedback details')).toBeVisible();
  expect(
    screen.getAllByText(
      'The calendar freezes after I tap the very long family schedule link.',
    ),
  ).toHaveLength(2);
  expect(screen.getByText('1 diagnostic event')).toBeVisible();
});

test('deletes one persisted draft only after accessible confirmation', async () => {
  // Break caught: a destructive tap silently removes every draft or only changes the visible count.
  const storage = createMemoryAsyncStorage();
  const outbox = createFeedbackOutbox({
    storage,
    key: PARENT_FEEDBACK_OUTBOX_KEY,
  });
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000001',
      'CONFUSING',
      'Keep until confirmed.',
      false,
    ),
    parentFeedbackScope(parentSession),
  );
  renderQueue({ session: parentSession, storage, isOnline: false });

  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Review saved feedback: This is confusing',
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Delete this draft' }));
  expect(screen.getByText('Delete saved feedback?')).toBeVisible();
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm delete saved feedback' }),
  );

  await waitFor(async () => expect(await outbox.list()).toEqual([]));
  expect(await screen.findByText('Saved feedback deleted.')).toBeVisible();
  expect(screen.queryByLabelText('Saved feedback details')).toBeNull();
});

test('keeps the draft open with an accessible error when deletion storage fails', async () => {
  // Break caught: a local storage failure closes the only draft view or becomes an unhandled rejection.
  const underlying = createMemoryAsyncStorage();
  const outbox = createFeedbackOutbox({
    storage: underlying,
    key: PARENT_FEEDBACK_OUTBOX_KEY,
  });
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000001',
      'BROKEN',
      'Still saved locally.',
      false,
    ),
    parentFeedbackScope(parentSession),
  );
  const storage: AsyncStorageLike = {
    ...underlying,
    removeItem: async () => {
      throw new Error('storage unavailable');
    },
  };
  renderQueue({ session: parentSession, storage, isOnline: false });

  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Review saved feedback: Something broke',
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Delete this draft' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm delete saved feedback' }),
  );

  expect(
    await screen.findByRole('alert', {
      name: 'Saved feedback could not be deleted. Try again.',
    }),
  ).toBeVisible();
  expect(screen.getByLabelText('Saved feedback details')).toBeVisible();
  expect(await outbox.list()).toHaveLength(1);
});

test('never calls a delivery-attempted local copy an unsent deleted draft', async () => {
  // Break caught: after an ambiguous post-send failure, delete falsely says an unsent draft was deleted.
  const storage = createMemoryAsyncStorage();
  const outbox = createFeedbackOutbox({
    storage,
    key: PARENT_FEEDBACK_OUTBOX_KEY,
  });
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000001',
      'BROKEN',
      'The server may already have this.',
      false,
    ),
    parentFeedbackScope(parentSession),
  );
  await outbox.flush({
    scope: parentFeedbackScope(parentSession),
    deliver: async () => {
      throw new TypeError('connection closed after send');
    },
  });
  renderQueue({ session: parentSession, storage, isOnline: false });

  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Review saved feedback: Something broke',
    }),
  );
  expect(screen.getAllByText('Delivery was attempted.')).toHaveLength(2);
  fireEvent.press(screen.getByRole('button', { name: 'Delete this draft' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm delete saved feedback' }),
  );

  expect(
    await screen.findByRole('alert', {
      name: 'Local copy removed. It may already have been delivered.',
    }),
  ).toBeVisible();
  expect(screen.queryByText('Saved feedback deleted.')).toBeNull();
  expect(await outbox.list()).toEqual([]);
});

test('shows only device-local setup drafts while unauthenticated', async () => {
  // Break caught: setup management leaks a previously bound household draft on a signed-out device.
  const storage = createMemoryAsyncStorage();
  const outbox = createFeedbackOutbox({
    storage,
    key: PARENT_FEEDBACK_OUTBOX_KEY,
  });
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000001',
      'BROKEN',
      'LOCAL SETUP DRAFT',
      false,
    ),
  );
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000002',
      'IDEA',
      'PRIOR BOUND DRAFT',
      false,
    ),
    parentFeedbackScope(parentSession),
  );

  renderQueue({ session: undefined, storage, isOnline: false });

  expect(await screen.findByText('LOCAL SETUP DRAFT')).toBeVisible();
  expect(screen.queryByText('PRIOR BOUND DRAFT')).toBeNull();
});

test('reports uncertainty when deletion durably wins an active delivery race', async () => {
  // Break caught: a late ACK changes an already completed deletion result or resurrects its private local command.
  const storage = createMemoryAsyncStorage();
  let resolveDelivery!: (
    value: ReturnType<typeof FeedbackSubmissionReceiptSchema.parse>,
  ) => void;
  const createFeedback: jest.MockedFunction<FamilyApiClient['createFeedback']> =
    jest.fn((input: CreateFeedbackCommand) => {
      void input;
      return new Promise<
        ReturnType<typeof FeedbackSubmissionReceiptSchema.parse>
      >((resolve) => {
        resolveDelivery = resolve;
      });
    });
  const outbox = createFeedbackOutbox({
    storage,
    key: PARENT_FEEDBACK_OUTBOX_KEY,
  });
  await outbox.enqueue(
    feedbackCommand(
      '50000000-0000-4000-8000-000000000001',
      'BROKEN',
      'Race draft',
      false,
    ),
    parentFeedbackScope(parentSession),
  );
  let runtime!: ParentFeedbackRuntime;
  const view = renderQueue({
    session: parentSession,
    storage,
    isOnline: false,
    createFeedback,
    onRuntime: (value) => {
      runtime = value;
    },
  });
  await waitFor(() => expect(runtime.queuedEntries).toHaveLength(1));
  const entryId = runtime.queuedEntries[0]?.id;
  expect(entryId).toBeDefined();
  view.rerender(
    <ParentFeedbackProvider
      session={parentSession}
      fetch={unusedFetch}
      client={{ createFeedback }}
      isOnline
      dependencies={{
        now: () => new Date('2026-08-10T12:00:00.000Z'),
        randomUUID: () => '60000000-0000-4000-8000-000000000001',
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        storage,
      }}
    >
      <FeedbackQueueStatus />
      <RuntimeProbe
        onRuntime={(value) => {
          runtime = value;
        }}
      />
    </ParentFeedbackProvider>,
  );
  await waitFor(() => expect(createFeedback).toHaveBeenCalledTimes(1));
  const deletion = runtime.removeQueued(entryId!);

  await act(async () => {
    resolveDelivery(
      FeedbackSubmissionReceiptSchema.parse({
        id: '30000000-0000-4000-8000-000000000001',
        status: 'NEW',
        createdAt: '2026-08-10T12:00:00.000Z',
      }),
    );
  });

  await expect(deletion).resolves.toBe('delivery-unknown');
  expect(
    await createFeedbackOutbox({
      storage,
      key: PARENT_FEEDBACK_OUTBOX_KEY,
    }).list(),
  ).toEqual([]);
});

function renderQueue({
  session,
  storage,
  isOnline,
  createFeedback = jest.fn(),
  onRuntime,
}: {
  session: ClientSession | undefined;
  storage: AsyncStorageLike;
  isOnline: boolean;
  createFeedback?: jest.MockedFunction<FamilyApiClient['createFeedback']>;
  onRuntime?: (runtime: ParentFeedbackRuntime) => void;
}) {
  return render(
    <ParentFeedbackProvider
      session={session}
      fetch={unusedFetch}
      client={{ createFeedback }}
      isOnline={isOnline}
      dependencies={{
        now: () => new Date('2026-08-10T12:00:00.000Z'),
        randomUUID: () => '60000000-0000-4000-8000-000000000001',
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        storage,
      }}
    >
      <FeedbackQueueStatus />
      {onRuntime ? <RuntimeProbe onRuntime={onRuntime} /> : null}
    </ParentFeedbackProvider>,
  );
}

function RuntimeProbe({
  onRuntime,
}: {
  onRuntime(runtime: ParentFeedbackRuntime): void;
}) {
  onRuntime(useFeedbackRuntime());
  return null;
}

function feedbackCommand(
  idempotencyKey: string,
  category: CreateFeedbackCommand['category'],
  description: string,
  withDiagnostics: boolean,
): CreateFeedbackCommand {
  return {
    idempotencyKey,
    category,
    description,
    diagnosticSnapshot: {
      source: 'PARENT_IOS',
      appVersion: '1.2.3',
      currentScreen: 'PARENT_HOME',
      events: withDiagnostics
        ? [
            {
              kind: 'SCREEN',
              at: '2026-08-10T12:00:00.000Z',
              screen: 'PARENT_HOME',
            },
          ]
        : [],
    },
  };
}

const unusedFetch: typeof globalThis.fetch = async () =>
  new Response(null, { status: 204 });
