import type { ClientSession, FamilyApiClient } from '@family/api-client';
import { FeedbackSubmissionReceiptSchema } from '@family/contracts';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { ParentFeedbackProvider } from '../src/features/feedback/feedback-runtime';
import { SendFeedbackScreen } from '../src/screens/send-feedback-screen';
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
const receipt = FeedbackSubmissionReceiptSchema.parse({
  id: '30000000-0000-4000-8000-000000000001',
  status: 'NEW',
  createdAt: '2026-08-10T12:00:00.000Z',
});

describe('send parent feedback', () => {
  test('requires one of the three exact accessible choices and limits the optional description to 2,000 characters', () => {
    // Break caught: category selection is ambiguous/inaccessible or description exceeds the contract.
    renderFeedback({ createFeedback: jest.fn().mockResolvedValue(receipt) });

    const broken = screen.getByRole('radio', { name: 'Something broke' });
    const confusing = screen.getByRole('radio', {
      name: 'This is confusing',
    });
    const idea = screen.getByRole('radio', { name: 'I have an idea' });
    expect(broken.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(confusing.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(idea.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(
      screen.getByRole('button', { name: 'Send feedback' }),
    ).toBeDisabled();

    fireEvent.press(idea);

    expect(idea.props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    expect(broken.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
    expect(
      screen.getByLabelText('Tell us more (optional)').props.maxLength,
    ).toBe(2_000);
    expect(screen.queryByText(/github|public issue|export/i)).toBeNull();
  });

  test('discloses the exact allowlisted snapshot, privacy exclusions, retention limits, and diagnostics opt-out', async () => {
    // Break caught: a parent cannot know or control exactly which diagnostics leave the phone.
    const createFeedback = jest.fn().mockResolvedValue(receipt);
    renderFeedback({ createFeedback });

    const disclosure = screen.getByRole('button', {
      name: 'Review attached diagnostics',
    });
    expect(disclosure.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(disclosure);
    expect(
      screen.getByRole('button', { name: 'Hide attached diagnostics' }).props
        .accessibilityState,
    ).toEqual({ expanded: true });

    expect(screen.getByText('Platform: Parent iOS')).toBeVisible();
    expect(screen.getByText('App version: 1.2.3')).toBeVisible();
    expect(screen.getByText('Current screen: Parent feedback')).toBeVisible();
    expect(screen.getByText(/15 minutes.*100 events.*24 KiB/i)).toBeVisible();
    expect(
      screen.getByText(
        /never include names, calendar titles, balances, chore notes, credentials, URLs, query strings, or request and response bodies/i,
      ),
    ).toBeVisible();
    const includeDiagnostics = screen.getByRole('switch', {
      name: 'Include recent diagnostics',
    });
    expect(includeDiagnostics.props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });

    fireEvent(includeDiagnostics, 'valueChange', false);
    expect(includeDiagnostics.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(
      screen.getByText('Recent event timeline: Not attached'),
    ).toBeVisible();

    fireEvent.press(screen.getByRole('radio', { name: 'I have an idea' }));
    fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(createFeedback).toHaveBeenCalledTimes(1));
    expect(createFeedback.mock.calls[0]?.[0].diagnosticSnapshot.events).toEqual(
      [],
    );
  });

  test('shows an acknowledged confirmation and sends optional text only after enqueueing', async () => {
    // Break caught: the UI claims delivery without server acknowledgement or loses the typed report.
    const createFeedback = jest.fn().mockResolvedValue(receipt);
    renderFeedback({ createFeedback });

    fireEvent.press(screen.getByRole('radio', { name: 'I have an idea' }));
    fireEvent.changeText(
      screen.getByLabelText('Tell us more (optional)'),
      'Make the buttons bigger.',
    );
    fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));

    expect(
      await screen.findByText('Thanks - your feedback was saved.'),
    ).toBeVisible();
    expect(createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'IDEA',
        description: 'Make the buttons bigger.',
        idempotencyKey: '50000000-0000-4000-8000-000000000001',
      }),
    );
  });

  test('honestly confirms an offline queue and cancels without submitting', async () => {
    // Break caught: offline feedback is falsely called delivered or Cancel triggers a mutation.
    const createFeedback = jest.fn().mockRejectedValue(new Error('offline'));
    const onCancel = jest.fn();
    renderFeedback({ createFeedback, onCancel });

    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createFeedback).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('radio', { name: 'Something broke' }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    });

    expect(
      await screen.findByText(
        'Saved on this phone - it will send when your family server reconnects.',
      ),
    ).toBeVisible();
  });

  test('keeps an accessible Send feedback name, busy state, and live status while submitting', async () => {
    // Break caught: replacing button text with a spinner removes the control name and progress semantics.
    let resolveFeedback!: (value: typeof receipt) => void;
    const createFeedback: jest.MockedFunction<
      FamilyApiClient['createFeedback']
    > = jest.fn((input) => {
      void input;
      return new Promise<typeof receipt>((resolve) => {
        resolveFeedback = resolve;
      });
    });
    renderFeedback({ createFeedback });
    fireEvent.press(screen.getByRole('radio', { name: 'Something broke' }));

    fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));

    const busyButton = screen.getByRole('button', { name: 'Send feedback' });
    expect(busyButton.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(screen.getByText('Sending feedback…')).toBeVisible();
    await waitFor(() => expect(createFeedback).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveFeedback(receipt);
    });
    expect(
      await screen.findByText('Thanks - your feedback was saved.'),
    ).toBeVisible();
  });

  test('shows the submitted snapshot after acknowledgement without the later feedback POST event', async () => {
    // Break caught: the exact disclosure switches to the live buffer and adds an event that was never attached.
    let submittedBody: unknown;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body)) as unknown;
      return Response.json(receipt);
    };
    renderFeedback({ fetch });
    fireEvent.press(screen.getByRole('radio', { name: 'This is confusing' }));
    fireEvent.press(
      screen.getByRole('button', { name: 'Review attached diagnostics' }),
    );

    fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    expect(
      await screen.findByText('Thanks - your feedback was saved.'),
    ).toBeVisible();

    expect(submittedBody).toEqual(
      expect.objectContaining({
        diagnosticSnapshot: expect.objectContaining({
          source: 'PARENT_IOS',
          currentScreen: 'PARENT_FEEDBACK',
        }),
      }),
    );
    expect(screen.queryByText(/CREATE_FEEDBACK/)).toBeNull();
  });

  test.each([
    ['delivered', jest.fn().mockResolvedValue(receipt)],
    ['queued', jest.fn().mockRejectedValue(new Error('offline'))],
  ])(
    'resets the draft defaults after a durably %s submission',
    async (_case, createFeedback) => {
      // Break caught: successfully saved feedback leaves private draft text and prior choices in form state.
      const view = renderFeedback({ createFeedback });
      fireEvent.press(screen.getByRole('radio', { name: 'I have an idea' }));
      fireEvent.changeText(
        screen.getByLabelText('Tell us more (optional)'),
        'Reset this private draft.',
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Review attached diagnostics' }),
      );
      const diagnosticsSwitch = screen.getByRole('switch', {
        name: 'Include recent diagnostics',
      });
      fireEvent(diagnosticsSwitch, 'valueChange', false);

      fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
      await screen.findByText(/feedback was saved|Saved on this phone/i);

      expect(screen.getByLabelText('Tell us more (optional)').props.value).toBe(
        '',
      );
      expect(
        screen.getByRole('radio', { name: 'I have an idea' }).props
          .accessibilityState,
      ).toEqual({ checked: false, disabled: false });
      expect(
        screen.getByRole('switch', {
          name: 'Include recent diagnostics',
        }).props.accessibilityState,
      ).toEqual({
        checked: false,
        disabled: true,
      });
      expect(
        screen.getByText('Recent event timeline: Not attached'),
      ).toBeVisible();

      view.unmount();
      renderFeedback({ createFeedback });
      fireEvent.press(
        screen.getByRole('button', { name: 'Review attached diagnostics' }),
      );
      expect(
        screen.getByRole('switch', {
          name: 'Include recent diagnostics',
        }).props.accessibilityState,
      ).toEqual({ checked: true, disabled: false });
    },
  );

  test('preserves category, text, and diagnostic choice when enqueue itself fails', async () => {
    // Break caught: a pre-durability failure clears the only copy of the parent's draft.
    const underlying = createMemoryAsyncStorage();
    const storage: AsyncStorageLike = {
      ...underlying,
      setItem: async () => {
        throw new Error('storage write failed');
      },
    };
    const createFeedback = jest.fn().mockResolvedValue(receipt);
    renderFeedback({ createFeedback, storage });
    const idea = screen.getByRole('radio', { name: 'I have an idea' });
    fireEvent.press(idea);
    const description = screen.getByLabelText('Tell us more (optional)');
    fireEvent.changeText(description, 'Do not lose this draft.');
    fireEvent.press(
      screen.getByRole('button', { name: 'Review attached diagnostics' }),
    );
    const diagnosticsSwitch = screen.getByRole('switch', {
      name: 'Include recent diagnostics',
    });
    fireEvent(diagnosticsSwitch, 'valueChange', false);

    fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));

    expect(
      await screen.findByText(
        'Feedback could not be saved on this phone. Try again.',
      ),
    ).toBeVisible();
    expect(idea.props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    expect(description.props.value).toBe('Do not lose this draft.');
    expect(diagnosticsSwitch.props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    expect(createFeedback).not.toHaveBeenCalled();
  });
});

function renderFeedback({
  createFeedback,
  fetch = unusedFetch,
  storage = createMemoryAsyncStorage(),
  onCancel = () => undefined,
}: {
  createFeedback?: jest.MockedFunction<FamilyApiClient['createFeedback']>;
  fetch?: typeof globalThis.fetch;
  storage?: AsyncStorageLike;
  onCancel?: () => void;
}) {
  return render(
    <ParentFeedbackProvider
      session={parentSession}
      fetch={fetch}
      client={createFeedback ? { createFeedback } : undefined}
      isOnline
      dependencies={{
        now: () => new Date('2026-08-10T12:00:00.000Z'),
        randomUUID: () => '50000000-0000-4000-8000-000000000001',
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        storage,
      }}
    >
      <SendFeedbackScreen onCancel={onCancel} />
    </ParentFeedbackProvider>,
  );
}

const unusedFetch: typeof globalThis.fetch = async () =>
  new Response(null, { status: 204 });
